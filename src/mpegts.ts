// Minimal MPEG-TS writer for one video stream: wraps Annex-B access units in
// PES packets stamped with the NVR's own capture time. Raw H.264/HEVC on
// ffmpeg's stdin has no timestamps, and `-use_wallclock_as_timestamps` stamps
// arrival time, which network bunching turns into fast/slow playback.
import type { Codec } from "./core/types.js";

const PACKET_BYTES = 188;
const PMT_PID = 0x1000;
const VIDEO_PID = 0x100;
const STREAM_TYPE: Record<Codec, number> = { h264: 0x1b, hevc: 0x24 };

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte << 24;
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1;
  }
  return crc >>> 0;
}

function section(body: number[]): Buffer {
  const table = Buffer.from(body);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(table));
  return Buffer.concat([Buffer.from([0]), table, crc]);
}

function pts90k(value: number): Buffer {
  const out = Buffer.alloc(5);
  const low = value % 2 ** 30;
  out[0] = 0x21 | ((Math.floor(value / 2 ** 30) & 0x07) << 1);
  out[1] = (low >>> 22) & 0xff;
  out[2] = (((low >>> 15) & 0x7f) << 1) | 1;
  out[3] = (low >>> 7) & 0xff;
  out[4] = ((low & 0x7f) << 1) | 1;
  return out;
}

function pcr(value: number): Buffer {
  const out = Buffer.alloc(6);
  out.writeUInt32BE(Math.floor(value / 2) >>> 0, 0);
  out[4] = ((value & 1) << 7) | 0x7e;
  out[5] = 0;
  return out;
}

export class MpegTsWriter {
  private readonly counters = new Map<number, number>();
  private readonly pat = section([
    0x00,
    0xb0,
    13,
    0x00,
    0x01,
    0xc1,
    0,
    0,
    0x00,
    0x01,
    0xe0 | (PMT_PID >> 8),
    PMT_PID & 0xff,
  ]);
  private readonly pmt: Buffer;
  private started = false;

  constructor(codec: Codec) {
    this.pmt = section([
      0x02,
      0xb0,
      18,
      0x00,
      0x01,
      0xc1,
      0,
      0,
      0xe0 | (VIDEO_PID >> 8),
      VIDEO_PID & 0xff,
      0xf0,
      0,
      STREAM_TYPE[codec],
      0xe0 | (VIDEO_PID >> 8),
      VIDEO_PID & 0xff,
      0xf0,
      0,
    ]);
  }

  // One access unit at `ptsMs`. PAT/PMT go out ahead of the first frame and
  // every keyframe so a reader can start at any keyframe.
  frame(ptsMs: number, data: Buffer, keyframe: boolean): Buffer {
    const ticks = Math.round(ptsMs * 90) % 2 ** 33;
    const out: Buffer[] = [];
    if (keyframe || !this.started) {
      out.push(this.psi(0, this.pat), this.psi(PMT_PID, this.pmt));
      this.started = true;
    }
    const pes = Buffer.concat([Buffer.from([0, 0, 1, 0xe0, 0, 0, 0x80, 0x80, 5]), pts90k(ticks), data]);
    const first = Buffer.concat([Buffer.from([(keyframe ? 0x40 : 0) | 0x10]), pcr(ticks)]);
    for (let offset = 0; offset < pes.length; ) {
      const adaptation = offset === 0 ? [first] : [];
      const used = adaptation.reduce((sum, part) => sum + part.length, 0);
      const room = PACKET_BYTES - 4 - (used > 0 ? used + 1 : 0);
      const take = Math.min(room, pes.length - offset);
      const stuffing = room - take;
      let field = Buffer.alloc(0);
      if (used > 0 || stuffing > 0) {
        const body =
          used > 0
            ? Buffer.concat([...adaptation, Buffer.alloc(stuffing, 0xff)])
            : stuffing > 1
              ? Buffer.concat([Buffer.from([0]), Buffer.alloc(stuffing - 2, 0xff)])
              : Buffer.alloc(0);
        field = Buffer.concat([Buffer.from([body.length]), body]);
      }
      out.push(this.header(VIDEO_PID, offset === 0, field.length > 0), field, pes.subarray(offset, offset + take));
      offset += take;
    }
    return Buffer.concat(out);
  }

  private psi(pid: number, payload: Buffer): Buffer {
    return Buffer.concat([
      this.header(pid, true, false),
      payload,
      Buffer.alloc(PACKET_BYTES - 4 - payload.length, 0xff),
    ]);
  }

  private header(pid: number, start: boolean, adaptation: boolean): Buffer {
    const counter = this.counters.get(pid) ?? 0;
    this.counters.set(pid, (counter + 1) & 0x0f);
    return Buffer.from([0x47, (start ? 0x40 : 0) | (pid >> 8), pid & 0xff, (adaptation ? 0x30 : 0x10) | counter]);
  }
}
