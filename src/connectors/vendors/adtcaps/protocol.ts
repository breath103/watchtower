// The STL NVR wire protocol: frames are `>III(cmd, status, len)` + body.
// Everything here is transport — no ffmpeg, no files.
import { createHash } from "node:crypto";
import net from "node:net";

import type { WallClock } from "../../../core/time.js";

export const CAPABILITY = 0x0af00000;
export const LOGIN = 0x0aa00004;
export const OPEN_CHANNEL = 0x0a000002;
const RESPONSE_MASK = 0xa0000000;

export const STREAM_PACKET = 0xaa020101;
export const QUERY_REC_FILE = 0x0a040004;
export const QUERY_REC_DATE = 0x0a040006;
export const KEEPALIVE = 0x0a7f0001;
// Stops ONE channel's live/VOD push while leaving the authenticated socket up.
// Response 0xAA020008 status=1 echoes the channel; body = [channel, 0].
export const STOP_CHANNEL = 0x0a020008;
const START_CODE = Buffer.from([0, 0, 0, 1]);

const THREE_BYTE_START_CODE = Buffer.from([0, 0, 1]);
const HEVC_SPS_SIGNATURE = Buffer.from([0x42, 0x01, 0x01]);
const HEVC_VPS_SYNTH = Buffer.from("40010c01ffff01600000030090000003000003005dac59", "hex");
const V10_MAGIC = Buffer.from("STL Stream Format v1.0");

// v1.0 H.264 units omit SPS/PPS and their first packet carries a truncated
// slice; decoding starts on the next (full IDR) packet instead. This pair
// is the encoder config these units use (Main 5.1, 1920x1080, CAVLC).
const H264_SPS = Buffer.from("674d00338a8a503c0113f2ffe00020002d808000", "hex");
const H264_PPS = Buffer.from("68ee3c80", "hex");

export type Codec = "h264" | "hevc";

export interface Frame {
  cmd: number;
  status: number;
  body: Buffer;
}

// Keyframe packets (body[6] & 0x80) arrive with the first ~32 payload bytes
// scrambled. Usually that only hits parameter sets ahead of the first intact
// start code, which the plain search below skips past. When the parameter sets
// are short (e.g. a 19-byte SPS) it also eats the first byte of the IDR's own
// start code, leaving only its `00 01` tail; resume at that IDR and rely on
// the header packet's parameter sets.
const KEYFRAME_FLAG = 0x80;
// channel, kind, LE length, flags, 24-bit LE ms timestamp. Its bytes can
// spell a start code (length `.. .. 00 00`, flags `00`, timestamp `01 ..`).
const PACKET_HEADER_BYTES = 10;
const KEYFRAME_SCAN_BYTES = 512;

function keyframeNalAfterTail(body: Buffer): number {
  const end = Math.min(body.length - 3, KEYFRAME_SCAN_BYTES);
  for (let i = PACKET_HEADER_BYTES; i < end; i++) {
    if (body[i] !== 0 || body[i + 1] !== 1) continue;
    const header = body[i + 2];
    const h264Idr = (header & 0x9f) === 5 && (header & 0x60) !== 0;
    const hevcType = (header >> 1) & 0x3f;
    const hevcIrap = (header & 0x81) === 0 && hevcType >= 16 && hevcType <= 21 && body[i + 3] === 1;
    if (h264Idr || hevcIrap) return i + 2;
  }
  return -1;
}

// VOD playback scrambles a few more bytes than live: the keyframe's start code
// can lose both zero bytes, leaving only `01 <idr>`. Resume at the IDR and let
// the caller prepend the header packet's parameter sets.
function keyframeNalAfterLoneTail(body: Buffer): number {
  const end = Math.min(body.length - 3, KEYFRAME_SCAN_BYTES);
  for (let i = PACKET_HEADER_BYTES; i < end; i++) {
    if (body[i] !== 1) continue;
    const header = body[i + 1];
    const h264Idr = (header & 0x9f) === 5 && (header & 0x60) !== 0;
    if (h264Idr) return i + 1;
  }
  return -1;
}

// Capture time in ms; wraps every 2^24 ms (~4.7h).
export const packetTimestampMs = (body: Buffer): number => body.readUIntLE(7, 3);

