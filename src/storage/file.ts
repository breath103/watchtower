import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { defineStorage } from "./types.js";

const configSchema = z.object({
  root: z.string().describe("absolute directory the keys are written under"),
  retentionDays: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("delete thumbnails older than this many days; unset keeps them forever"),
});

export const FileStorage = defineStorage({
  id: "file",
  title: "Local filesystem",
  description: "Writes artifacts under a local directory. The safe default.",
  configSchema,
  create: config => ({
    retentionDays: config.retentionDays,
    put: async (key, body) => {
      const dest = path.join(config.root, key);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, body);
    },
    get: async key => fs.readFile(path.join(config.root, key)).catch(() => null),
    delete: async key => fs.rm(path.join(config.root, key), { force: true }),
    list: async prefix =>
      (await fs.readdir(path.join(config.root, prefix)).catch(() => [] as string[])).map(name =>
        path.posix.join(prefix, name)
      ),
    url: key => `file://${path.join(config.root, key)}`,
  }),
});
