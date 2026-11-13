import fs from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";

import { ClipCache } from "./clip-cache.js";
import { loadConfig } from "./config.js";
import { createRegistry } from "./connectors/index.js";
import { createLogger } from "./core/logger.js";
import { Database } from "./db/index.js";
import { createApp } from "./http.js";
import { createAuth } from "./services/auth.js";
import { ClipService } from "./services/clips.js";
import { LogFiles } from "./services/log-files.js";
import { ConnectionPool } from "./services/pool.js";
import { StorageHub } from "./services/storage-hub.js";
import { ThumbnailService } from "./services/thumbnails.js";
import { TimelineService } from "./services/timeline.js";

const LOG_RETENTION_DAYS = 7;
const LOG_PRUNE_INTERVAL_MS = 60 * 60 * 1000;

async function main(): Promise<void> {
  const startedAt = Date.now();
  const { config, source } = loadConfig(process.argv.slice(2));
  const registry = createRegistry();
  fs.mkdirSync(config.workDir, { recursive: true });
  const logFiles = new LogFiles({ dir: path.join(config.workDir, "logs"), retentionDays: LOG_RETENTION_DAYS });
  const logger = createLogger(entry => logFiles.write(entry));
  const serverLogger = logger.with({ scope: "server" });
  serverLogger.log({ level: "info", message: "config loaded", source });
  const pruneLogs = (): void => {
    logFiles.prune(Date.now()).catch((error: unknown) => {
      serverLogger.log({ level: "error", message: "log retention failed", error });
    });
  };
  pruneLogs();
  const pruneTimer = setInterval(pruneLogs, LOG_PRUNE_INTERVAL_MS);
  const db = new Database(path.join(config.workDir, "watchtower.db"));

  if (!db.getStorage("default")) {
    db.upsertStorage({ id: "default", type: "file", config: { root: path.join(config.workDir, "thumbs") } });
    db.setSetting("defaultStorage", "default");
  }
  const hub = new StorageHub({ db, registry, logger: logger.with({ scope: "storage" }) });
  hub.refresh();

  const pool = new ConnectionPool({ db, registry, logger });
  const timeline = new TimelineService({ db, pool });
  const cache = new ClipCache(path.join(config.workDir, "cache", "clips"));
  await cache.cleanup();
  const clips = new ClipService({
    db,
    pool,
    workDir: config.workDir,
    cache,
    logger: logger.with({ scope: "clips" }),
  });
  const thumbnails = new ThumbnailService({
    db,
    pool,
    hub,
    workDir: config.workDir,
    logger: logger.with({ scope: "thumbnails" }),
  });
  await thumbnails.backfill();
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
    logger,
    logFiles,
  });

  const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, () => {
    serverLogger.log({ level: "info", message: "listening on", url: `http://${config.host}:${config.port}` });
    serverLogger.log({
      level: "info",
      message: "nvrs registered",
      count: nvrs.length,
      nvrs: nvrs.map(nvr => nvr.id).join(", "),
    });
    serverLogger.log({ level: "info", message: "thumbnail capture", enabled: thumbnailsEnabled });
  });

  const shutdown = (): void => {
    serverLogger.log({ level: "info", message: "shutting down" });
    clearInterval(pruneTimer);
    thumbnails.stop();
    thumbnails.stopRetention();
    pool.closeAll();
    db.close();
    server.close();
    void logFiles.close();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((error: unknown) => {
  createLogger(null).log({
    level: "error",
    message: "startup failed",
    error,
    stack: error instanceof Error ? (error.stack ?? null) : null,
  });
  process.exit(1);
});