// The stream header packet carries the device's local wall-clock start at
// body+0x3d: u16le year, then u8 month/day/hour/minute/second.
export function headerWallClock(body: Buffer): WallClock | null {
  if (body.length < 0x44) return null;
  const year = body.readUInt16LE(0x3d);
  const month = body[0x3f];
  const day = body[0x40];
  const hour = body[0x41];
  const minute = body[0x42];
  const second = body[0x43];
  if (year < 2000 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day, hour, minute, second };
}

export function videoChunk(body: Buffer): Buffer | null {
  if (body[1] === 1 && (body[6] & KEYFRAME_FLAG) !== 0) {
    const nal = keyframeNalAfterTail(body);
    const lone = nal < 0 ? keyframeNalAfterLoneTail(body) : -1;
    const start = nal >= 0 ? nal : lone;
    const intact = body.indexOf(THREE_BYTE_START_CODE, PACKET_HEADER_BYTES);
    if (start >= 0 && (intact < 0 || intact > start - 3)) return Buffer.concat([START_CODE, body.subarray(start)]);
  }
  const four = body.indexOf(START_CODE, PACKET_HEADER_BYTES);
  const three = body.indexOf(THREE_BYTE_START_CODE, PACKET_HEADER_BYTES);
  if (four < 0 && three < 0) return null;
  if (four < 0) return body.subarray(three);
  if (three < 0 || four <= three) return body.subarray(four);
  return body.subarray(three);
}

// The TLV boundary cuts the first packet mid-slice, so the last NAL in it is
// incomplete. Keeping the parameter sets that precede it lets the decoder start
// cleanly on the next (full IDR) packet instead of erroring on a broken slice.
export function completeNals(chunk: Buffer): Buffer {
  const offsets: number[] = [];
  for (let i = chunk.indexOf(THREE_BYTE_START_CODE); i !== -1; i = chunk.indexOf(THREE_BYTE_START_CODE, i + 3)) {
    offsets.push(i);
  }
  if (offsets.length < 2) return Buffer.alloc(0);
  return chunk.subarray(0, offsets[offsets.length - 1]);
}

export function detectCodec(chunk: Buffer): Codec {
  let offset = 0;
  for (let nal = 0; nal < 8; nal++) {
    const index = chunk.indexOf(THREE_BYTE_START_CODE, offset);
    if (index < 0 || index + 3 >= chunk.length) break;
    const header = chunk[index + 3];
    offset = index + 3;
    if (header === 0x67 || header === 0x68 || header === 0x65) return "h264";
    if (header === 0x40 || header === 0x42 || header === 0x44 || header === 0x26) return "hevc";
  }
  return "hevc";
}

// Walks the Annex-B NAL units in `chunk` (which starts at a start code),
// calling `visit(type, start, end)` for each. `start` includes the start code;
// both 3-byte and 4-byte start codes are handled on every scan point.
function forEachNal(chunk: Buffer, codec: Codec, visit: (type: number, start: number, end: number) => void): void {
  const n = chunk.length;
  let i = 0;
  while (i < n - 3) {
    if (chunk[i] !== 0 || chunk[i + 1] !== 0) {
      i++;
      continue;
    }
    let sc = 0;
    if (chunk[i + 2] === 1) sc = 3;
    else if (chunk[i + 2] === 0 && chunk[i + 3] === 1) sc = 4;
    if (!sc) {
      i++;
      continue;
    }
    const headerIdx = i + sc;
    if (headerIdx >= n) break;
    const header = chunk[headerIdx];
    const type = codec === "h264" ? header & 0x1f : (header >> 1) & 0x3f;
    let end = n;
    for (let j = headerIdx + 1; j < n - 3; j++) {
      if (chunk[j] === 0 && chunk[j + 1] === 0 && (chunk[j + 2] === 1 || (chunk[j + 2] === 0 && chunk[j + 3] === 1))) {
        end = j;
        break;
      }
    }
    visit(type, i, end);
    i = end;
  }
}

