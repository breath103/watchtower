// Vendor-agnostic media packaging: every pump here consumes normalized
// RawFrames from ANY connector and produces the same artifacts (fragmented
// MP4 for browsers, MPEG-TS for clip jobs, JPEG-ready keyframes). Adding a
// vendor never touches this file.

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { once } from "node:events";
import type { WriteStream } from "node:fs";
import type { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import { h264CodecString } from "../core/codec.js";
import { type RawFrame, type VideoSubscription } from "../core/connector.js";
import type { Logger } from "../core/logger.js";
import { FramePull } from "../core/observable.js";
import { type CacheFrame, type Codec } from "../core/types.js";
import { TRANSCODED_CODEC_STRING, videoOutputArgs } from "../ffmpeg.js";
import { MpegTsWriter } from "../mpegts.js";

export interface PackagedStream {
  readable: Readable;
  codec: Codec;
  codecString: string | null;
  stop(): void;
}

export interface ClipPumpInfo extends PackagedStream {
  // True when the pump reached the window end; false when stopped early
  // (client abort, error). The clip route uses this to decide cache
  // finalize-vs-discard, so a truncated fetch never pollutes the cache.
  done: Promise<boolean>;
}

const FIRST_KEYFRAME_TIMEOUT_MS = 10_000;
const QUIET_FRAME_TIMEOUT_MS = 15_000;
const OPEN_TIMEOUT_MS = 20_000;
const JOB_STALL_TIMEOUT_MS = 30_000;

async function openWithin(sub: VideoSubscription): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timed out opening the stream")), OPEN_TIMEOUT_MS);
  });
  try {
    await Promise.race([sub.opened, timeout]);
  } catch (error) {
    sub.stop();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function ffmpegFmp4(source: Codec, transcode: boolean): ChildProcessWithoutNullStreams {
  return spawn(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      // Raw H.264/HEVC has no timestamps. Without a frame rate ffmpeg
      // buffers and only flushes fragments at EOF, which stalls MSE.
      "-r",
      "30",
      "-f",
      source,
      "-i",
      "pipe:0",
      "-an",
      ...videoOutputArgs(source, transcode, true),
      "-movflags",
      "empty_moov+default_base_moof",
      "-flush_packets",
      "1",
      "-frag_duration",
      "1000000",
      "-f",
      "mp4",
      "pipe:1",
    ],
    { stdio: ["pipe", "pipe", "pipe"] }
  );
}

// Header + first keyframe of a subscription — what thumbnails decode to JPEG.
export async function grabKeyframe(
  sub: VideoSubscription,
  timeoutMs: number
): Promise<{ codec: Codec; data: Buffer } | null> {
  const pull = new FramePull(sub.frames);
  const deadline = Date.now() + timeoutMs;
  let header: RawFrame | null = null;
  try {
    while (Date.now() < deadline) {
      const frame = await pull.next(deadline - Date.now());
      if (frame === null) {
        if (pull.terminated || pull.stopped) return null;
        continue;
      }
      if (frame.kind === "header") {
        header = frame;
        continue;
      }
      if (!header || !frame.key) continue;
      return { codec: frame.codec, data: Buffer.concat([header.data, frame.data]) };
    }
    return null;
  } finally {
    pull.close();
  }
}

