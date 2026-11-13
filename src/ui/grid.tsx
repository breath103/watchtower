import { Settings } from "lucide-react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { memo, useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { type ApiResponse, api } from "./api.js";
import { EditNvrDialog } from "./nvr-edit.js";
import { setSearchParam } from "./router.js";
import { HOUR, SPANS, stamp, timeTicks } from "./time.js";

type NvrListEntry = ApiResponse<"/api/nvrs", "GET">["nvrs"][number];
type Camera = NvrListEntry["cameras"][number];

// A slot's image lands a few seconds after its boundary (grab + decode +
// upload), so live waits this long before moving to a new slot.
const LIVE_DELAY_MS = 10_000;
const SCRUB_DEBOUNCE_MS = 300;

const slotOf = (ms: number, every: number): number => Math.floor(ms / 1000 / every) * every;

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

export function CameraGrid() {
  const [nvrs, setNvrs] = useState<NvrListEntry[] | null>(null);
  const [span, setSpan] = useState(HOUR);
  const [t, setT] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => void api("/api/nvrs", "GET").then(result => setNvrs(result.nvrs)), []);

  useEffect(() => {
    reload();
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const shown = useDebounced(t, SCRUB_DEBOUNCE_MS);
  const slotFor = (camera: Camera): number | null =>
    camera.thumbnail ? slotOf(shown === null ? now - LIVE_DELAY_MS : shown, camera.thumbnail.every) : null;

  return (
    <div className="relative min-h-[calc(100vh-3.5rem)]">
      <main className="px-6 pt-6 pb-36">
        {error ? <p className="mb-4 text-sm text-destructive">{error}</p> : null}
        {nvrs === null ? null : nvrs.length === 0 ? (
          <p className="py-24 text-center text-sm text-muted-foreground">No NVRs connected.</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(520px,1fr))] gap-x-4 gap-y-6">
            {nvrs.map(nvr => (
              <section key={nvr.id} className="group/nvr flex flex-col gap-2">
                <div className="flex h-7 items-center gap-2">
                  <h2 className="truncate text-sm font-medium">{nvr.name}</h2>
                  <span className="text-sm text-muted-foreground">{nvr.id}</span>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="opacity-0 transition-opacity group-hover/nvr:opacity-100 focus-visible:opacity-100"
                    aria-label={`${nvr.name} settings`}
                    onClick={() => setEditing(nvr.id)}
                  >
                    <Settings />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-border ring-1 ring-border">
                  {nvr.cameras.map(camera => (
                    <CameraCard key={camera.id} camera={camera} slot={slotFor(camera)} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
      <TimeBar span={span} onSpan={setSpan} t={t} now={now} onChange={setT} />
      <EditNvrDialog
        nvrId={editing}
        onClose={() => setEditing(null)}
        onChanged={() => {
          setEditing(null);
          setError(null);
          reload();
        }}
        onError={failure => setError(String(failure))}
      />
    </div>
  );
}

// The last settled image stays up while the next slot loads in a hidden img,
// so scrubbing never blanks the card.
const CameraCard = memo(function CameraCard({ camera, slot }: { camera: Camera; slot: number | null }) {
  const [settled, setSettled] = useState<{ slot: number; ok: boolean } | null>(null);
  const src = (value: number): string => `/api/thumbnails/${encodeURIComponent(camera.id)}/${value}`;
  const loading = slot !== null && settled?.slot !== slot;

  return (
    <button
      type="button"
      className="group relative block aspect-video overflow-hidden bg-card text-left"
      onClick={() => setSearchParam("camera", camera.id)}
    >
      {slot !== null && settled?.ok ? (
        <img src={src(settled.slot)} alt={camera.name} className="size-full object-cover" draggable={false} />
      ) : null}
      {loading ? (
        <img
          key={slot}
          src={src(slot)}
          alt=""
          className="hidden"
          onLoad={() => setSettled({ slot, ok: true })}
          onError={() => setSettled({ slot, ok: false })}
        />
      ) : null}
      {slot === null || (settled && !settled.ok) ? (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          {slot === null ? "Capture off" : "No snapshot"}
        </div>
      ) : null}
      <span className="absolute top-2 left-2 max-w-[calc(100%-1rem)] truncate rounded-md bg-black/55 px-2 py-0.5 text-sm text-white backdrop-blur-md">
        {camera.name}
      </span>
      <span className="pointer-events-none absolute inset-0 ring-2 ring-transparent ring-inset transition group-hover:ring-foreground/40" />
    </button>
  );
});

function TimeBar({
  span,
  onSpan,
  t,
  now,
  onChange,
}: {
  span: number;
  onSpan: (span: number) => void;
  t: number | null;
  now: number;
  onChange: (t: number | null) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const start = now - span;
  const at = t === null ? now : Math.max(start, t);
  const pct = (value: number): string => `${((value - start) / span) * 100}%`;

  const timeAt = (clientX: number): number | null => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return t;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return ratio >= 0.995 ? null : Math.round(start + ratio * span);
  };

  return (
    <div className="fixed inset-x-0 bottom-4 z-30 flex justify-center px-4">
      <div className="flex w-full max-w-[1200px] items-center gap-4 rounded-2xl border bg-background/85 px-3 py-2.5 backdrop-blur-xl">
        <div className="flex shrink-0 rounded-lg bg-accent/60 p-0.5">
          {SPANS.map(option => (
            <button
              key={option.label}
              type="button"
              className={cn(
                "h-8 rounded-md px-2.5 text-sm font-medium transition-colors",
                span === option.ms ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
              onClick={() => onSpan(option.ms)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div
          ref={trackRef}
          role="slider"
          aria-label="Time"
          aria-valuemin={start}
          aria-valuemax={now}
          aria-valuenow={at}
          aria-valuetext={t === null ? "Live" : stamp(at)}
          tabIndex={0}
          className="relative h-11 min-w-0 flex-1 cursor-ew-resize touch-none outline-none select-none"
          onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            onChange(timeAt(event.clientX));
          }}
          onPointerMove={event => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) onChange(timeAt(event.clientX));
          }}
          onKeyDown={event => {
            const delta = event.shiftKey ? 10 * 60_000 : 60_000;
            if (event.key === "ArrowLeft") onChange(Math.max(start, at - delta));
            else if (event.key === "ArrowRight") onChange(at + delta >= now ? null : at + delta);
            else return;
            event.preventDefault();
          }}
        >
          <div className="absolute inset-x-0 top-3 h-1 rounded-full bg-accent" />
          <div className="absolute top-3 left-0 h-1 rounded-full bg-brand" style={{ width: pct(at) }} />
          <div
            className="absolute top-3.5 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-brand"
            style={{ left: pct(at) }}
          />
          {timeTicks(start, now).map(({ t: tick, label }) => (
            <span
              key={tick}
              className={cn(
                "absolute top-6 text-sm whitespace-nowrap text-muted-foreground tabular-nums",
                (tick - start) / span > 0.96 ? "-translate-x-full" : "-translate-x-1/2"
              )}
              style={{ left: pct(tick) }}
            >
              {label}
            </span>
          ))}
        </div>

        <button
          type="button"
          className="flex shrink-0 items-center gap-2.5 rounded-xl bg-accent/60 px-3 py-1.5 text-left transition-colors hover:bg-accent"
          onClick={() => onChange(null)}
          title={t === null ? "Live" : "Back to live"}
        >
          <span
            className={cn("size-2 rounded-full", t === null ? "animate-pulse bg-live" : "bg-muted-foreground/50")}
          />
          <span className="flex flex-col">
            <span className="text-sm font-medium tabular-nums">{stamp(at)}</span>
            <span className="text-sm text-muted-foreground">{t === null ? "Live" : "Back to live"}</span>
          </span>
        </button>
      </div>
    </div>
  );
}
