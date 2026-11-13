import { createReadStream } from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { type Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { stream } from "hono/streaming";
import { ZodError, z } from "zod";

import { cameraOpener, checkClipRange, clipQuery } from "./api/helpers.js";
import { mount } from "./api/route.js";
import { type ApiDeps, apiRoutes } from "./api/routes.js";
import { ClipCache, clipCacheKey } from "./clip-cache.js";
import { requireApiKey } from "./services/api-keys.js";
import { type ClipPumpInfo, type PackagedStream, startClipFmp4, startLiveFmp4 } from "./services/media.js";

type ClipCacheWriter = Awaited<ReturnType<ClipCache["begin"]>>;

async function* chunks(readable: Readable): AsyncGenerator<Buffer> {
  const queue: Buffer[] = [];
  let wake: (() => void) | null = null;
  const notify = (): void => {
    const resolve = wake;
    wake = null;
    resolve?.();
  };
  readable.on("data", (chunk: Buffer) => {
    queue.push(chunk);
    notify();
  });
  readable.on("end", notify);
  readable.on("error", notify);
  while ((!readable.readableEnded && !readable.destroyed) || queue.length > 0) {
    if (queue.length > 0) {
      for (const chunk of queue.splice(0)) yield chunk;
      continue;
    }
    await new Promise<void>(resolve => {
      wake = resolve;
    });
  }
}

async function videoResponse(c: Context, file: string, extraHeaders: Record<string, string> = {}): Promise<Response> {
  const stat = await fsp.stat(file);
  const range = c.req.header("range");
  const headers = {
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    ...extraHeaders,
  };

  if (!range) {
    for (const [key, value] of Object.entries(headers)) c.header(key, value);
    c.header("Content-Length", String(stat.size));
    return stream(c, async sink => {
      const read = createReadStream(file);
      try {
        for await (const chunk of read) {
          await sink.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
      } finally {
        read.destroy();
      }
    });
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) throw new HTTPException(416, { message: "invalid range" });
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Number(match[2]) : stat.size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || end >= stat.size) {
    throw new HTTPException(416, { message: "range out of bounds" });
  }

  const handle = await fsp.open(file);
  try {
    const body = Buffer.alloc(end - start + 1);
    await handle.read(body, 0, body.length, start);
    return c.body(body, 206, {
      ...headers,
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
      "Content-Length": String(body.length),
    });
  } finally {
    await handle.close();
  }
}

export function createApp(opts: ApiDeps & { cache: ClipCache }): Hono {
  const { auth, db, pool, clips, cache, hub, logger } = opts;
  const app = new Hono();
  const openCamera = cameraOpener(db, pool);

  const dist = path.join(import.meta.dirname, "..", "dist");
  const asset =
    (file: string, type: string) =>
    async (c: Context): Promise<Response> => {
      const body = await fsp.readFile(path.join(dist, file)).catch(() => null);
      if (!body) throw new HTTPException(500, { message: `dist/${file} missing — run npm run build:ui` });
      return c.body(body, 200, { "Content-Type": type, "Cache-Control": "no-store" });
    };

  const page = async (c: Context): Promise<Response> => {
    c.header("Cache-Control", "no-store");
    return c.html(await fsp.readFile(path.join(import.meta.dirname, "index.html"), "utf8"));
  };
  for (const route of ["/", "/settings", "/logs"]) app.get(route, page);
  app.get("/app.js", asset("app.js", "text/javascript; charset=utf-8"));
  app.get("/app.css", asset("app.css", "text/css; charset=utf-8"));

  const PUBLIC = new Set(["/api/session", "/api/login", "/api/logout"]);
  app.use("/api/*", (c, next) =>
    PUBLIC.has(c.req.path) || c.req.path.startsWith("/api/v1/") ? next() : auth.required(c, next)
  );

  app.get("/api/live/:cameraId", async c => {
    const { camera, conn, stream: chosen } = openCamera(c.req.param("cameraId"), "live", c.req.query("stream"));
    const subscription = conn.subscribeLive(camera.id, { stream: chosen });
    let live: PackagedStream;
    try {
      live = await startLiveFmp4(subscription, {
        transcode: c.req.query("transcode") === "h264",
        signal: c.req.raw.signal,
        logger: logger.with({ scope: "live", camera: camera.id }),
      });
    } catch (error) {
      subscription.stop();
      throw error;
    }
    c.header("Content-Type", "video/mp4");
    c.header("Cache-Control", "no-store");
    c.header("X-Codec", live.codec);
    if (live.codecString) c.header("X-Codec-String", live.codecString);
    return stream(c, async sink => {
      try {
        for await (const chunk of chunks(live.readable)) await sink.write(chunk);
      } finally {
        live.stop();
      }
    });
  });

  app.get("/api/clips/stream", async c => {
    const query = z.object(clipQuery).parse(c.req.query());
    checkClipRange(query);
    const { camera, conn, stream: chosen } = openCamera(query.camera, "playback", query.stream);

    const transcode = query.transcode === "h264";
    const clipLogger = logger.with({ scope: "clips", camera: camera.id });
    const cacheKey = clipCacheKey({
      nvr: camera.nvrId,
      camera: camera.id,
      start: query.start,
      end: query.end,
      stream: chosen,
      transcode,
    });
    const cached = await cache.get(cacheKey);
    if (cached) {
      return videoResponse(c, cached.file, { "X-Cache": "hit", "X-Codec": cached.codec });
    }

    // Create the cache tee BEFORE the pump starts. The cache entry is
    // finalized only on the pump's own `done` verdict: a fetch the browser cut
    // short is discarded, never cached as if it were complete.
    let cacheWriter: ClipCacheWriter | null = null;
    let teeFailed = false;
    try {
      cacheWriter = await cache.begin(cacheKey, transcode);
    } catch (error) {
      clipLogger.log({ level: "warn", message: "clip cache open failed", error });
    }
    const tee = cacheWriter;
    let info: ClipPumpInfo;
    try {
      const subscription = conn.subscribePlayback(camera.id, query.start, { stream: chosen });
      info = await startClipFmp4(subscription, {
        startMs: query.start,
        endMs: query.end,
        transcode,
        signal: c.req.raw.signal,
        tee: tee
          ? async (frame): Promise<void> => {
              try {
                await tee.feed(frame);
              } catch (error) {
                teeFailed = true;
                clipLogger.log({ level: "warn", message: "clip cache write failed", error });
              }
            }
          : undefined,
        logger: clipLogger,
      });
    } catch (error) {
      await tee?.abort().catch(() => undefined);
      throw error;
    }
    c.header("Content-Type", "video/mp4");
    c.header("Cache-Control", "no-store");
    c.header("X-Cache", tee ? "miss" : "off");
    c.header("X-Codec", info.codec);
    if (info.codecString) c.header("X-Codec-String", info.codecString);
    return stream(c, async sink => {
      try {
        for await (const chunk of chunks(info.readable)) await sink.write(chunk);
      } finally {
        // The pump's verdict is authoritative; bound the wait so a stalled
        // client can never hang this callback.
        const settled = await Promise.race([
          info.done,
          new Promise<boolean>(resolve => setTimeout(() => resolve(false), 2000)),
        ]);
        const complete = settled && !teeFailed;
        info.stop();
        if (tee) {
          if (complete) {
            await tee.finish().catch(error => {
              clipLogger.log({ level: "warn", message: "clip cache finalize failed", error });
            });
          } else {
            await tee.abort().catch(() => undefined);
          }
        }
      }
    });
  });

  app.get("/api/clips/:id/video.mp4", async c => {
    const job = clips.get(c.req.param("id"));
    if (!job) throw new HTTPException(404, { message: "clip not found" });
    if (job.status !== "ready" || !job.file) throw new HTTPException(409, { message: "clip is not ready" });
    return videoResponse(c, job.file);
  });

  app.get("/api/thumbnails/:cameraId/:ts", async c => {
    const cameraId = c.req.param("cameraId");
    const ts = Number(c.req.param("ts"));
    const storageId = db.getThumbnailStorage(cameraId, ts);
    const client = storageId ? hub.get(storageId)?.client : null;
    const body = client?.get ? await client.get(`${cameraId}/thumbnails/${ts}.jpeg`) : null;
    if (!body) throw new HTTPException(404, { message: "thumbnail not found" });
    return c.body(new Uint8Array(body), 200, {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
    });
  });

  app.use("/api/v1/*", requireApiKey(db));
  mount(app, apiRoutes({ ...opts, logger: logger.with({ scope: "api" }) }));

  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      if (error.res) return error.getResponse();
      return c.json({ error: { code: "http_error", message: error.message } }, error.status);
    }
    if (error instanceof ZodError) {
      return c.json({ error: { code: "bad_request", message: z.prettifyError(error) } }, 400);
    }
    logger.log({
      level: "error",
      scope: "api",
      message: "request failed",
      method: c.req.method,
      path: c.req.path,
      error,
      stack: error.stack ?? null,
    });
    return c.json({ error: { code: "internal", message: error.message } }, 500);
  });

  return app;
}