// Live view: header + first keyframe, then every frame into fragmented MP4.
export async function startLiveFmp4(
  sub: VideoSubscription,
  opts: { transcode?: boolean; signal?: AbortSignal; logger: Logger }
): Promise<PackagedStream> {
  await openWithin(sub);
  const pull = new FramePull(sub.frames);
  let stopped = false;
  let ffmpeg: ChildProcessWithoutNullStreams | null = null;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    pull.close();
    sub.stop();
    ffmpeg?.kill("SIGKILL");
    opts.logger.log({ level: "info", message: "live stream stopped" });
  };
  opts.signal?.addEventListener("abort", stop, { once: true });

  try {
    let header: RawFrame | null = null;
    let first: Buffer | null = null;
    let sourceCodec: Codec = "h264";
    let sourceCodecString: string | null = null;

    const deadline = Date.now() + FIRST_KEYFRAME_TIMEOUT_MS;
    while (first === null) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("timed out waiting for the first live keyframe");
      const frame = await pull.next(remaining);
      if (frame === null) {
        if (pull.terminated || pull.stopped) throw new Error("live connection closed before first keyframe");
        continue;
      }
      if (frame.kind === "header") {
        header = frame;
        continue;
      }
      if (!header || !frame.key) continue;
      sourceCodec = frame.codec;
      sourceCodecString = sourceCodec === "h264" ? h264CodecString(header.data) : null;
      first = Buffer.concat([header.data, frame.data]);
    }

    const transcode = opts.transcode === true && sourceCodec === "hevc";
    const outputCodec: Codec = transcode ? "h264" : sourceCodec;
    const outputCodecString = transcode ? TRANSCODED_CODEC_STRING : sourceCodecString;

    ffmpeg = ffmpegFmp4(sourceCodec, transcode);
    const child = ffmpeg;
    child.once("error", stop);
    child.once("exit", stop);
    child.stdin.on("error", () => undefined);
    child.stderr.resume();
    child.stdin.write(first);
    opts.logger.log({ level: "info", message: "live stream started", codec: sourceCodec, transcode });

    void (async () => {
      try {
        for (;;) {
          if (child.stdin.destroyed) return;
          const frame = await pull.next(QUIET_FRAME_TIMEOUT_MS);
          if (frame === null) {
            // Quiet channel keeps waiting; a terminated or stopped pull ends
            // the stream so ffmpeg/HTTP shut down cleanly.
            if (pull.terminated || pull.stopped) break;
            continue;
          }
          if (frame.kind !== "frame") continue;
          if (!child.stdin.write(frame.data)) await once(child.stdin, "drain");
        }
        stop();
      } catch {
        stop();
      }
    })();

    return { readable: child.stdout, codec: outputCodec, codecString: outputCodecString, stop };
  } catch (error) {
    stop();
    throw error;
  }
}

// Playback window → fragmented MP4, starting at the first in-window keyframe,
// teeing every decoded chunk to the clip cache writer.
export async function startClipFmp4(
  sub: VideoSubscription,
  opts: {
    startMs: number;
    endMs: number;
    transcode?: boolean;
    tee?: (frame: CacheFrame) => Promise<void>;
    signal?: AbortSignal;
    logger: Logger;
  }
): Promise<ClipPumpInfo> {
  await openWithin(sub);
  const pull = new FramePull(sub.frames);
  let stopped = false;
  let settleDone!: (complete: boolean) => void;
  const done = new Promise<boolean>(resolve => {
    settleDone = resolve;
  });
  let ffmpeg: ChildProcessWithoutNullStreams | null = null;

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    settleDone(false);
    opts.logger.log({ level: "info", message: "clip stream stopped" });
    pull.close();
    sub.stop();
    ffmpeg?.kill("SIGKILL");
  };
  opts.signal?.addEventListener("abort", stop, { once: true });

  try {
    let header: RawFrame | null = null;
    let first: Buffer | null = null;
    let firstTs = 0;
    let sourceCodec: Codec = "h264";
    let sourceCodecString: string | null = null;

    const deadline = Date.now() + QUIET_FRAME_TIMEOUT_MS;
    while (first === null) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("timed out waiting for a clip keyframe");
      const frame = await pull.next(remaining);
      if (frame === null) {
        if (pull.terminated || pull.stopped) throw new Error("playback closed before first keyframe");
        continue;
      }
      if (frame.kind === "header") {
        header = frame;
        continue;
      }
      if (!header || !frame.key || frame.timestampMs === null || frame.timestampMs < opts.startMs) continue;
      if (frame.timestampMs >= opts.endMs) throw new Error("no video in the requested window");
      sourceCodec = frame.codec;
      sourceCodecString = sourceCodec === "h264" ? h264CodecString(header.data) : null;
      first = Buffer.concat([header.data, frame.data]);
      firstTs = frame.timestampMs;
    }

    const transcode = opts.transcode === true && sourceCodec === "hevc";
    const outputCodec: Codec = transcode ? "h264" : sourceCodec;
    const outputCodecString = transcode ? TRANSCODED_CODEC_STRING : sourceCodecString;

    ffmpeg = ffmpegFmp4(sourceCodec, transcode);
    const child = ffmpeg;
    child.once("error", stop);
    child.once("exit", stop);
    child.stdin.on("error", () => undefined);
    child.stderr.resume();
    child.stdin.write(first);
    await opts.tee?.({ data: first, ptsMs: 0, key: true, codec: sourceCodec });
    opts.logger.log({ level: "info", message: "clip stream started", codec: sourceCodec });

    void (async () => {
      try {
        for (;;) {
          if (child.stdin.destroyed) return;
          const frame = await pull.next(QUIET_FRAME_TIMEOUT_MS);
          if (frame === null) {
            if (pull.stopped) return;
            if (pull.terminated) {
              settleDone(true);
              child.stdin.end();
              return;
            }
            continue;
          }
          if (frame.kind !== "frame" || frame.timestampMs === null) continue;
          if (frame.timestampMs < opts.startMs) continue;
          if (frame.timestampMs >= opts.endMs) {
            settleDone(true);
            child.stdin.end();
            return;
          }
          if (!child.stdin.write(frame.data)) await once(child.stdin, "drain");
          await opts.tee?.({
            data: frame.data,
            ptsMs: frame.timestampMs - firstTs,
            key: frame.key,
            codec: sourceCodec,
          });
        }
      } catch {
        stop();
      }
    })();

    return { readable: child.stdout, codec: outputCodec, codecString: outputCodecString, done, stop };
  } catch (error) {
    stop();
    throw error;
  }
}