// The VPS/SPS/PPS (or SPS/PPS) a decoder needs before any slice, taken from
// the in-band parameter sets of the first chunk. v1.0 units carry no in-band
// parameter sets and are handled separately by parameterSetPrefix.
export function extractParameterSets(chunk: Buffer, codec: Codec): Buffer {
  const out: Buffer[] = [];
  forEachNal(chunk, codec, (type, start, end) => {
    const isParamSet = codec === "h264" ? type === 7 || type === 8 : type === 32 || type === 33 || type === 34;
    if (isParamSet) out.push(chunk.subarray(start, end));
  });
  return Buffer.concat(out);
}

// True when `chunk` starts an IDR / random-access NAL — the first frame a
// decoder can render cleanly after a mid-stream join.
export function isKeyframe(chunk: Buffer, codec: Codec): boolean {
  let key = false;
  forEachNal(chunk, codec, type => {
    if (codec === "h264" ? type === 5 : type >= 16 && type <= 21) key = true;
  });
  return key;
}

// Old-firmware units ("STL Stream Format v1.0") carry the SPS inline but with
// no start code, and omit the VPS entirely.
export function parameterSetPrefix(body: Buffer, codec: Codec): Buffer | null {
  if (!body.includes(V10_MAGIC)) return null;
  if (codec === "h264") return Buffer.concat([START_CODE, H264_SPS, START_CODE, H264_PPS]);
  const start = body.indexOf(HEVC_SPS_SIGNATURE);
  if (start < 0) return null;
  const three = body.indexOf(THREE_BYTE_START_CODE, start);
  const four = body.indexOf(START_CODE, start);
  let end = body.length;
  if (three >= 0) end = Math.min(end, three);
  if (four >= 0) end = Math.min(end, four);
  const sps = body.subarray(start, end);
  return Buffer.concat([START_CODE, HEVC_VPS_SYNTH, START_CODE, sps]);
}

// Frames on the socket all use `>III(cmd, status, len)` + body. A persistent
// 'data' listener feeds the buffer because once a stream has gone flowing,
// removing the listener would drop data (Node keeps flowing on last-listener
// removal). `sock.pause()` is the real backpressure lever we use in the pump.
export class FrameReader {
  private buf = Buffer.alloc(0);
  private backlog: Frame[] = [];
  private error: Error | null = null;
  private closed = false;
  private notify: (() => void) | null = null;

  constructor(private readonly sock: net.Socket) {
    sock.on("data", (d: Buffer) => {
      this.buf = Buffer.concat([this.buf, d]);
      this.wake();
    });
    sock.on("error", (e: Error) => {
      this.error = e;
      this.wake();
    });
    sock.on("close", () => {
      this.closed = true;
      this.wake();
    });
  }

  private wake(): void {
    this.notify?.();
    this.notify = null;
  }

  private tryParse(): Frame | null {
    if (this.buf.length < 12) return null;
    const len = this.buf.readUInt32BE(8);
    if (this.buf.length < 12 + len) return null;
    const frame = {
      cmd: this.buf.readUInt32BE(0),
      status: this.buf.readUInt32BE(4),
      body: this.buf.subarray(12, 12 + len),
    };
    this.buf = this.buf.subarray(12 + len);
    return frame;
  }

  async readFrame(timeoutMs: number): Promise<Frame> {
    return this.backlog.shift() ?? this.readSocket(timeoutMs);
  }

  private async readSocket(timeoutMs: number): Promise<Frame> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const frame = this.tryParse();
      if (frame) return frame;
      if (this.error) throw this.error;
      if (this.closed) throw new Error("socket closed");
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`no frame within ${timeoutMs}ms`);
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => {
          this.notify = null;
          resolve();
        }, remaining);
        this.notify = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    }
  }

  // Consume frames until the response to `cmd` arrives (skipping NVR events).
  // `>>> 0` because | overflows JS's signed 32-bit ints — 0x0AF00000|0xA0000000
  // is negative, and would never equal the unsigned value from readUInt32BE.
  async readResponse(cmd: number, timeoutMs = 5000): Promise<Frame> {
    const expected = (cmd | RESPONSE_MASK) >>> 0;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`no response to ${cmd.toString(16)} within ${timeoutMs}ms`);
      const frame = await this.readSocket(remaining);
      if (frame.cmd === expected) return frame;
      // Video can start arriving before the control response; keep it so the
      // caller receives the parameter sets sent at stream start.
      if (frame.cmd === STREAM_PACKET) this.backlog.push(frame);
    }
  }
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function be16(value: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16BE(value);
  return buf;
}

