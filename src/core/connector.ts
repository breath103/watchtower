// The connector contract. A connector = one NVR vendor protocol: it knows how
// to authenticate, discover cameras, list recordings, and deliver NORMALIZED
// raw video frames. Everything above frames (ffmpeg packaging, clip pumps,
// thumbnails, job muxing) lives in vendor-agnostic services.
//
// Two rules every connector follows:
// - Time is UTC epoch milliseconds, in and out. A device that speaks local
//   wall-clock time converts at the connector boundary (see core/time.ts).
// - Cameras are addressed by Watchtower camera id only. The connector maps an
//   id to its own device reference through the camera's `metadata`, which it
//   produced itself in `discoverCameras`.

import type { z } from "zod";

import type { Observable } from "./observable.js";
import type { Codec } from "./types.js";

// One unit of video off the wire. `header` frames carry parameter sets
// (SPS/PPS/VPS); `frame` frames are Annex-B chunks with a keyframe flag.
export interface RawFrame {
  kind: "header" | "frame";
  codec: Codec;
  data: Buffer;
  // Capture time, UTC epoch ms. null only when the device hasn't told us yet.
  timestampMs: number | null;
  key: boolean;
}

export interface VideoSubscription {
  frames: Observable<RawFrame>;
  // Resolves once the stream is actually open; rejects if the open fails
  // (unknown camera, device refusal) so callers can 5xx instead of hanging.
  opened: Promise<void>;
  // Release the stream. Sharing one device stream between subscribers and
  // closing it on the last stop() is the connector's responsibility.
  stop(): void;
}

// A recorded span of video. UTC epoch ms, end exclusive.
export interface Recording {
  cameraId: string;
  start: number;
  end: number;
}

export interface DiscoveredCamera {
  // Stable per device; used to derive the Watchtower camera id on save.
  key: string;
  name: string;
  metadata: Record<string, unknown>;
}

export interface ConnectionStatus {
  connected: boolean;
  error: string | null;
  usedAt: number;
  liveCameras: string[];
}

export interface StreamOptions {
  // One of the connector's `streams` ids; the connector's first stream when omitted.
  stream?: string;
}

export interface ConnectorConnection {
  // Cheap credential/liveness check on a throwaway socket.
  test(): Promise<{ ok: boolean; model?: string; error?: string }>;
  discoverCameras(): Promise<DiscoveredCamera[]>;
  subscribeLive(cameraId: string, opts?: StreamOptions): VideoSubscription;
  // Recorded video starting at or before `startMs`; services cut the exact
  // window from frame timestamps.
  subscribePlayback(cameraId: string, startMs: number, opts?: StreamOptions): VideoSubscription;
  // Recordings overlapping [fromMs, toMs), clipped to that range.
  listRecordings(cameraIds: string[], fromMs: number, toMs: number): Promise<Recording[]>;
  // A JPEG still, when the device has a cheaper path than decoding live video.
  snapshot?(cameraId: string): Promise<Buffer | null>;
  status(): ConnectionStatus;
  close(): void;
}

export interface ConnectorContext {
  log: (line: string) => void;
  // Cameras registered for this NVR (empty during the connect wizard).
  cameras: Array<{ id: string; metadata: Record<string, unknown> }>;
}

interface StreamOption {
  id: string;
  label: string;
}

export interface ConnectorDef<Config = unknown> {
  id: string;
  title: string;
  description?: string;
  connectionConfigSchema: z.ZodType<Config>;
  capabilities: { live: boolean; playback: boolean; recordings: boolean };
  // Selectable streams per camera (e.g. main/sub). The first is the default.
  streams: [StreamOption, ...StreamOption[]];
  create(config: Config, ctx: ConnectorContext): ConnectorConnection;
}

export function defineConnector<Config>(def: ConnectorDef<Config>): ConnectorDef<Config> {
  return def;
}
