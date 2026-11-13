import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import type { ConnectorConnection, ConnectorDef } from "../core/connector.js";
import type { CameraRecord, Tag } from "../core/types.js";
import type { Database, ThumbnailConfig } from "../db/index.js";
import type { ClipJob } from "../services/clips.js";
import type { ConnectionPool } from "../services/pool.js";

interface JsonSchemaProp {
  type?: string;
  description?: string;
  default?: unknown;
}

export interface JsonObjectSchema {
  properties?: Record<string, JsonSchemaProp>;
  required?: string[];
}

export const jsonSchemaOf = (schema: z.ZodType): JsonObjectSchema => z.toJSONSchema(schema) as JsonObjectSchema;

export const clipQuery = {
  camera: z.string(),
  start: z.coerce.number().int(),
  end: z.coerce.number().int(),
  stream: z.string().optional(),
  transcode: z.enum(["h264"]).optional(),
};

export function checkClipRange(query: { start: number; end: number }): void {
  if (query.end <= query.start) throw new HTTPException(400, { message: "end must be after start" });
}

export const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const SECRET_KEY = /pass|secret|token/i;

export const redactSecrets = (config: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(config).filter(([key]) => !SECRET_KEY.test(key)));

// Updates replace the whole config, except that secrets are never sent to the
// browser: an empty or missing secret means "keep the stored one".
export const mergeConfig = (
  stored: Record<string, unknown>,
  incoming: Record<string, unknown>
): Record<string, unknown> => {
  const out = { ...incoming };
  for (const [key, value] of Object.entries(stored)) {
    if (SECRET_KEY.test(key) && (out[key] === "" || out[key] === undefined)) out[key] = value;
  }
  return out;
};

export const publicJob = (job: ClipJob) => ({
  id: job.id,
  nvr: job.nvr,
  camera: job.camera,
  start: job.start,
  end: job.end,
  stream: job.stream,
  status: job.status,
  progress: job.progress,
  error: job.error,
  createdAt: job.createdAt,
  videoUrl: job.status === "ready" ? `/api/clips/${job.id}/video.mp4` : null,
});

export const publicCamera = (camera: CameraRecord, cfg: ThumbnailConfig | undefined, tags: Tag[]) => ({
  id: camera.id,
  name: camera.name,
  tags,
  thumbnail: cfg?.enabled ? { every: cfg.frequencyS } : null,
});

// Within a tag type any listed value matches; every listed type must match.
const entityFilter = z.strictObject({ tags: z.record(z.string(), z.array(z.string()).min(1)).optional() });

export const camerasFilter = z.strictObject({ nvrs: entityFilter.optional(), cameras: entityFilter.optional() });

// The typed client JSON-encodes object query values (src/client.ts).
export const jsonQuery = <T extends z.ZodType>(schema: T) =>
  z
    .string()
    .transform((raw, ctx): unknown => {
      try {
        return JSON.parse(raw);
      } catch {
        ctx.addIssue({ code: "custom", message: "must be JSON" });
        return z.NEVER;
      }
    })
    .pipe(schema);

const matchesTags = (tags: Tag[], filter: Record<string, string[]> | undefined): boolean =>
  !filter || Object.entries(filter).every(([type, values]) => tags.some(t => t.type === type && values.includes(t.value)));

// With a camera filter, NVRs left with no matching cameras are dropped.
export function filterCameras<C extends { tags: Tag[] }, N extends { tags: Tag[]; cameras: C[] }>(
  nvrs: N[],
  filter: z.infer<typeof camerasFilter> | undefined
): N[] {
  if (!filter) return nvrs;
  return nvrs
    .filter(nvr => matchesTags(nvr.tags, filter.nvrs?.tags))
    .map(nvr => ({ ...nvr, cameras: nvr.cameras.filter(camera => matchesTags(camera.tags, filter.cameras?.tags)) }))
    .filter(nvr => !filter.cameras?.tags || nvr.cameras.length > 0);
}

export function cameraOpener(db: Database, pool: ConnectionPool) {
  return (
    cameraId: string,
    capability: keyof ConnectorDef["capabilities"],
    stream: string | undefined
  ): { camera: CameraRecord; conn: ConnectorConnection; stream: string } => {
    const camera = db.getCamera(cameraId);
    if (!camera) throw new HTTPException(404, { message: "camera not found" });
    const def = pool.connectorOf(camera.nvrId);
    const conn = pool.get(camera.nvrId);
    if (!def || !conn) throw new HTTPException(503, { message: "nvr not registered" });
    if (!def.capabilities[capability]) {
      throw new HTTPException(400, { message: `${def.title} does not support ${capability}` });
    }
    const chosen = stream ?? def.streams[0].id;
    if (!def.streams.some(option => option.id === chosen)) {
      throw new HTTPException(400, { message: `unknown stream: ${chosen}` });
    }
    return { camera, conn, stream: chosen };
  };
}
