import fs from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";

import { ClipCache } from "./clip-cache.js";
import { loadConfig } from "./config.js";
import { createRegistry } from "./connectors/index.js";
import { Database } from "./db/index.js";
import { createApp } from "./http.js";
import { createAuth } from "./services/auth.js";
import { ClipService } from "./services/clips.js";
import { ConnectionPool } from "./services/pool.js";
import { StorageHub } from "./services/storage-hub.js";
import { ThumbnailService } from "./services/thumbnails.js";
import { TimelineService } from "./services/timeline.js";

function log(message: string): void {
  console.log(`${new Date().toISOString().slice(11, 19)} ${message}`);
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const { config, source } = loadConfig(process.argv.slice(2));
  log(`config: ${source}`);
  const registry = createRegistry();
  fs.mkdirSync(config.workDir, { recursive: true });
  const db = new Database(path.join(config.workDir, "watchtower.db"));

  if (!db.getStorage("default")) {
    db.upsertStorage({ id: "default", type: "file", config: { root: path.join(config.workDir, "thumbs") } });
    db.setSetting("defaultStorage", "default");
  }
  const hub = new StorageHub({ db, registry, log });
  hub.refresh();

  const pool = new ConnectionPool({ db, registry, log });
  const timeline = new TimelineService({ db, pool });
  const cache = new ClipCache(path.join(config.workDir, "cache", "clips"));
  await cache.cleanup();
  const clips = new ClipService({ db, pool, workDir: config.workDir, cache, log });
  const thumbnails = new ThumbnailService({ db, pool, hub, workDir: config.workDir, log });
  const backfilled = await thumbnails.backfill();
  if (backfilled > 0) log(`thumbnails: indexed ${backfilled} stored image(s)`);
  const thumbnailsEnabled = db.getSetting("thumbnails.enabled") === "1";
  if (thumbnailsEnabled) thumbnails.start();
  thumbnails.startRetention();

  const nvrs = db.listNvrs();
  const app = createApp({
    auth: createAuth(db, config.admin),
    db,
    registry,
    pool,
    timeline,
    clips,
    cache,
    thumbnails,
    hub,
    startedAt,
    log,
  });

  const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, () => {
    log(`watchtower listening on http://${config.host}:${config.port}`);
    log(`${nvrs.length} nvr(s): ${nvrs.map(nvr => nvr.id).join(", ") || "(none — use Connect NVR)"}`);
    log(`storage: ${hub.get()?.label ?? "none configured"}`);
    log(`thumbnails: ${thumbnailsEnabled ? "on (30s window)" : "off"}`);
  });

  const shutdown = (): void => {
    log("shutting down");
    thumbnails.stop();
    thumbnails.stopRetention();
    pool.closeAll();
    db.close();
    server.close();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
