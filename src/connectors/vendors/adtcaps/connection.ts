import { createHash } from "node:crypto";
import type { Socket } from "node:net";
import { z } from "zod";

import {
  type ConnectionStatus,
  type ConnectorConnection,
  type ConnectorContext,
  type DiscoveredCamera,
  type RawFrame,
  type Recording,
  type StreamOptions,
  type VideoSubscription,
} from "../../../core/connector.js";
import type { Logger } from "../../../core/logger.js";
import { Subject } from "../../../core/observable.js";
import { hostTimeZone, isTimeZone, type WallClock, wallClockOf, wallClockToUtc } from "../../../core/time.js";
import type { Codec } from "../../../core/types.js";
import { DataSessionLock } from "./data-lock.js";
import {
  CAPABILITY,
  connectTcp,
  detectCodec,
  extractParameterSets,
  type Frame,
  FrameReader,
  headerWallClock,
  isKeyframe,
  KEEPALIVE,
  LOGIN,
  login,
  OPEN_CHANNEL,
  openChannelBody,
  packetTimestampMs,
  parameterSetPrefix,
  QUERY_REC_FILE,
  STOP_CHANNEL,
  STREAM_PACKET,
  sendCommand,
  stopChannelBody,
  videoChunk,
} from "./protocol.js";
import {
  clipAndMerge,
  dayNumber,
  type LocalDay,
  localDaysCovering,
  MINUTES_PER_DAY,
  recordingsFromMinuteMap,
} from "./recordings.js";
import { openVodSession, type VodSession } from "./vod.js";

export const adtcapsConnectionConfig = z.object({
  host: z.string().describe("NVR address, e.g. 192.0.2.10"),
  port: z.number().int().default(3100).describe("protocol port"),
  username: z.string(),
  password: z.string(),
  timezone: z
    .string()
    .refine(isTimeZone, "not an IANA time zone")
    .optional()
    .describe("IANA time zone the NVR clock is set to, e.g. Asia/Seoul. Defaults to this server's zone."),
});
type AdtcapsConfig = z.infer<typeof adtcapsConnectionConfig>;

const RESPONSE_MASK = 0xa0000000;
const responseOf = (cmd: number): number => (cmd | RESPONSE_MASK) >>> 0;
const shaHex = (v: string): Buffer => Buffer.from(createHash("sha256").update(v).digest("hex"), "ascii");
const DEVICE_INFO = Buffer.from("[DEVICE_INFO]\nEX_FASTPLAY=TRUE\nDUAL_STRM_REC=TRUE\nCRP_SUPPORT=TRUE\n", "ascii");

const be32 = (value: number): Buffer => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0);
  return buffer;
};
const u16 = (value: number): Buffer => {
  const buf = Buffer.alloc(2);
  buf.writeUInt16BE(value);
  return buf;
};
const metadataSchema = z.object({ channel: z.number().int().min(0) });
const DAY_CACHE_LIMIT = 256;
const TODAY_TTL_MS = 60_000;

interface LiveChannel {
  subs: Set<Subject<RawFrame>>;
  header: RawFrame | null;
  codec: Codec | null;
  startMs: number | null;
}

function failedSubscription(error: Error): VideoSubscription {
  const subject = new Subject<RawFrame>();
  subject.close();
  const opened = Promise.reject(error);
  opened.catch(() => undefined);
  return { frames: subject, opened, stop: () => undefined };
}

