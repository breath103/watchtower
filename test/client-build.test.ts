import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

const root = path.join(import.meta.dirname, "..");

test("lib/client.js is built from the current src/client.ts (run npm run build:client)", async () => {
  const result = await build({
    entryPoints: [path.join(root, "src/client.ts")],
    format: "esm",
    platform: "neutral",
    target: "es2022",
    write: false,
  });
  assert.equal(fs.readFileSync(path.join(root, "lib/client.js"), "utf8"), result.outputFiles[0].text);
});