// Playback window → MPEG-TS on a write stream (the clip-job artifact path).
// Returns frame count + source codec; the caller remuxes to MP4.
export async function runClipJobPump(
  sub: VideoSubscription,
  opts: {
    startMs: number;
    endMs: number;
    stream: WriteStream;
    onProgress: (progress: number) => void;
  }
): Promise<{ frames: number; codec: Codec }> {
  await openWithin(sub);
  const pull = new FramePull(sub.frames);
  let codec: Codec | null = null;
  let writer: MpegTsWriter | null = null;
  let headerData: Buffer | null = null;
  let firstWritten: number | null = null;
  let frames = 0;
  let progressAt = Date.now();
  try {
    for (;;) {
      const frame = await pull.next(QUIET_FRAME_TIMEOUT_MS);
      if (Date.now() - progressAt > JOB_STALL_TIMEOUT_MS) {
        throw new Error("no video in the requested window (device stalled or nothing recorded)");
      }
      if (frame === null) {
        if (pull.terminated || pull.stopped) break;
        continue;
      }
      if (frame.kind === "header") {
        codec = frame.codec;
        writer = new MpegTsWriter(frame.codec);
        headerData = frame.data;
        continue;
      }
      if (!codec || !writer || !headerData || frame.timestampMs === null) continue;
      if (frame.timestampMs < opts.startMs) continue;
      if (frame.timestampMs >= opts.endMs) break;
      if (firstWritten === null) {
        if (!frame.key) continue;
        firstWritten = frame.timestampMs;
      }
      const data = frames === 0 ? Buffer.concat([headerData, frame.data]) : frame.data;
      frames += 1;
      progressAt = Date.now();
      const packet = writer.frame(frame.timestampMs - firstWritten, data, frame.key);
      if (!opts.stream.write(packet)) await once(opts.stream, "drain");
      opts.onProgress(Math.min(1, (frame.timestampMs - opts.startMs) / Math.max(1, opts.endMs - opts.startMs)));
    }
  } finally {
    pull.close();
    sub.stop();
    opts.stream.end();
    await finished(opts.stream);
  }
  if (frames === 0 || !codec) throw new Error("no video captured in the requested window");
  return { frames, codec };
}
