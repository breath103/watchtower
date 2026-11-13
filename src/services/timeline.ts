import type { Database } from "../db/index.js";
import type { ConnectionPool } from "./pool.js";

interface TimelineCamera {
  camera: string;
  recordings: Array<{ start: number; end: number }>;
}

export interface TimelineResult {
  nvr: string;
  from: number;
  to: number;
  cameras: TimelineCamera[];
}

export class TimelineService {
  constructor(private readonly opts: { db: Database; pool: ConnectionPool }) {}

  async get(nvrId: string, fromMs: number, toMs: number): Promise<TimelineResult> {
    if (toMs <= fromMs) throw new Error("to must be after from");
    const cameras = this.opts.db.listCameras(nvrId);
    if (cameras.length === 0) return { nvr: nvrId, from: fromMs, to: toMs, cameras: [] };
    const conn = this.opts.pool.get(nvrId);
    if (!conn) throw new Error(`no connection for nvr: ${nvrId}`);

    const recordings = await conn.listRecordings(
      cameras.map(camera => camera.id),
      fromMs,
      toMs
    );
    return {
      nvr: nvrId,
      from: fromMs,
      to: toMs,
      cameras: cameras.map(camera => ({
        camera: camera.id,
        recordings: recordings
          .filter(rec => rec.cameraId === camera.id)
          .map(rec => ({ start: rec.start, end: rec.end })),
      })),
    };
  }
}
