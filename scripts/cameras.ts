import fs from "node:fs/promises";
import { z } from "zod";

const seedSchema = z.object({
  nvrs: z.array(
    z.object({
      id: z.string(),
      name: z.string().optional(),
      model: z.string().optional(),
      disabled: z.boolean().optional(),
      connection: z.object({
        host: z.string(),
        port: z.number().int(),
        username: z.string(),
        password: z.string(),
      }),
      channels: z.array(z.object({ id: z.string(), streamRecordActive: z.boolean().optional() })),
    })
  ),
});

export interface SeedNvr {
  id: string;
  name: string;
  connection: { host: string; port: number; username: string; password: string };
  channels: Array<{ id: string; index: number }>;
}

export async function readSeedNvrs(file: string, only: Set<string> | null): Promise<SeedNvr[]> {
  const parsed = seedSchema.parse(JSON.parse(await fs.readFile(file, "utf8")));
  return parsed.nvrs
    .filter(nvr => !nvr.disabled)
    .filter(nvr => !only || only.has(nvr.id) || nvr.channels.some(channel => only.has(channel.id)))
    .map(nvr => ({
      id: nvr.id,
      name: nvr.name ?? nvr.model ?? nvr.id,
      connection: nvr.connection,
      channels: nvr.channels
        .map((channel, index) => ({ id: channel.id, index }))
        .filter(channel => !only || only.has(nvr.id) || only.has(channel.id)),
    }))
    .filter(nvr => nvr.channels.length > 0);
}
