// Resolves Storage backends from sqlite: the default (settings.defaultStorage)
// or any explicit id (per-camera thumbnail targets). Clients are memoized per
// id and re-created when a storage record changes or the default switches.

import type { Logger } from "../core/logger.js";
import type { Registry } from "../core/registry.js";
import type { Database } from "../db/index.js";
import type { StorageClient } from "../storage/types.js";

interface ActiveStorage {
  client: StorageClient;
  label: string;
  id: string;
}

export class StorageHub {
  private readonly clients = new Map<string, ActiveStorage>();

  constructor(private readonly opts: { db: Database; registry: Registry; logger: Logger }) {}

  // id null/undefined = the configured default storage.
  get(id: string | null = null): ActiveStorage | null {
    const target = id ?? this.opts.db.getSetting("defaultStorage");
    if (!target) return null;
    const cached = this.clients.get(target);
    if (cached) return cached;
    const record = this.opts.db.getStorage(target);
    if (!record) return null;
    const def = this.opts.registry.storage(record.type);
    const config = def.configSchema.parse(record.config);
    const client = def.create(config, { logger: this.opts.logger.with({ storage: target }) });
    const cfg = record.config as { root?: string; bucket?: string; prefix?: string };
    const label =
      record.type === "file"
        ? `file://${cfg.root ?? ""}`
        : record.type === "s3"
          ? `s3://${cfg.bucket ?? ""}/${cfg.prefix ?? ""}`
          : record.type;
    const active: ActiveStorage = { client, label, id: target };
    this.clients.set(target, active);
    return active;
  }

  invalidate(id?: string): void {
    if (id) this.clients.delete(id);
    else this.clients.clear();
  }

  setDefault(id: string): void {
    if (!this.opts.db.getStorage(id)) throw new Error(`unknown storage: ${id}`);
    this.opts.db.setSetting("defaultStorage", id);
    this.opts.logger.log({ level: "info", message: "default storage changed", storage: id });
  }

  refresh(): void {
    this.clients.clear();
    this.opts.logger.log({ level: "info", message: "default storage", storage: this.get()?.label ?? null });
  }
}
