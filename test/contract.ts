// Behaviour every connector must have, runnable without a device: pass a
// factory and the camera ids it knows.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ConnectorConnection } from "../src/core/connector.js";
import { FramePull } from "../src/core/observable.js";

export function connectorContract(
  name: string,
  make: () => ConnectorConnection,
  opts: { offline?: boolean; camera?: string; from?: number; to?: number } = {}
): void {
  describe(`${name} connector contract`, () => {
    it("rejects `opened` for an unknown camera instead of hanging", async () => {
      const conn = make();
      const live = conn.subscribeLive("no-such-camera");
      await assert.rejects(live.opened);
      const playback = conn.subscribePlayback("no-such-camera", Date.UTC(2026, 0, 1));
      await assert.rejects(playback.opened);
      live.stop();
      playback.stop();
      conn.close();
    });

    it("lists no recordings for unknown cameras", async () => {
      const conn = make();
      assert.deepEqual(await conn.listRecordings(["no-such-camera"], 0, Date.UTC(2026, 0, 2)), []);
      conn.close();
    });

    if (opts.offline || !opts.camera || opts.from === undefined || opts.to === undefined) return;
    const { camera, from, to } = opts;

    it("returns recordings clipped to [from, to), sorted, end > start", async () => {
      const conn = make();
      const recs = await conn.listRecordings([camera], from, to);
      for (const rec of recs) {
        assert.equal(rec.cameraId, camera);
        assert.ok(rec.start >= from && rec.end <= to && rec.end > rec.start, JSON.stringify(rec));
      }
      for (let i = 1; i < recs.length; i++) assert.ok((recs[i]?.start ?? 0) >= (recs[i - 1]?.end ?? 0));
      conn.close();
    });

    it("plays back frames stamped in UTC at or after startMs, and tracks live cameras", async () => {
      const conn = make();
      const sub = conn.subscribePlayback(camera, from);
      await sub.opened;
      const pull = new FramePull(sub.frames);
      const frame = await pull.next(2000);
      assert.ok(frame?.timestampMs !== null && frame !== null && frame.timestampMs >= from);
      pull.close();
      sub.stop();

      const live = conn.subscribeLive(camera);
      await live.opened;
      assert.deepEqual(conn.status().liveCameras, [camera]);
      live.stop();
      assert.deepEqual(conn.status().liveCameras, []);
      conn.close();
    });
  });
}
