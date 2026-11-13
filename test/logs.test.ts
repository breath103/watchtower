import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createLogger, type NewLogEntry } from "../src/core/logger.js";
import { Database } from "../src/db/index.js";

describe("logger", () => {
  it("binds scope and context, normalizes errors, drops undefined", t => {
    const lines = t.mock.method(console, "log", () => undefined);
    const saved: NewLogEntry[] = [];
    const logger = createLogger(entry => saved.push(entry)).with({ scope: "nvr", nvr: "nvr-1" });
    logger.log({ level: "warn", message: "channel open failed", camera: "nvr-1-2", error: new Error("closed"), x: undefined });

    assert.equal(saved.length, 1);
    assert.equal(saved[0]?.scope, "nvr");
    assert.deepEqual(saved[0]?.fields, { nvr: "nvr-1", camera: "nvr-1-2", error: "closed" });
    assert.match(
      String(lines.mock.calls[0]?.arguments[0]),
      /^\d\d:\d\d:\d\d warn {2}nvr {8}channel open failed nvr=nvr-1 camera=nvr-1-2 error=closed$/
    );
  });

  it("still prints when persisting throws", t => {
    const lines = t.mock.method(console, "log", () => undefined);
    const logger = createLogger(() => {
      throw new Error("database is not open");
    });
    assert.doesNotThrow(() => logger.log({ level: "info", message: "shutting down" }));
    assert.equal(lines.mock.callCount(), 1);
  });
});

describe("logs table", () => {
  const seeded = (): Database => {
    const db = new Database(":memory:");
    const entry = (ts: number, level: NewLogEntry["level"], scope: NewLogEntry["scope"], message: string) =>
      db.insertLog({ ts, level, scope, message, fields: { camera: `cam-${ts}` } });
    entry(1, "info", "server", "listening on");
    entry(2, "warn", "thumbnails", "thumbnail failed");
    entry(3, "error", "clips", "clip failed 100%");
    entry(4, "info", "api", "nvr updated");
    return db;
  };
  const all = { levels: ["info", "warn", "error"] as const, scope: null, text: null, before: null, limit: 10 };
  const messages = (db: Database, filter: Partial<Parameters<Database["listLogs"]>[0]>) =>
    db.listLogs({ ...all, ...filter }).map(entry => entry.message);

  it("lists newest first and filters by level, scope, text and cursor", () => {
    const db = seeded();
    assert.deepEqual(messages(db, {}), ["nvr updated", "clip failed 100%", "thumbnail failed", "listening on"]);
    assert.deepEqual(messages(db, { levels: ["warn", "error"] }), ["clip failed 100%", "thumbnail failed"]);
    assert.deepEqual(messages(db, { scope: "api" }), ["nvr updated"]);
    assert.deepEqual(messages(db, { text: "cam-2" }), ["thumbnail failed"]);
    assert.deepEqual(messages(db, { text: "100%" }), ["clip failed 100%"]);
    assert.deepEqual(messages(db, { text: "1_0" }), []);
    assert.deepEqual(messages(db, { before: 3, limit: 1 }), ["thumbnail failed"]);
    assert.deepEqual(db.listLogs({ ...all, limit: 1 })[0]?.fields, { camera: "cam-4" });
  });

  it("prunes by age and row cap", () => {
    const db = seeded();
    db.pruneLogs(2, 10);
    assert.deepEqual(messages(db, {}), ["nvr updated", "clip failed 100%", "thumbnail failed"]);
    db.pruneLogs(0, 2);
    assert.deepEqual(messages(db, {}), ["nvr updated", "clip failed 100%"]);
  });
});
