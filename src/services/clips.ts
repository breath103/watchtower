// Clip job queue: Save-button downloads. Checks the clip cache first; on a
// miss it opens a playback subscription through the connector and muxes the
// window to MPEG-TS → MP4 with truthful keyframe flags.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { ClipCache, clipCacheKey } from "../clip-cache.js";
import type { Codec } from "../core/types.js";
import type { Database } from "../db/index.js";
import { remuxToMp4 } from "../ffmpeg.js";
import { runClipJobPump } from "./media.js";
import type { ConnectionPool } from "./pool.js";

type ClipStatus = "queued" | "running" | "ready" | "failed";

// start/end: UTC epoch ms.
interface ClipRequest {
  camera: string;
  start: number;
  end: number;
  stream: string;
  transcode?: boolean;
}

export interface ClipJob extends ClipRequest {
  id: string;
  nvr: string;
  status: ClipStatus;
  progress: number;
  file: string | null;
  error: string | null;
  createdAt: string;
}

export class ClipService {
  private readonly jobs = new Map<string, ClipJob>();
  private readonly jobsByKey = new Map<string, ClipJob>();
  private readonly queue: ClipJob[] = [];
  private running = 0;

  constructor(
    private readonly opts: {
      db: Database;
      pool: ConnectionPool;
      workDir: string;
      cache: ClipCache;
      log: (line: string) => void;
      maxConcurrent?: number;
    }
  ) {}

  async create(request: ClipRequest): Promise<ClipJob> {
    const camera = this.opts.db.getCamera(request.camera);
    if (!camera) throw new Error(`unknown camera: ${request.camera}`);
    if (request.end <= request.start) throw new Error("end must be after start");

    const key = clipCacheKey({
      nvr: camera.nvrId,
      camera: camera.id,
      start: request.start,
      end: request.end,
      stream: request.stream,
      transcode: request.transcode,
    });
    const cached = await this.opts.cache.get(key);
    if (cached) {
      const job: ClipJob = {
        ...request,
        nvr: camera.nvrId,
        id: randomUUID(),
        status: "ready",
        progress: 1,
        file: cached.file,
        error: null,
        createdAt: new Date().toISOString(),
      };
      this.jobs.set(job.id, job);
      return job;
    }

    const existing = this.jobsByKey.get(key);
    if (existing) return existing;

    const job: ClipJob = {
      ...request,
      nvr: camera.nvrId,
      id: randomUUID(),
      status: "queued",
      progress: 0,
      file: null,
      error: null,
      createdAt: new Date().toISOString(),
    };
    this.jobs.set(job.id, job);
    this.jobsByKey.set(key, job);
    this.queue.push(job);
    this.pump();
    return job;
  }

  get(id: string): ClipJob | undefined {
    return this.jobs.get(id);
  }

  list(): ClipJob[] {
    return [...this.jobs.values()];
  }

  private pump(): void {
    const max = this.opts.maxConcurrent ?? 2;
    while (this.running < max && this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job) return;
      this.running += 1;
      void this.run(job).finally(() => {
        this.running -= 1;
        this.pump();
      });
    }
  }

  private async run(job: ClipJob): Promise<void> {
    job.status = "running";
    job.progress = 0;
    const camera = this.opts.db.getCamera(job.camera);
    if (!camera) {
      job.status = "failed";
      job.error = "camera disappeared";
      return;
    }
    const conn = this.opts.pool.get(camera.nvrId);
    if (!conn) {
      job.status = "failed";
      job.error = "nvr not registered";
      return;
    }

    const key = clipCacheKey({
      nvr: camera.nvrId,
      camera: camera.id,
      start: job.start,
      end: job.end,
      stream: job.stream,
      transcode: job.transcode,
    });
    const cached = await this.opts.cache.get(key);
    if (cached) {
      job.file = cached.file;
      job.status = "ready";
      job.progress = 1;
      this.jobsByKey.delete(key);
      this.opts.log(`${job.camera}: clip ${job.id} served from cache`);
      return;
    }

    const dir = path.join(this.opts.workDir, "clips", job.id);
    await fsp.mkdir(dir, { recursive: true });
    const tsPath = path.join(dir, `${job.id}.ts`);
    const mp4Path = path.join(dir, `${job.id}.mp4`);
    const out = fs.createWriteStream(tsPath);

    try {
      const sub = conn.subscribePlayback(camera.id, job.start, { stream: job.stream });
      const result = await runClipJobPump(sub, {
        startMs: job.start,
        endMs: job.end,
        stream: out,
        onProgress: progress => {
          job.progress = progress;
        },
      });
      const sourceCodec: Codec = result.codec;
      await remuxToMp4(tsPath, mp4Path, sourceCodec, job.transcode === true);
      await this.opts.cache.putFile(key, mp4Path, job.transcode ? "h264" : sourceCodec).catch(error => {
        this.opts.log(
          `${job.camera}: clip ${job.id} cache store failed: ${error instanceof Error ? error.message : String(error)}`
        );
      });
      job.file = mp4Path;
      job.status = "ready";
      job.progress = 1;
      this.opts.log(`${job.camera}: clip ${job.id} ready (${result.frames} frames)`);
    } catch (error) {
      out.end();
      job.status = "failed";
      job.error = error instanceof Error ? error.message : String(error);
      this.opts.log(`${job.camera}: clip ${job.id} failed: ${job.error}`);
    } finally {
      this.jobsByKey.delete(key);
    }
  }
}
