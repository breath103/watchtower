import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ZodError } from "zod";

import { camerasFilter, filterCameras, jsonQuery } from "../src/api/helpers.js";
import { createWatchtowerClient } from "../src/client.js";
import { Database } from "../src/db/index.js";

function seeded(): Database {
  const db = new Database(":memory:");
  db.insertNvr({ id: "n1", name: "NVR 1", connection: { type: "fake" } }, [
    { id: "n1ch1", nvrId: "n1", name: "Cam 1", metadata: { type: "fake" } },
  ], false);
  return db;
}

describe("tags", () => {
  it("replaces an entity's tags and collapses duplicates", () => {
    const db = seeded();
    db.setTags("n1", [
      { type: "location", value: "HQ" },
      { type: "location", value: "HQ" },
      { type: "floor", value: "2" },
    ]);
    assert.deepEqual(db.tagLookup()("n1"), [
      { type: "floor", value: "2" },
      { type: "location", value: "HQ" },
    ]);
    db.setTags("n1", [{ type: "location", value: "Lab" }]);
    assert.deepEqual(db.tagLookup()("n1"), [{ type: "location", value: "Lab" }]);
    db.setTags("n1", []);
    assert.deepEqual(db.tagLookup()("n1"), []);
  });

  it("drops an NVR's and its cameras' tags when the NVR is deleted", () => {
    const db = seeded();
    db.setTags("n1", [{ type: "location", value: "HQ" }]);
    db.setTags("n1ch1", [{ type: "zone", value: "gate" }]);
    db.deleteNvr("n1");
    assert.deepEqual(db.distinctTags(), []);
  });
});

describe("camera tag filter", () => {
  const loc = (value: string) => ({ type: "location", value });
  const nvrs = [
    { id: "a", tags: [loc("HQ")], cameras: [{ id: "a1", tags: [{ type: "zone", value: "gate" }] }, { id: "a2", tags: [] }] },
    { id: "b", tags: [loc("Lab"), { type: "floor", value: "2" }], cameras: [{ id: "b1", tags: [] }] },
    { id: "c", tags: [], cameras: [{ id: "c1", tags: [] }] },
  ];
  const ids = (out: typeof nvrs) => out.map(n => `${n.id}:${n.cameras.map(c => c.id).join(",")}`);

  it("returns everything without a filter", () => {
    assert.deepEqual(ids(filterCameras(nvrs, undefined)), ["a:a1,a2", "b:b1", "c:c1"]);
    assert.deepEqual(ids(filterCameras(nvrs, {})), ["a:a1,a2", "b:b1", "c:c1"]);
  });

  it("ORs values within a type and ANDs across types", () => {
    assert.deepEqual(ids(filterCameras(nvrs, { nvrs: { tags: { location: ["HQ", "Lab"] } } })), ["a:a1,a2", "b:b1"]);
    assert.deepEqual(ids(filterCameras(nvrs, { nvrs: { tags: { location: ["HQ", "Lab"], floor: ["2"] } } })), [
      "b:b1",
    ]);
    assert.deepEqual(ids(filterCameras(nvrs, { nvrs: { tags: { location: ["Nowhere"] } } })), []);
  });

  it("keeps only matching cameras and drops NVRs left empty", () => {
    assert.deepEqual(ids(filterCameras(nvrs, { cameras: { tags: { zone: ["gate"] } } })), ["a:a1"]);
  });

  it("parses the query param as JSON and rejects bad input", () => {
    const param = jsonQuery(camerasFilter);
    assert.deepEqual(param.parse('{"nvrs":{"tags":{"location":["HQ"]}}}'), { nvrs: { tags: { location: ["HQ"] } } });
    assert.throws(() => param.parse("not json"), ZodError);
    assert.throws(() => param.parse('{"nvrs":{"tags":{"location":"HQ"}}}'), ZodError);
    assert.throws(() => param.parse('{"nvrz":{}}'), ZodError);
    assert.throws(() => param.parse('{"nvrs":{"tags":{"location":[]}}}'), ZodError);
  });

  it("types the typed client's filter as an object", () => {
    const client = createWatchtowerClient({ baseUrl: "http://127.0.0.1:1" });
    // Compile-time only: never awaited.
    const typed = (): unknown =>
      client("/api/v1/cameras", "GET", { query: { filter: { nvrs: { tags: { location: ["HQ"] } } } } });
    assert.equal(typeof typed, "function");
  });
});
