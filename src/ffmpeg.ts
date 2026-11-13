// ffmpeg helpers shared by the media services: clip remux, thumbnail decode,
// and the output args for live/clip fMP4.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import type { Codec } from "./core/types.js";

// MPEG-TS → MP4. HEVC+transcode re-encodes with libx264; otherwise stream-copy.
// The TS source carries explicit IDR flags (MpegTsWriter), so the resulting MP4
// has a truthful stss table — this is the ONLY sanctioned clip-file remux path,
// shared by save jobs and the clip cache.
export async function remuxToMp4(tsPath: string, mp4Path: string, codec: Codec, transcode: boolean): Promise<void> {
  const videoArgs =
    transcode && codec === "hevc"
      ? ["-an", "-c:v", "libx264", "-preset", "veryfast", "-profile:v", "main", "-level", "4.0", "-pix_fmt", "yuv420p"]
      : ["-c", "copy", ...(codec === "hevc" ? ["-tag:v", "hvc1"] : [])];
  await new Promise<void>((resolve, reject) => {
    const ffmpeg = spawn(
      "ffmpeg",
      ["-hide_banner", "-loglevel", "error", "-y", "-i", tsPath, ...videoArgs, "-movflags", "+faststart", mp4Path],
      { stdio: "ignore" }
    );
    ffmpeg.once("error", reject);
    ffmpeg.once("exit", code => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}`));
    });
  });
}

// Decode one keyframe (parameter sets + IDR) into `thumbnails/<ts>.jpeg`.
// stdin is closed right after the write: without EOF, ffmpeg's raw H.264/HEVC
// probe keeps waiting for more frames and never emits the picture.
export async function decodeKeyframe(dir: string, codec: Codec, keyframe: Buffer, ts: number): Promise<boolean> {
  const thumbsDir = path.join(dir, "thumbnails");
  await fs.mkdir(thumbsDir, { recursive: true });
  const tmp = path.join(thumbsDir, `.${ts}.jpg.tmp`);
  const child = spawn(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      codec,
      "-i",
      "pipe:0",
      "-frames:v",
      "1",
      "-q:v",
      "3",
      "-update",
      "1",
      "-f",
      "image2",
      tmp,
    ],
    { stdio: ["pipe", "ignore", "ignore"] }
  );
  // ffmpeg can exit before the write lands; swallow the EPIPE.
  child.stdin.on("error", () => undefined);
  const code = await new Promise<number>(resolve => {
    const kill = setTimeout(() => child.kill("SIGKILL"), 10_000);
    child.once("exit", value => {
      clearTimeout(kill);
      resolve(value ?? -1);
    });
    child.once("error", () => {
      clearTimeout(kill);
      resolve(-1);
    });
    child.stdin.end(keyframe);
  });
  if (code !== 0) {
    await fs.rm(tmp, { force: true });
    return false;
  }
  await fs.rename(tmp, path.join(thumbsDir, `${ts}.jpeg`));
  return true;
}

// Browsers without an HEVC decoder can still watch HEVC cameras when the
// gateway transcodes the stream to H.264. H.264 sources are always copied.
export function videoOutputArgs(source: Codec, transcode: boolean, live = false): string[] {
  if (transcode && source === "hevc") {
    return [
      "-c:v",
      "libx264",
      "-preset",
      live ? "ultrafast" : "veryfast",
      "-tune",
      "zerolatency",
      "-profile:v",
      "main",
      "-level",
      "4.0",
      "-pix_fmt",
      "yuv420p",
    ];
  }
  return ["-c:v", "copy", ...(source === "hevc" ? ["-tag:v", "hvc1"] : [])];
}

export const TRANSCODED_CODEC_STRING = "avc1.4d4028";
