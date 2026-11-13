// Owns one ConnectorConnection per registered NVR, created lazily from the
// sqlite record and invalidated when the record changes. Also vends throwaway
// connections for the connect wizard (test/discover).

import type { ConnectionStatus, ConnectorConnection, ConnectorDef } from "../core/connector.js";
import type { Registry } from "../core/registry.js";
import type { Database } from "../db/index.js";

export class ConnectionPool {
  private readonly conns = new Map<string, ConnectorConnection>();

  constructor(private readonly opts: { db: Database; registry: Registry; log: (line: string) => void }) {}

  get(nvrId: string): ConnectorConnection | null {
    const existing = this.conns.get(nvrId);
    if (existing) return existing;
    const record = this.opts.db.getNvr(nvrId);
    if (!record) return null;
    const def = this.opts.registry.connector(record.connection.type);
    const config = def.connectionConfigSchema.parse(record.connection);
    const conn = def.create(config, {
      log: line => this.opts.log(`${nvrId}: ${line}`),
      cameras: this.opts.db.listCameras(nvrId).map(camera => ({ id: camera.id, metadata: camera.metadata })),
    });
    this.conns.set(nvrId, conn);
    return conn;
  }

  connectorOf(nvrId: string): ConnectorDef<unknown> | null {
    const record = this.opts.db.getNvr(nvrId);
    return record ? this.opts.registry.connector(record.connection.type) : null;
  }

  status(nvrId: string): ConnectionStatus | null {
    return this.conns.get(nvrId)?.status() ?? null;
  }

  // Called after NVR records change so the next get() rebuilds the connection
  // with the new config/camera map.
  invalidate(nvrId: string): void {
    const conn = this.conns.get(nvrId);
    if (conn) {
      conn.close();
      this.conns.delete(nvrId);
    }
  }

  // Throwaway connection for the wizard: not pooled, caller closes it.
  temp(connectorId: string, rawConfig: unknown): ConnectorConnection {
    const def = this.opts.registry.connector(connectorId);
    const config = def.connectionConfigSchema.parse(rawConfig);
    return def.create(config, {
      log: line => this.opts.log(`[${connectorId}] ${line}`),
      cameras: [],
    });
  }

  closeAll(): void {
    for (const conn of this.conns.values()) conn.close();
    this.conns.clear();
  }
}