function be32(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(value);
  return buf;
}

function send(sock: net.Socket, cmd: number, body: Buffer): void {
  sock.write(Buffer.concat([be32(cmd), be32(0), be32(body.length), body]));
}

export function sendCommand(sock: net.Socket, cmd: number, body: Buffer = Buffer.alloc(0)): void {
  send(sock, cmd, body);
}

export async function connectTcp(host: string, port: number, timeoutMs: number): Promise<net.Socket> {
  return new Promise<net.Socket>((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => socket.destroy(new Error("connect timeout")), timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", err => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export async function login(
  sock: net.Socket,
  reader: FrameReader,
  opts: { username: string; password: string }
): Promise<void> {
  const deviceInfo = Buffer.from("[DEVICE_INFO]\nEX_FASTPLAY=TRUE\nDUAL_STRM_REC=TRUE\nCRP_SUPPORT=TRUE\n", "ascii");
  send(sock, CAPABILITY, deviceInfo);
  await reader.readResponse(CAPABILITY);

  const user = Buffer.from(sha256Hex(opts.username), "ascii");
  const pass = Buffer.from(sha256Hex(opts.password), "ascii");
  send(
    sock,
    LOGIN,
    Buffer.concat([be16(user.length + 1), user, Buffer.from([0]), be16(pass.length + 1), pass, Buffer.from([0, 1])])
  );
  const response = await reader.readResponse(LOGIN);
  if (response.status !== 1) throw new Error(`login rejected (status ${response.status})`);
}

export async function handshake(
  sock: net.Socket,
  reader: FrameReader,
  opts: { username: string; password: string; channel: number; streamType?: number }
): Promise<void> {
  await login(sock, reader, opts);
  const open = await openChannel(sock, reader, opts);
  if (open.status !== 1) throw new Error(`open channel ${opts.channel} rejected (status ${open.status})`);
}

export function openChannelBody(opts: { channel: number; streamType?: number; name?: string }): Buffer {
  const name = Buffer.from(opts.name ?? "DVR_1", "ascii");
  return Buffer.concat([
    be16(name.length + 1),
    name,
    Buffer.from([0]),
    Buffer.from([opts.streamType ?? 0, opts.channel]),
    be32(0),
    be32(0),
    Buffer.from([0, 0]),
  ]);
}

// VOD playback is the same OPEN_CHANNEL command with mode 1, the channel's
// 0x80 playback bit, and the requested capture date/time (YYYYMMDD/HHMMSS).
export function openVodBody(opts: {
  channel: number;
  date: number;
  time: number;
  name?: string;
  substream?: boolean;
}): Buffer {
  const name = Buffer.from(opts.name ?? "DVR_1", "ascii");
  return Buffer.concat([
    be16(name.length + 1),
    name,
    Buffer.from([0]),
    Buffer.from([1, opts.channel | (opts.substream ? 0x80 : 0)]),
    be32(opts.date),
    be32(opts.time),
    Buffer.from([0, 0]),
  ]);
}

export function stopChannelBody(channel: number): Buffer {
  return Buffer.from([channel & 0xff, 0]);
}

export async function openChannel(
  sock: net.Socket,
  reader: FrameReader,
  opts: { channel: number; streamType?: number }
): Promise<Frame> {
  send(sock, OPEN_CHANNEL, openChannelBody(opts));
  return reader.readResponse(OPEN_CHANNEL);
}

// VOD playback is the same OPEN_CHANNEL command with mode 1, the channel's
// 0x80 playback bit, and the requested capture date/time (YYYYMMDD/HHMMSS).
export async function openVod(
  sock: net.Socket,
  reader: FrameReader,
  opts: { channel: number; date: number; time: number; name?: string; substream?: boolean }
): Promise<Frame> {
  send(sock, OPEN_CHANNEL, openVodBody(opts));
  return reader.readResponse(OPEN_CHANNEL);
}
