import { ChevronLeft, ChevronRight, Download, Play, Square } from "lucide-react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

import { type ApiResponse, api } from "./api.js";
import { CameraGrid } from "./grid.js";
import { setSearchParam, useSearchParam } from "./router.js";
import { clock, HOUR, SPANS, stamp, timeTicks } from "./time.js";
import { playInto, resetVideo, type Source, saveRecording } from "./viewport.js";

type NvrListEntry = ApiResponse<"/api/nvrs", "GET">["nvrs"][number];

interface Span {
  start: number;
  end: number;
}
type Mode = { kind: "idle" } | { kind: "live" } | { kind: "recording"; start: number; end: number; recEnd: number };

const CHUNK_MS = 10 * 60_000;
const STALE_MS = 10 * 60_000;
const BUCKETS = 240;

function latestAtOrBefore(sorted: number[], t: number): number | null {
  let lo = 0;
  let hi = sorted.length - 1;
  let found: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const value = sorted[mid] ?? 0;
    if (value <= t) {
      found = value;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

export function WatchPage() {
  const cameraId = useSearchParam("camera");
  return (
    <>
      <CameraGrid />
      <Dialog open={cameraId !== ""} onOpenChange={open => !open && setSearchParam("camera", null)}>
        <DialogContent className="flex h-[90vh] w-[95vw] max-w-[1400px] flex-col gap-4 p-5 sm:max-w-[1400px]">
          {cameraId ? <CameraView key={cameraId} cameraId={cameraId} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function CameraView({ cameraId }: { cameraId: string }) {
  const [nvrs, setNvrs] = useState<NvrListEntry[]>([]);
  const [stream, setStream] = useState("");
  const [span, setSpan] = useState(24 * HOUR);
  const [pinnedEnd, setPinnedEnd] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now);
  const [cursor, setCursor] = useState<number | null>(null);
  const [thumbs, setThumbs] = useState<number[]>([]);
  const [recordings, setRecordings] = useState<Span[]>([]);
  const [mode, setMode] = useState<Mode>({ kind: "idle" });
  const [phase, setPhase] = useState<{ text: string; error: boolean }>({ text: "", error: false });
  const [saveLabel, setSaveLabel] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const nvr = nvrs.find(entry => entry.cameras.some(camera => camera.id === cameraId)) ?? null;
  const camera = nvr?.cameras.find(entry => entry.id === cameraId) ?? null;
  const end = pinnedEnd ?? now;
  const start = end - span;
  const at = cursor ?? end;

  useEffect(() => {
    void api("/api/nvrs", "GET").then(({ nvrs: all }) => setNvrs(all));
  }, []);

  useEffect(() => {
    if (nvr && !nvr.streams.some(option => option.id === stream)) setStream(nvr.streams[0]?.id ?? "");
  }, [nvr, stream]);

  useEffect(() => {
    if (pinnedEnd !== null) return;
    const timer = setInterval(() => setNow(Date.now()), mode.kind === "live" ? 1000 : 15_000);
    return () => clearInterval(timer);
  }, [pinnedEnd, mode.kind]);

  const thumbsKey = `${cameraId}:${Math.floor(start / 15_000)}:${Math.floor(end / 15_000)}`;
  useEffect(() => {
    if (!cameraId) return;
    const from = Math.floor(start / 1000);
    const to = Math.ceil(end / 1000);
    void api("/api/thumbnails", "GET", { query: { camera: cameraId, from, to } }).then(
      index => setThumbs(index.ts.map(ts => ts * 1000)),
      () => setThumbs([])
    );
  }, [thumbsKey]);

  const recordingsKey = `${nvr?.id}:${cameraId}:${span}:${Math.floor(end / 60_000)}`;
  useEffect(() => {
    if (!nvr?.capabilities.recordings || !cameraId) {
      setRecordings([]);
      return;
    }
    let cancelled = false;
    void api("/api/timeline", "GET", { query: { nvr: nvr.id, from: start, to: end } }).then(
      response => {
        if (!cancelled) setRecordings(response.cameras.find(c => c.camera === cameraId)?.recordings ?? []);
      },
      error => {
        if (!cancelled) setPhase({ text: String(error), error: true });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [recordingsKey]);

  const source: Source | null = useMemo(() => {
    if (!cameraId || !stream) return null;
    if (mode.kind === "live") return { kind: "live", camera: cameraId, stream };
    if (mode.kind === "recording")
      return { kind: "recording", camera: cameraId, stream, start: mode.start, end: mode.end };
    return null;
  }, [cameraId, stream, mode]);
  const sourceKey = source ? JSON.stringify(source) : "";

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !source) return;
    const controller = new AbortController();
    setPhase({ text: "Connecting…", error: false });
    playInto(video, source, controller.signal).then(
      () => setPhase({ text: source.kind === "live" ? "Live" : "Playing recording", error: false }),
      error => {
        if (controller.signal.aborted) return;
        setPhase({ text: error instanceof Error ? error.message : String(error), error: true });
      }
    );
    return () => {
      controller.abort();
      resetVideo(video);
    };
  }, [sourceKey]);

  const recordingAt = (t: number): Span | null => recordings.find(rec => rec.start <= t && t < rec.end) ?? null;
  const current = recordingAt(at);
  const thumb = latestAtOrBefore(thumbs, at);

  const seek = useCallback((t: number): void => {
    setMode({ kind: "idle" });
    setPhase({ text: "", error: false });
    setCursor(t);
  }, []);

  const playAt = (t: number): void => {
    const rec = recordingAt(t);
    if (!rec || !nvr?.capabilities.playback) return;
    setCursor(t);
    setMode({ kind: "recording", start: t, end: Math.min(rec.end, t + CHUNK_MS), recEnd: rec.end });
  };

  const goLive = (): void => {
    setPinnedEnd(null);
    setNow(Date.now());
    setCursor(null);
    setMode(nvr?.capabilities.live ? { kind: "live" } : { kind: "idle" });
  };

  const shift = (direction: -1 | 1): void => {
    const nextEnd = end + direction * span;
    if (nextEnd >= Date.now()) {
      setPinnedEnd(null);
      setNow(Date.now());
    } else setPinnedEnd(nextEnd);
    seek(Math.min(Date.now(), at + direction * span));
  };

  const playing = mode.kind !== "idle";
  const caption =
    mode.kind === "live"
      ? "Live"
      : mode.kind === "recording"
        ? "Recording"
        : thumb !== null
          ? `Thumbnail ${clock(thumb)}${at - thumb > STALE_MS ? ` · ${Math.round((at - thumb) / 60_000)} min before cursor` : ""}`
          : "No thumbnail at this time";

  return (
    <>
      <div className="flex items-center gap-3 pr-8">
        <div className="flex min-w-0 items-baseline gap-2">
          <DialogTitle className="truncate text-lg font-semibold tracking-tight">
            {camera?.name ?? "No camera"}
          </DialogTitle>
          {nvr ? (
            <DialogDescription className="truncate text-sm text-muted-foreground">{nvr.name}</DialogDescription>
          ) : null}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {mode.kind === "recording" && source?.kind === "recording" ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={saveLabel !== null}
              onClick={() => {
                setSaveLabel("Queued…");
                saveRecording(source, setSaveLabel)
                  .catch(error => setPhase({ text: `Save failed: ${String(error)}`, error: true }))
                  .finally(() => setSaveLabel(null));
              }}
            >
              <Download />
              {saveLabel ?? "Save clip"}
            </Button>
          ) : null}
          {nvr && nvr.streams.length > 1 ? (
            <Select value={stream} onValueChange={setStream}>
              <SelectTrigger aria-label="Stream" className="h-8 w-auto">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {nvr.streams.map(option => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl bg-black ring-1 ring-border">
        <video
          ref={videoRef}
          className={cn("absolute inset-0 size-full object-contain", !playing && "invisible")}
          playsInline
          muted
          onTimeUpdate={event => {
            if (mode.kind !== "recording") return;
            setCursor(Math.min(mode.end, mode.start + event.currentTarget.currentTime * 1000));
          }}
          onEnded={() => {
            if (mode.kind !== "recording") return;
            if (mode.end < mode.recEnd) {
              setMode({ ...mode, start: mode.end, end: Math.min(mode.recEnd, mode.end + CHUNK_MS) });
            } else setMode({ kind: "idle" });
          }}
        />
        {!playing && thumb !== null && cameraId ? (
          <img
            src={`/api/thumbnails/${encodeURIComponent(cameraId)}/${Math.round(thumb / 1000)}`}
            alt=""
            draggable={false}
            className={cn("absolute inset-0 size-full object-contain", at - thumb > STALE_MS && "opacity-50")}
          />
        ) : null}
        {!playing && thumb === null ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            No thumbnail at this time
          </div>
        ) : null}
        {!playing && current && nvr?.capabilities.playback ? (
          <button
            type="button"
            className="group absolute inset-0 flex items-center justify-center"
            onClick={() => playAt(at)}
          >
            <span className="flex items-center gap-2.5 rounded-full bg-black/55 py-3 pr-6 pl-5 text-sm font-medium text-white ring-1 ring-white/15 backdrop-blur-md transition group-hover:scale-105 group-hover:bg-black/70">
              <Play className="size-5 fill-current" />
              Play from {clock(at)}
            </span>
          </button>
        ) : null}
        <div className="pointer-events-none absolute top-3 left-3 flex items-center gap-2 rounded-md bg-black/55 px-2.5 py-1 text-sm text-white backdrop-blur-md">
          {mode.kind === "live" ? <span className="size-1.5 animate-pulse rounded-full bg-live" /> : null}
          {caption}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {nvr?.capabilities.live ? (
          <button
            type="button"
            className={cn(
              "flex h-8 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors",
              mode.kind === "live"
                ? "bg-live/15 text-live"
                : "border border-input text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
            onClick={() => (mode.kind === "live" ? seek(Date.now()) : goLive())}
          >
            <span className={cn("size-1.5 rounded-full bg-live", mode.kind === "live" && "animate-pulse")} />
            Live
          </button>
        ) : null}
        {mode.kind === "recording" ? (
          <Button size="sm" variant="outline" onClick={() => seek(at)}>
            <Square className="fill-current" />
            Stop
          </Button>
        ) : (
          <Button size="sm" variant="outline" disabled={!current} onClick={() => playAt(at)}>
            <Play className="fill-current" />
            Play
          </Button>
        )}
        <span className="ml-1 text-sm font-medium tabular-nums">{stamp(mode.kind === "live" ? now : at)}</span>
        {phase.text && phase.text !== "Live" ? (
          <span className={cn("truncate text-sm text-muted-foreground", phase.error && "text-destructive")}>
            {phase.text}
          </span>
        ) : null}

        <div className="ml-auto flex items-center gap-1">
          <div className="flex rounded-lg border border-input p-0.5">
            {SPANS.map(option => (
              <button
                key={option.label}
                type="button"
                className={cn(
                  "h-7 rounded-md px-2.5 text-sm font-medium transition-colors",
                  span === option.ms ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => {
                  setSpan(option.ms);
                  if (cursor !== null && pinnedEnd !== null && cursor < pinnedEnd - option.ms) {
                    setPinnedEnd(Math.min(Date.now(), cursor + option.ms / 2));
                  }
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
          <Button size="icon-sm" variant="ghost" title="Earlier" onClick={() => shift(-1)}>
            <ChevronLeft />
          </Button>
          <Button size="icon-sm" variant="ghost" title="Later" disabled={pinnedEnd === null} onClick={() => shift(1)}>
            <ChevronRight />
          </Button>
        </div>
      </div>

      <TimelineBar
        start={start}
        end={end}
        at={mode.kind === "live" ? now : at}
        live={mode.kind === "live"}
        thumbs={thumbs}
        recordings={recordings}
        onSeek={seek}
        onPlay={playAt}
      />
    </>
  );
}

function TimelineBar({
  start,
  end,
  at,
  live,
  thumbs,
  recordings,
  onSeek,
  onPlay,
}: {
  start: number;
  end: number;
  at: number;
  live: boolean;
  thumbs: number[];
  recordings: Span[];
  onSeek: (t: number) => void;
  onPlay: (t: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const span = Math.max(1, end - start);
  const pct = (t: number): string => `${((t - start) / span) * 100}%`;

  const counts = new Array<number>(BUCKETS).fill(0);
  for (const ts of thumbs) {
    const bucket = Math.floor(((ts - start) / span) * BUCKETS);
    if (bucket >= 0 && bucket < BUCKETS) counts[bucket] = (counts[bucket] ?? 0) + 1;
  }
  const peak = Math.max(1, ...counts);

  const ticks = timeTicks(start, end);

  const timeAt = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return at;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.round(start + ratio * span);
  };

  return (
    <div className="flex flex-col gap-1.5 select-none">
      <div
        ref={trackRef}
        role="slider"
        aria-label="Time"
        aria-valuemin={start}
        aria-valuemax={end}
        aria-valuenow={at}
        aria-valuetext={stamp(at)}
        tabIndex={0}
        className="relative h-16 cursor-ew-resize touch-none rounded-lg bg-accent outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          onSeek(timeAt(event.clientX));
        }}
        onPointerMove={event => {
          const t = timeAt(event.clientX);
          setHover(t);
          if (event.currentTarget.hasPointerCapture(event.pointerId)) onSeek(t);
        }}
        onPointerLeave={() => setHover(null)}
        onDoubleClick={event => onPlay(timeAt(event.clientX))}
        onKeyDown={event => {
          const delta = event.shiftKey ? 10 * 60_000 : 60_000;
          if (event.key === "ArrowLeft") onSeek(Math.max(start, at - delta));
          else if (event.key === "ArrowRight") onSeek(Math.min(end, at + delta));
          else if (event.key === "Enter" || event.key === " ") onPlay(at);
          else return;
          event.preventDefault();
        }}
      >
        <div className="absolute inset-x-0 top-0 bottom-1/2 overflow-hidden rounded-t-lg">
          {recordings.map(rec => (
            <div
              key={rec.start}
              title={`Recording ${clock(rec.start)}–${clock(rec.end)}`}
              className="absolute top-1/2 h-3 min-w-[3px] -translate-y-1/2 rounded-full bg-brand/70"
              style={{ left: pct(rec.start), width: `${((rec.end - rec.start) / span) * 100}%` }}
            />
          ))}
        </div>
        <div className="absolute inset-x-0 top-1/2 bottom-0 flex items-end gap-px overflow-hidden rounded-b-lg px-px">
          {counts.map((count, i) => (
            <div
              key={i}
              className="flex-1 rounded-t-[2px] bg-foreground/25"
              style={{ height: count === 0 ? 0 : `${20 + (count / peak) * 80}%` }}
            />
          ))}
        </div>
        {hover !== null ? (
          <div className="pointer-events-none absolute inset-y-0 w-px bg-foreground/30" style={{ left: pct(hover) }}>
            <span className="absolute top-full z-10 mt-1 left-1/2 -translate-x-1/2 rounded-md bg-popover px-2 py-0.5 text-sm whitespace-nowrap tabular-nums ring-1 ring-border">
              {stamp(hover)}
            </span>
          </div>
        ) : null}
        <div
          className={cn(
            "pointer-events-none absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full",
            live ? "bg-live" : "bg-foreground"
          )}
          style={{ left: pct(Math.min(end, Math.max(start, at))) }}
        >
          <div className="absolute -top-1 left-1/2 size-3 -translate-x-1/2 rounded-full border-2 border-background bg-inherit" />
        </div>
      </div>
      <div className="relative h-5">
        {ticks.map(({ t, label }) => (
          <span
            key={t}
            className={cn(
              "absolute text-sm whitespace-nowrap text-muted-foreground tabular-nums",
              (t - start) / span < 0.04 ? "" : (t - start) / span > 0.96 ? "-translate-x-full" : "-translate-x-1/2"
            )}
            style={{ left: pct(t) }}
          >
            {label}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-4 text-sm text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-full bg-brand/70" />
          Recordings
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-sm bg-foreground/25" />
          Thumbnails
        </span>
        <span className="ml-auto">Drag to scrub · double-click a recording to play</span>
      </div>
    </div>
  );
}