// One persistent authenticated socket per NVR carrying control (timeline,
// keepalive), live video and thumbnail grabs. Channels are refcounted and
// released with STOP_CHANNEL (0x0A020008) instead of tearing down the socket.
// Playback opens short-lived VOD sockets, serialized per NVR.
export class AdtcapsConnection implements ConnectorConnection {
  private socket: Socket | null = null;
  private connecting: Promise<void> | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private lastError: string | null = null;
  private lastUsed = 0;
  private buffer = Buffer.alloc(0);
  private readonly pending = new Map<
    number,
    { resolve: (f: Frame) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();
  private readonly channels = new Map<number, LiveChannel>();
  private readonly numberById = new Map<string, number>();
  private readonly idByNumber = new Map<number, string>();
  private readonly playbackLock = new DataSessionLock();
  private readonly playbackStops = new Set<() => void>();
  private readonly dayCache = new Map<string, { expiresAt: number; blocks: Map<number, Uint8Array> }>();
  private readonly timeZone: string;

  constructor(
    private readonly opts: {
      endpoint: AdtcapsConfig;
      cameras: ConnectorContext["cameras"];
      logger: Logger;
    }
  ) {
    this.timeZone = opts.endpoint.timezone ?? hostTimeZone();
    for (const camera of opts.cameras) {
      const { channel } = metadataSchema.parse(camera.metadata);
      this.numberById.set(camera.id, channel);
      this.idByNumber.set(channel, camera.id);
    }
  }

  private num(cameraId: string): number | null {
    return this.numberById.get(cameraId) ?? null;
  }

  private utc(wall: WallClock | null): number | null {
    return wall ? wallClockToUtc(wall, this.timeZone) : null;
  }

  private today(): LocalDay {
    return wallClockOf(Date.now(), this.timeZone);
  }

  // ---- lifecycle / control ----------------------------------------------

  async test(): Promise<{ ok: boolean; model?: string; error?: string }> {
    let sock: Socket | null = null;
    try {
      sock = await connectTcp(this.opts.endpoint.host, this.opts.endpoint.port, 8000);
      const reader = new FrameReader(sock);
      await login(sock, reader, { username: this.opts.endpoint.username, password: this.opts.endpoint.password });
      return { ok: true, model: "STL NVA series (ADTCaps protocol)" };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      sock?.destroy();
    }
  }

  async discoverCameras(): Promise<DiscoveredCamera[]> {
    const blocks = await this.queryDay(0xffff, dayNumber(this.today()));
    return [...blocks.keys()]
      .sort((a, b) => a - b)
      .map(channel => ({ key: String(channel), name: `CH${channel + 1}`, metadata: { channel } }));
  }

  async listRecordings(cameraIds: string[], fromMs: number, toMs: number): Promise<Recording[]> {
    const cameras = cameraIds.flatMap(id => {
      const num = this.num(id);
      return num === null ? [] : [{ id, num }];
    });
    if (cameras.length === 0) return [];
    const bitmask = cameras.reduce((mask, camera) => mask | (1 << camera.num), 0);
    const out: Recording[] = [];
    for (const day of localDaysCovering(fromMs, toMs, this.timeZone)) {
      const blocks = await this.cachedDay(bitmask, day);
      for (const camera of cameras) {
        const block = blocks.get(camera.num);
        if (block) out.push(...recordingsFromMinuteMap(camera.id, day, block, this.timeZone));
      }
    }
    return clipAndMerge(out, fromMs, toMs);
  }

  private async cachedDay(bitmask: number, day: LocalDay): Promise<Map<number, Uint8Array>> {
    const key = `${dayNumber(day)}:${bitmask}`;
    const hit = this.dayCache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.blocks;
    const blocks = await this.queryDay(bitmask, dayNumber(day));
    const past = dayNumber(day) < dayNumber(this.today());
    this.dayCache.delete(key);
    this.dayCache.set(key, { expiresAt: past ? Number.POSITIVE_INFINITY : Date.now() + TODAY_TTL_MS, blocks });
    if (this.dayCache.size > DAY_CACHE_LIMIT) {
      const oldest = this.dayCache.keys().next().value;
      if (oldest !== undefined) this.dayCache.delete(oldest);
    }
    return blocks;
  }

  private async queryDay(bitmask: number, dateNum: number): Promise<Map<number, Uint8Array>> {
    const response = await this.request(QUERY_REC_FILE, Buffer.concat([be32(dateNum), be32(bitmask)]), 10_000);
    if (response.status !== 1) throw new Error(`timeline query rejected (status ${response.status})`);
    const body = response.body;
    const count = body.at(0) ?? 0;
    const blocks = new Map<number, Uint8Array>();
    let offset = 1;
    for (let index = 0; index < count; index++) {
      const channel = body.at(offset);
      offset += 1;
      const block = body.subarray(offset, offset + MINUTES_PER_DAY);
      offset += MINUTES_PER_DAY;
      if (channel !== undefined && block.length === MINUTES_PER_DAY) {
        blocks.set(channel, Uint8Array.from(block));
      }
    }
    return blocks;
  }

  status(): ConnectionStatus {
    return {
      connected: this.socket !== null && !this.socket.destroyed,
      error: this.lastError,
      usedAt: this.lastUsed,
      liveCameras: [...this.channels.keys()].flatMap(num => {
        const id = this.idByNumber.get(num);
        return id === undefined ? [] : [id];
      }),
    };
  }

  close(): void {
    this.stopHeartbeat();
    for (const entry of this.channels.values()) for (const sub of entry.subs) sub.close();
    this.channels.clear();
    for (const stop of this.playbackStops) stop();
    this.failAllPending();
    this.socket?.destroy();
    this.socket = null;
  }

  // ---- live subscriptions -------------------------------------------------

  subscribeLive(cameraId: string, _opts?: StreamOptions): VideoSubscription {
    const num = this.num(cameraId);
    if (num === null) return failedSubscription(new Error(`unknown camera: ${cameraId}`));
    let entry = this.channels.get(num);
    const created = entry === undefined;
    if (!entry) {
      entry = { subs: new Set(), header: null, codec: null, startMs: null };
      this.channels.set(num, entry);
    }
    const owned = entry;
    const subject = new Subject<RawFrame>();
    // A late joiner needs the cached stream header before any delta frame is
    // decodable.
    if (owned.header) subject.push(owned.header);
    owned.subs.add(subject);

    let opened: Promise<void> = Promise.resolve();
    if (created) {
      opened = this.enqueue(() => this.openChannel(num)).catch(error => {
        this.lastError = String(error);
        this.opts.logger.log({ level: "warn", message: "channel open failed", camera: cameraId, error });
        if (this.channels.get(num) === owned) {
          this.channels.delete(num);
          for (const sub of owned.subs) sub.close();
        }
        throw error;
      });
    }
    // Callers that only read frames (thumbnails) never await `opened`; keep an
    // internal handler so an ignored open failure can't crash the process.
    // Awaiters (live/clip routes) still see the rejection.
    opened.catch(() => undefined);
    return {
      frames: subject,
      opened,
      stop: () => {
        owned.subs.delete(subject);
        subject.close();
        if (owned.subs.size === 0 && this.channels.get(num) === owned) {
          this.channels.delete(num);
          void this.enqueue(() => this.stopChannel(num)).catch(() => undefined);
        }
      },
    };
  }

  // ---- playback subscriptions ----------------------------------------------

  subscribePlayback(cameraId: string, startMs: number, opts?: StreamOptions): VideoSubscription {
    const num = this.num(cameraId);
    if (num === null) return failedSubscription(new Error(`unknown camera: ${cameraId}`));
    const wall = wallClockOf(startMs, this.timeZone);
    const subject = new Subject<RawFrame>();
    let session: VodSession | null = null;
    let stopped = false;
    const stop = (): void => {
      if (stopped) return;
      stopped = true;
      this.playbackStops.delete(stop);
      session?.close();
      subject.close();
    };
    this.playbackStops.add(stop);

    const opened = this.playbackLock
      .run("vod", async () => {
        if (stopped) return;
        session = await openVodSession({
          endpoint: this.opts.endpoint,
          channel: num,
          date: dayNumber(wall),
          time: wall.hour * 10_000 + wall.minute * 100 + wall.second,
          substream: opts?.stream === "sub",
        });
        void this.pumpPlayback(session, subject);
      })
      .catch(error => {
        stop();
        throw error;
      });
    opened.catch(() => undefined); // see subscribeLive: never crash on ignored opens

    return { frames: subject, opened, stop };
  }

  private async pumpPlayback(session: VodSession, subject: Subject<RawFrame>): Promise<void> {
    let codec: Codec | null = null;
    let startMs: number | null = null;
    try {
      for (;;) {
        if (subject.isClosed) break;
        const frame = await session.reader.readFrame(15_000);
        if (frame.cmd !== STREAM_PACKET) continue;
        const chunk = videoChunk(frame.body);
        if (!chunk) continue;
        if (frame.body[1] === 0) {
          codec = detectCodec(chunk);
          startMs = this.utc(headerWallClock(frame.body));
          subject.push({
            kind: "header",
            codec,
            data: Buffer.concat([
              parameterSetPrefix(frame.body, codec) ?? Buffer.alloc(0),
              extractParameterSets(chunk, codec),
            ]),
            timestampMs: startMs,
            key: false,
          });
          continue;
        }
        if (!codec || startMs === null) continue;
        subject.push({
          kind: "frame",
          codec,
          data: chunk,
          timestampMs: startMs + packetTimestampMs(frame.body),
          key: isKeyframe(chunk, codec),
        });
      }
    } catch {
      // socket closed or read timeout: the stream is over
    } finally {
      subject.close();
      session.close();
    }
  }

  // ---- socket machinery -----------------------------------------------------

  private async openChannel(channel: number): Promise<void> {
    await this.ensure();
    const response = await this.call(OPEN_CHANNEL, openChannelBody({ channel }), 6000);
    if (response.status !== 1) throw new Error(`open ch${channel} rejected (status ${response.status})`);
    this.lastUsed = Date.now();
  }

  // An idle-channel stop is answered with an error status (0xF00F20FF) or
  // sometimes not at all, so its timeout is swallowed either way.
  private async stopChannel(channel: number): Promise<void> {
    if (!this.connected()) return;
    await this.call(STOP_CHANNEL, stopChannelBody(channel), 1000).catch(() => undefined);
    this.lastUsed = Date.now();
  }

  private connected(): boolean {
    return this.socket !== null && !this.socket.destroyed;
  }

  // Serialized request/response for control-plane probes and vendor queries.
  request(cmd: number, body: Buffer, timeoutMs = 5000): Promise<Frame> {
    return this.enqueue(async () => {
      await this.ensure();
      const frame = await this.call(cmd, body, timeoutMs);
      this.lastUsed = Date.now();
      return frame;
    });
  }

  private call(cmd: number, body: Buffer, timeoutMs: number): Promise<Frame> {
    const sock = this.socket;
    if (!sock || sock.destroyed) return Promise.reject(new Error("not connected"));
    const key = responseOf(cmd);
    return new Promise<Frame>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(key);
        reject(new Error(`no response to 0x${cmd.toString(16)} in ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(key, { resolve, reject, timer });
      sendCommand(sock, cmd, body);
    });
  }

  // Serialize every control command: one response in flight at a time.
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = (): Promise<T> => task();
    const result = this.queue.then(run, run);
    this.queue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      if (this.buffer.length < 12) break;
      const len = this.buffer.readUInt32BE(8);
      if (len > 20_000_000) {
        this.buffer = Buffer.alloc(0);
        return;
      }
      if (this.buffer.length < 12 + len) break;
      const cmd = this.buffer.readUInt32BE(0) >>> 0;
      const status = this.buffer.readUInt32BE(4) >>> 0;
      const body = Buffer.from(this.buffer.subarray(12, 12 + len));
      this.buffer = this.buffer.subarray(12 + len);
      if (cmd === STREAM_PACKET) {
        this.route(body);
        continue;
      }
      const waiter = this.pending.get(cmd);
      if (waiter) {
        this.pending.delete(cmd);
        clearTimeout(waiter.timer);
        waiter.resolve({ cmd, status, body });
      }
    }
  }

  private route(body: Buffer): void {
    const entry = this.channels.get(body.at(0) ?? -1);
    if (!entry) return;
    const chunk = videoChunk(body);
    if (!chunk) return;
    if (body[1] === 0) {
      const codec = detectCodec(chunk);
      const startMs = this.utc(headerWallClock(body));
      const header: RawFrame = {
        kind: "header",
        codec,
        data: Buffer.concat([parameterSetPrefix(body, codec) ?? Buffer.alloc(0), extractParameterSets(chunk, codec)]),
        timestampMs: startMs,
        key: false,
      };
      entry.header = header;
      entry.codec = codec;
      entry.startMs = startMs;
      for (const sub of entry.subs) sub.push(header);
      return;
    }
    if (!entry.codec || entry.startMs === null) return;
    const frame: RawFrame = {
      kind: "frame",
      codec: entry.codec,
      data: chunk,
      timestampMs: entry.startMs + packetTimestampMs(body),
      key: isKeyframe(chunk, entry.codec),
    };
    for (const sub of entry.subs) sub.push(frame);
  }

  private async ensure(): Promise<void> {
    if (this.connected()) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.connect().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async connect(): Promise<void> {
    const { endpoint, logger } = this.opts;
    const sock = await connectTcp(endpoint.host, endpoint.port, 8000);
    sock.setNoDelay(true);
    sock.on("error", error => {
      this.lastError = String(error);
    });
    sock.on("data", (chunk: Buffer) => this.onData(chunk));
    sock.on("close", () => {
      if (this.socket !== sock) return;
      this.socket = null;
      this.stopHeartbeat();
      this.buffer = Buffer.alloc(0);
      // Live channels the device no longer has: end their subjects so
      // subscribers re-fetch instead of hanging.
      for (const entry of this.channels.values()) for (const sub of entry.subs) sub.close();
      this.channels.clear();
      this.failAllPending();
      logger.log({ level: "warn", message: "control connection closed" });
    });

    this.socket = sock;
    this.buffer = Buffer.alloc(0);
    try {
      await this.call(CAPABILITY, DEVICE_INFO, 5000);
      const loginResponse = await this.call(
        LOGIN,
        Buffer.concat([
          u16(shaHex(endpoint.username).length + 1),
          shaHex(endpoint.username),
          Buffer.from([0]),
          u16(shaHex(endpoint.password).length + 1),
          shaHex(endpoint.password),
          Buffer.from([0, 1]),
        ]),
        5000
      );
      if (loginResponse.status !== 1) throw new Error(`login rejected (status ${loginResponse.status})`);
    } catch (error) {
      sock.destroy();
      if (this.socket === sock) this.socket = null;
      throw error;
    }

    this.lastError = null;
    this.lastUsed = Date.now();
    this.heartbeat = setInterval(() => {
      if (this.socket && !this.socket.destroyed) sendCommand(this.socket, KEEPALIVE);
    }, 10_000);
    logger.log({ level: "info", message: "control connected" });
  }

  private failAllPending(): void {
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("connection closed"));
    }
    this.pending.clear();
  }

  private stopHeartbeat(): void {
    if (!this.heartbeat) return;
    clearInterval(this.heartbeat);
    this.heartbeat = null;
  }
}
