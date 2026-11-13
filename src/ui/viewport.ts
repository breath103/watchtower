// One stream into one <video>: fragmented MP4 over fetch → MSE, or a plain
// src for complete files (clip cache hits). Callers abort via the signal.

import { api } from "./api.js";
import { sleep } from "./time.js";

// When HEVC can't be decoded, every request asks for transcode=h264 so
// playback and Save share one cache key.
export const hevcSupported = (() => {
  const probe = document.createElement("video");
  const type = 'video/mp4; codecs="hvc1.1.6.L120.90"';
  return probe.canPlayType(type) !== "" || MediaSource.isTypeSupported(type);
})();

export type Source =
  | { kind: "live"; camera: string; stream: string }
  | { kind: "recording"; camera: string; stream: string; start: number; end: number };

export function sourceUrl(source: Source): string {
  const params = new URLSearchParams({ stream: source.stream });
  if (!hevcSupported) params.set("transcode", "h264");
  if (source.kind === "live") return `/api/live/${encodeURIComponent(source.camera)}?${params}`;
  params.set("camera", source.camera);
  params.set("start", String(source.start));
  params.set("end", String(source.end));
  return `/api/clips/stream?${params}`;
}

// Resolves once the video is playing; keeps feeding MSE in the background
// until the stream ends or the signal aborts. Rejects on open failure.
export async function playInto(video: HTMLVideoElement, source: Source, signal: AbortSignal): Promise<void> {
  const response = await fetch(sourceUrl(source), { signal });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `${response.status} ${response.statusText}`);
  }
  const codec = response.headers.get("x-codec-string");
  const cacheHit = response.headers.get("x-cache") === "hit";
  if (cacheHit || !codec || !response.body || !MediaSource.isTypeSupported(`video/mp4; codecs="${codec}"`)) {
    await response.body?.cancel().catch(() => undefined);
    video.src = response.url;
    await video.play();
    return;
  }

  const mediaSource = new MediaSource();
  const objectUrl = URL.createObjectURL(mediaSource);
  video.src = objectUrl;
  signal.addEventListener("abort", () => URL.revokeObjectURL(objectUrl), { once: true });
  await new Promise<void>((resolve, reject) => {
    mediaSource.addEventListener("sourceopen", () => resolve(), { once: true });
    signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
  });
  const buffer = mediaSource.addSourceBuffer(`video/mp4; codecs="${codec}"`);
  const reader = response.body.getReader();
  const append = (chunk: Uint8Array): Promise<void> =>
    new Promise((resolve, reject) => {
      buffer.addEventListener("updateend", () => resolve(), { once: true });
      try {
        buffer.appendBuffer(chunk as BufferSource);
      } catch (error) {
        reject(error as Error);
      }
    });

  const first = await reader.read();
  if (first.done) throw new Error("stream ended before any video");
  await append(first.value);
  video.play().catch(() => undefined);

  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done || signal.aborted) break;
        await append(value);
      }
      if (!signal.aborted && mediaSource.readyState === "open") mediaSource.endOfStream();
    } catch {
      // aborted or the source went away; the caller's signal owns teardown
    }
  })();
}

export function resetVideo(video: HTMLVideoElement): void {
  video.pause();
  video.removeAttribute("src");
  video.load();
}

// Background save job (checks the clip cache first), then a browser download.
export async function saveRecording(
  source: Extract<Source, { kind: "recording" }>,
  onProgress: (label: string) => void
): Promise<void> {
  const job = await api("/api/clips", "POST", {
    body: {
      camera: source.camera,
      start: source.start,
      end: source.end,
      stream: source.stream,
      transcode: hevcSupported ? undefined : "h264",
    },
  });
  for (;;) {
    const current = await api("/api/clips/:id", "GET", { params: { id: job.id } });
    if (current.status === "ready" && current.videoUrl) {
      const stamp = new Date(source.start).toISOString().slice(0, 19).replaceAll(":", "");
      const link = document.createElement("a");
      link.href = current.videoUrl;
      link.download = `${source.camera}_${stamp}.mp4`;
      document.body.append(link);
      link.click();
      link.remove();
      return;
    }
    if (current.status === "failed") throw new Error(current.error ?? "save failed");
    onProgress(current.status === "queued" ? "Queued…" : `Saving ${Math.round(current.progress * 100)}%`);
    await sleep(1000);
  }
}
