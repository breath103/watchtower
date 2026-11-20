// Thumbnail scheduler. Each camera has its own config in sqlite (enabled,
// target storage, frequency). Captures land on epoch-aligned slots
// (ts % frequency === 0, UTC seconds) and are stored under the slot's ts, so a
// reader that knows a camera's frequency can compute every key without
// listing. Storages that declare retentionDays (local files) get old
// thumbnails deleted hourly; others (S3) expire objects on their own.

import fs from "node:fs/promises";
import path from "node:path";

import type { ConnectorConnection } from "../core/connector.js";
import type { Logger } from "../core/logger.js";
import type { Codec } from "../core/types.js";
import type { Database } from "../db/index.js";
import { decodeKeyframe } from "../ffmpeg.js";
import { grabKeyframe } from "./media.js";
import type { ConnectionPool } from "./pool.js";
import type { StorageHub } from "./storage-hub.js";

const MASTER_TICK_MS = 1_000;
const GRAB_TIMEOUT_MS = 5_000;
const RETENTION_INTERVAL_MS = 60 * 60 * 1000;

export const thumbnailSlot = (nowMs: number, frequencyS: number): number =>
  Math.floor(nowMs / 1000 / frequencyS) * frequencyS;

export interface CameraThumbState {
  camera: string;
  lastTs: number | null;
  ok: boolean;
  error: string | null;
}

export interface ThumbnailInfo {
  lastRun: number | null;
  lastError: string | null;
  target: string;
  cameras: CameraThumbState[];
}

interface DueConfig {
  cameraId: string;
  storageId: string | null;
  slot: number;
  every: number;
}

export class ThumbnailService {
  private timer: NodeJS.Timeout | null = null;
  private retentionTimer: NodeJS.Timeout | null = null;
  private running = false;
  private applyingRetention = false;
  private lastRun: number | null = null;
  private lastError: string | null = null;
  private readonly thumbState = new Map<string, CameraThumbState>();
  private readonly lastSlot = new Map<string, number>();

  constructor(
    private readonly opts: {
      db: Database;
      pool: ConnectionPool;
      hub: StorageHub;
      workDir: string;
      logger: Logger;
    }
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, MASTER_TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get enabled(): boolean {
    return this.timer !== null;
  }

  startRetention(): void {
    if (this.retentionTimer) return;
    void this.applyRetention();
    this.retentionTimer = setInterval(() => {
      void this.applyRetention();
    }, RETENTION_INTERVAL_MS);
  }

  stopRetention(): void {
    if (this.retentionTimer) clearInterval(this.retentionTimer);
    this.retentionTimer = null;
  }

  async applyRetention(): Promise<number> {
    if (this.applyingRetention) return 0;
    this.applyingRetention = true;
    let removed = 0;
    try {
      for (const record of this.opts.db.listStorages()) {
        const client = this.opts.hub.get(record.id)?.client;
        if (!client?.retentionDays || !client.delete) continue;
        const cutoff = Math.floor(Date.now() / 1000) - client.retentionDays * 86_400;
        for (const run of this.opts.db.thumbnailRunsBefore(record.id, cutoff)) {
          for (let ts = run.start; ts < cutoff && ts <= run.end; ts += run.every) {
            await client.delete(`${run.cameraId}/thumbnails/${ts}.jpeg`);
            removed++;
          }
          this.opts.db.trimThumbnailRun(run, cutoff);
        }
      }
      if (removed > 0) this.opts.logger.log({ level: "info", message: "deleted thumbnails past retention", removed });
    } catch (error) {
      this.opts.logger.log({ level: "error", message: "retention failed", error });
    } finally {
      this.applyingRetention = false;
    }
    return removed;
  }

  async backfill(): Promise<void> {
    for (const record of this.opts.db.listStorages()) {
      const list = this.opts.hub.get(record.id)?.client.list;
      if (!list) continue;
      const started = Date.now();
      try {
        const counts = await Promise.all(
          this.opts.db.listThumbnailConfigs().map(async cfg => {
            const slots = (await list(`${cfg.cameraId}/thumbnails`))
              .map(key => Number(/(\d+)\.jpeg$/.exec(key)?.[1]))
              .filter(Number.isFinite);
            return this.opts.db.recordThumbnails({
              cameraId: cfg.cameraId,
              slots,
              every: cfg.frequencyS,
              storageId: record.id,
            });
          })
        );
        const count = counts.reduce((sum, added) => sum + added, 0);
        if (count > 0) {
          this.opts.logger.log({
            level: "info",
            message: "indexed stored thumbnails",
            storage: record.id,
            count,
            ms: Date.now() - started,
          });
        }
      } catch (error) {
        this.opts.logger.log({ level: "warn", message: "thumbnail indexing failed", storage: record.id, error });
      }
    }
  }

  state(cameraId: string): CameraThumbState | null {
    return this.thumbState.get(cameraId) ?? null;
  }

  info(): ThumbnailInfo {
    return {
      lastRun: this.lastRun,
      lastError: this.lastError,
      target: this.opts.hub.get()?.label ?? "no storage configured",
      cameras: [...this.thumbState.values()],
    };
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = Date.now();
      const dueByNvr = new Map<string, DueConfig[]>();
      for (const cfg of this.opts.db.listThumbnailConfigs()) {
        if (!cfg.enabled) continue;
        const slot = thumbnailSlot(now, cfg.frequencyS);
        if (this.lastSlot.get(cfg.cameraId) === slot) continue;
        const camera = this.opts.db.getCamera(cfg.cameraId);
        if (!camera) continue;
        const list = dueByNvr.get(camera.nvrId) ?? [];
        list.push({ cameraId: cfg.cameraId, storageId: cfg.storageId, slot, every: cfg.frequencyS });
        dueByNvr.set(camera.nvrId, list);
      }
      if (dueByNvr.size === 0) return;
      await Promise.all([...dueByNvr].map(([nvrId, list]) => this.runNvr(nvrId, list)));
      this.opts.logger.log({
        level: "info",
        message: "capture round",
        cameras: [...dueByNvr.values()].reduce((sum, list) => sum + list.length, 0),
        ms: Date.now() - now,
      });
      this.lastRun = Math.floor(now / 1000);
      this.lastError = null;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.opts.logger.log({ level: "error", message: "capture round failed", error });
    } finally {
      this.running = false;
    }
  }

