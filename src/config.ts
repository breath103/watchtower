import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";

export const configSchema = z.strictObject({
  $schema: z.string().optional(),
  workDir: z
    .string()
    .default("data")
    .describe("Directory for the sqlite database, local thumbnails, and clip cache. Relative to this file."),
  host: z.string().default("127.0.0.1").describe("Interface the HTTP server binds to."),
  port: z.number().int().min(1).max(65535).default(10530).describe("HTTP server port."),
  admin: z
    .strictObject({
      username: z.string().min(1),
      password: z.string().min(8),
    })
    .describe("The one account that can sign in to the web UI. Other systems use API keys instead."),
});

type AppConfig = Omit<z.output<typeof configSchema>, "$schema">;

export function loadConfig(argv: string[]): { config: AppConfig; source: string } {
  const { values } = parseArgs({ args: argv, options: { config: { type: "string" } }, strict: true });
  const file = path.resolve(values.config ?? "config.json");

  let raw: unknown = {};
  if (fs.existsSync(file)) {
    try {
      raw = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      throw new Error(`${file}: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
    }
  } else if (values.config) {
    throw new Error(`${file}: not found`);
  }

  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`${file}: invalid config\n${z.prettifyError(parsed.error)}`);

  const { $schema: _, ...config } = parsed.data;
  return {
    config: { ...config, workDir: path.resolve(path.dirname(file), config.workDir) },
    source: fs.existsSync(file) ? file : "defaults (no config.json)",
  };
}
