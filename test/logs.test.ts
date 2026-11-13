import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { createLogger, type NewLogEntry } from "../src/core/logger.js";
import { LogFiles } from "../src/services/log-files.js";

describe("logger", () => {
  it("binds scope and context, normalizes errors, drops undefined", t => {
    const lines = t.mock.method(console, "log", () => undefined);
    const saved: NewLogEntry[] = [];
    const logger = createLogger(entry => saved.push(entry)).with({ scope: "nvr", nvr: "nvr-1" });
    logger.log({
      level: "warn",
      message: "channel open failed",
      camera: "nvr-1-2",
      error: new Error("closed"),
      ignored: undefined,
    });

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

describe("log files", () => {
  const DAY = 86_400_000;
  const NOW = Date.UTC(2026, 10, 13, 12);
  const temp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "watchtower-logs-"));
  const entry = (
    ts: number,
    level: NewLogEntry["level"],
    scope: NewLogEntry["scope"],
    message: string,
    camera: string
  ): NewLogEntry => ({ ts, level, scope, message, fields: { camera } });

  const seeded = async (): Promise<{ files: LogFiles; dir: string }> => {
    const dir = temp();
    const writer = new LogFiles({ dir, retentionDays: 7 });
    writer.write(entry(NOW - DAY, "info", "server", "listening on", "none"));
    writer.write(entry(NOW, "warn", "thumbnails", "thumbnail failed", "cam-2"));
    writer.write(entry(NOW, "error", "clips", "clip failed 100%", "카메라-3"));
    writer.write(entry(NOW + 1, "info", "api", "nvr updated", "cam-4"));
    await writer.close();
    return { files: new LogFiles({ dir, retentionDays: 7 }), dir };
  };
  const all = { levels: ["info", "warn", "error"] as const, scope: null, text: null, before: null, limit: 10 };
  const messages = async (files: LogFiles, filter: Partial<Parameters<LogFiles["query"]>[0]>) =>
    (await files.query({ ...all, ...filter })).map(found => found.message);

  it("rotates by UTC day and reads newest first across files", async () => {
    const { files, dir } = await seeded();
    assert.deepEqual(fs.readdirSync(dir).sort(), ["watchtower-2026-11-12.jsonl", "watchtower-2026-11-13.jsonl"]);
    assert.deepEqual(await messages(files, {}), [
      "nvr updated",
      "clip failed 100%",
      "thumbnail failed",
      "listening on",
    ]);
  });

  it("filters by level, scope and text, and pages with before", async () => {
    const { files } = await seeded();
    assert.deepEqual(await messages(files, { levels: ["warn", "error"] }), ["clip failed 100%", "thumbnail failed"]);
    assert.deepEqual(await messages(files, { scope: "api" }), ["nvr updated"]);
    assert.deepEqual(await messages(files, { text: "CAM-2" }), ["thumbnail failed"]);
    assert.deepEqual(await messages(files, { text: "카메라" }), ["clip failed 100%"]);
    assert.deepEqual(await messages(files, { text: "warn" }), []);
    const [newest] = await files.query({ ...all, limit: 1 });
    assert.deepEqual(newest?.fields, { camera: "cam-4" });
    assert.deepEqual(await messages(files, { before: newest?.id ?? 0, limit: 2 }), [
      "clip failed 100%",
      "thumbnail failed",
    ]);
  });

  it("keeps ids increasing within one millisecond and across read chunks", async () => {
    const dir = temp();
    const writer = new LogFiles({ dir, retentionDays: 7 });
    for (let i = 0; i < 5000; i++) writer.write(entry(NOW, "info", "thumbnails", `captured ${i}`, `카메라-${i}`));
    await writer.close();
    const found = await new LogFiles({ dir, retentionDays: 7 }).query({ ...all, limit: 5000 });
    assert.equal(found.length, 5000);
    assert.equal(found[0]?.message, "captured 4999");
    assert.equal(found[4999]?.message, "captured 0");
    assert.ok(found.every((item, i) => i === 0 || item.id < (found[i - 1]?.id ?? 0)));
  });

  it("deletes files past retention", async () => {
    const { files, dir } = await seeded();
    await files.prune(NOW + 7 * DAY);
    assert.deepEqual(fs.readdirSync(dir), ["watchtower-2026-11-13.jsonl"]);
    await files.prune(NOW + 8 * DAY);
    assert.deepEqual(fs.readdirSync(dir), []);
  });
});
