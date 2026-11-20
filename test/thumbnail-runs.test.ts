import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Database } from "../src/db/index.js";

function seeded(): Database {
  const db = new Database(":memory:");
  db.insertNvr({ id: "n1", name: "NVR 1", connection: { type: "fake" } }, [
    { id: "n1ch1", nvrId: "n1", name: "Cam 1", metadata: { type: "fake" } },
  ], true);
  return db;
}

const record = (db: Database, slots: number[], every = 30, storageId = "local"): number =>
  db.recordThumbnails({ cameraId: "n1ch1", slots, every, storageId });

const runs = (db: Database): Array<[number, number]> =>
  db.thumbnailRunsBefore("local", Number.MAX_SAFE_INTEGER).map(run => [run.start, run.end]);

describe("thumbnail runs", () => {
  it("extends a run while captures are consecutive and starts a new one after a gap", () => {
    const db = seeded();
    for (const ts of [0, 30, 60, 150, 180]) record(db, [ts]);
    assert.deepEqual(runs(db), [
      [0, 60],
      [150, 180],
    ]);
    assert.deepEqual(db.listThumbnails("n1ch1", 0, 1000), [0, 30, 60, 150, 180]);
  });

  it("counts only new slots and fills a gap by merging both neighbours", () => {
    const db = seeded();
    assert.equal(record(db, [0, 30, 120, 150]), 4);
    assert.equal(record(db, [30, 150, 15]), 0);
    assert.equal(record(db, [60, 90]), 2);
    assert.deepEqual(runs(db), [[0, 150]]);
  });

  it("keeps runs apart when the spacing or the storage differs", () => {
    const db = seeded();
    record(db, [0, 30]);
    record(db, [60], 60);
    record(db, [90], 30, "s3");
    assert.deepEqual(runs(db), [
      [0, 30],
      [60, 60],
    ]);
    assert.equal(db.getThumbnailStorage("n1ch1", 90), "s3");
    assert.equal(db.getThumbnailStorage("n1ch1", 30), "local");
    assert.equal(db.getThumbnailStorage("n1ch1", 45), null);
    assert.equal(db.getThumbnailStorage("n1ch1", 120), null);
  });

  it("lists only the slots inside the range", () => {
    const db = seeded();
    record(db, [0, 30, 60, 90, 120]);
    assert.deepEqual(db.listThumbnails("n1ch1", 31, 100), [60, 90]);
    assert.deepEqual(db.listThumbnails("n1ch1", 121, 200), []);
  });

  it("trims a run past the cutoff and drops runs entirely before it", () => {
    const db = seeded();
    record(db, [0, 30, 120, 150, 180]);
    for (const run of db.thumbnailRunsBefore("local", 140)) db.trimThumbnailRun(run, 140);
    assert.deepEqual(runs(db), [[150, 180]]);
  });

  it("drops a storage's runs with the storage", () => {
    const db = seeded();
    db.upsertStorage({ id: "local", type: "file", config: { root: "/tmp" } });
    record(db, [0, 30]);
    db.deleteStorage("local");
    assert.deepEqual(db.listThumbnails("n1ch1", 0, 100), []);
  });
});