  private async runNvr(nvrId: string, list: DueConfig[]): Promise<void> {
    for (const cfg of list) this.lastSlot.set(cfg.cameraId, cfg.slot);
    const conn = this.opts.pool.get(nvrId);
    const def = this.opts.pool.connectorOf(nvrId);
    await Promise.all(
      list.map(async cfg =>
        this.publish(
          cfg,
          conn && def
            ? await this.capture(conn, def.capabilities.live, cfg.cameraId, cfg.slot)
            : "skipped (nvr not connected)"
        )
      )
    );
  }

  // A JPEG, or why there isn't one. Connectors with a snapshot endpoint use it;
  // the rest get one live keyframe decoded by ffmpeg.
  private async capture(
    conn: ConnectorConnection,
    live: boolean,
    cameraId: string,
    ts: number
  ): Promise<Buffer | string> {
    if (conn.snapshot) {
      const jpeg = await conn.snapshot(cameraId).catch(() => null);
      return jpeg ?? "snapshot failed";
    }
    if (!live) return "skipped (connector has neither snapshots nor live video)";

    const subscription = conn.subscribeLive(cameraId);
    let keyframe: { codec: Codec; data: Buffer } | null;
    try {
      keyframe = await grabKeyframe(subscription, GRAB_TIMEOUT_MS);
    } finally {
      subscription.stop();
    }
    if (!keyframe) return "skipped (no keyframe)";

    const dir = path.join(this.opts.workDir, "thumb-scratch", cameraId);
    if (!(await decodeKeyframe(dir, keyframe.codec, keyframe.data, ts))) return "decode failed";
    const file = path.join(dir, "thumbnails", `${ts}.jpeg`);
    const body = await fs.readFile(file).catch(() => null);
    await fs.rm(file, { force: true });
    return body ?? "file missing";
  }

  // Publish one camera's JPEG to THAT camera's storage. Failures are recorded
  // per camera and swallowed so one bad camera can't take down the tick.
  private async publish(cfg: DueConfig, image: Buffer | string): Promise<void> {
    const ts = cfg.slot;
    const fail = (error: string): void => {
      this.thumbState.set(cfg.cameraId, { camera: cfg.cameraId, lastTs: ts, ok: false, error });
      this.opts.logger.log({ level: "warn", message: "thumbnail failed", camera: cfg.cameraId, slot: ts, error });
    };
    if (typeof image === "string") return fail(image);

    const storage = this.opts.hub.get(cfg.storageId);
    if (!storage) return fail("no storage configured");

    try {
      await storage.client.put(`${cfg.cameraId}/thumbnails/${ts}.jpeg`, image, { contentType: "image/jpeg" });
    } catch (error) {
      return fail(`upload failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.opts.db.recordThumbnails({ cameraId: cfg.cameraId, slots: [ts], every: cfg.every, storageId: storage.id });
    this.thumbState.set(cfg.cameraId, { camera: cfg.cameraId, lastTs: ts, ok: true, error: null });
    this.opts.logger.log({
      level: "info",
      message: "thumbnail captured",
      camera: cfg.cameraId,
      slot: ts,
      storage: storage.id,
      bytes: image.length,
    });
  }
}
