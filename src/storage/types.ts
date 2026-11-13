// Storage backends: where published artifacts (thumbnails today, exported
// clips tomorrow) live. Each backend defines its own zod config schema; the
// config is persisted in sqlite and re-validated on boot.

import type { z } from "zod";

export interface StoragePutOptions {
  contentType?: string;
  cacheControl?: string;
}

export interface StorageClient {
  put(key: string, body: Buffer, opts?: StoragePutOptions): Promise<void>;
  get?(key: string): Promise<Buffer | null>;
  delete?(key: string): Promise<void>;
  retentionDays?: number;
  url?(key: string): string | null;
  list?(prefix: string): Promise<string[]>;
}

interface StorageContext {
  log: (line: string) => void;
}

export interface StorageDef<Config = unknown> {
  id: string;
  title: string;
  description?: string;
  configSchema: z.ZodType<Config>;
  create(config: Config, ctx: StorageContext): StorageClient;
}

export function defineStorage<Config>(def: StorageDef<Config>): StorageDef<Config> {
  return def;
}
