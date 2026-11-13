// Persistence: sqlite (node:sqlite, zero deps). Schema is created idempotently
// on open; connection/metadata blobs are stored as JSON text and re-validated
// against the owning connector/storage schema at use time.

import { DatabaseSync } from "node:sqlite";

import type { LogEntry, LogLevel, LogScope, NewLogEntry } from "../core/logger.js";
import type { ApiKeyRecord, CameraRecord, NvrRecord, StorageRecord, Tag } from "../core/types.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS nvrs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  connection TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cameras (
  id TEXT PRIMARY KEY,
  nvr_id TEXT NOT NULL REFERENCES nvrs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  metadata TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS storages (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  config TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS camera_thumbnails (
  camera_id TEXT PRIMARY KEY REFERENCES cameras(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1,
  storage_id TEXT,
  frequency_s INTEGER NOT NULL DEFAULT 30
);
CREATE TABLE IF NOT EXISTS thumbnails (
  camera_id TEXT NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  storage_id TEXT NOT NULL,
  PRIMARY KEY (camera_id, ts)
);
CREATE INDEX IF NOT EXISTS thumbnails_ts ON thumbnails(ts);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- id is an nvr id or a camera id (no FK: it can point at either table).
CREATE TABLE IF NOT EXISTS tags (
  id TEXT NOT NULL,
  type TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (id, type, value)
);
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  hint TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  level TEXT NOT NULL,
  scope TEXT NOT NULL,
  message TEXT NOT NULL,
  fields TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS logs_ts ON logs (ts);
`;

export const DEFAULT_THUMBNAIL_FREQUENCY_S = 30;

export interface ThumbnailConfig {
  cameraId: string;
  enabled: boolean;
  storageId: string | null;
  frequencyS: number;
}

interface NvrRow {
  id: string;
  name: string;
  connection: string;
}
interface CameraRow {
  id: string;
  nvr_id: string;
  name: string;
  metadata: string;
}
interface StorageRow {
  id: string;
  type: string;
  config: string;
}
interface LogRow {
  id: number;
  ts: number;
  level: LogLevel;
  scope: LogScope;
  message: string;
  fields: string;
}
interface ApiKeyRow {
  id: string;
  name: string;
  hint: string;
  created_at: number;
  last_used_at: number | null;
}

const byId = <T extends { id: string }>(a: T, b: T): number => a.id.localeCompare(b.id, undefined, { numeric: true });

const cameraFromRow = (row: CameraRow): CameraRecord => ({
  id: row.id,
  nvrId: row.nvr_id,
  name: row.name,
  metadata: JSON.parse(row.metadata) as CameraRecord["metadata"],
});

const apiKeyFromRow = (row: ApiKeyRow): ApiKeyRecord => ({
  id: row.id,
  name: row.name,
  hint: row.hint,
  createdAt: row.created_at,
  lastUsedAt: row.last_used_at,
});

export class Database {
  private readonly db: DatabaseSync;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.migrateLegacy();
    this.db.exec(SCHEMA);
  }

  // Must run before SCHEMA, or CREATE TABLE IF NOT EXISTS would create empty
  // `cameras` tables beside the legacy `channels` ones.
  private migrateLegacy(): void {
    const tables = new Set(
      (this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(
        row => row.name
      )
    );
    const columns = (table: string): string[] =>
      (this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(row => row.name);

    this.transaction(() => {
      if (tables.has("channels") && !tables.has("cameras")) {
        if (columns("channels").includes("channel_id")) this.db.exec("ALTER TABLE channels DROP COLUMN channel_id");
        this.db.exec("ALTER TABLE channels RENAME TO cameras");
      }
      if (tables.has("channel_thumbnails") && !tables.has("camera_thumbnails")) {
        this.db.exec("ALTER TABLE channel_thumbnails RENAME TO camera_thumbnails");
        this.db.exec("ALTER TABLE camera_thumbnails RENAME COLUMN channel_id TO camera_id");
      }
      if (tables.has("thumbnails") && columns("thumbnails").includes("channel_id")) {
        this.db.exec("ALTER TABLE thumbnails RENAME COLUMN channel_id TO camera_id");
      }
    });
  }

  private transaction(run: () => void): void {
    this.db.exec("BEGIN");
    try {
      run();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }

  // ---- nvrs -------------------------------------------------------------
  listNvrs(): NvrRecord[] {
    return (this.db.prepare("SELECT id, name, connection FROM nvrs").all() as unknown as NvrRow[])
      .map(row => ({ id: row.id, name: row.name, connection: JSON.parse(row.connection) as NvrRecord["connection"] }))
      .sort(byId);
  }

  getNvr(id: string): NvrRecord | null {
    const row = this.db.prepare("SELECT id, name, connection FROM nvrs WHERE id = ?").get(id) as unknown as
      | NvrRow
      | undefined;
    if (!row) return null;
    return { id: row.id, name: row.name, connection: JSON.parse(row.connection) as NvrRecord["connection"] };
  }

  updateNvr(record: NvrRecord, cameraNames: Array<{ id: string; name: string }>): void {
    this.transaction(() => {
      this.db
        .prepare("UPDATE nvrs SET name = ?, connection = ? WHERE id = ?")
        .run(record.name, JSON.stringify(record.connection), record.id);
      for (const camera of cameraNames) {
        this.db
          .prepare("UPDATE cameras SET name = ? WHERE id = ? AND nvr_id = ?")
          .run(camera.name, camera.id, record.id);
      }
    });
  }

  deleteNvr(id: string): void {
    this.transaction(() => {
      this.db.prepare("DELETE FROM tags WHERE id = ? OR id IN (SELECT id FROM cameras WHERE nvr_id = ?)").run(id, id);
      this.db.prepare("DELETE FROM nvrs WHERE id = ?").run(id);
    });
  }

  // Inserts the NVR and its cameras atomically; fails if any id is taken.
  insertNvr(record: NvrRecord, cameras: CameraRecord[], thumbnailsEnabled: boolean): void {
    this.transaction(() => {
      this.db
        .prepare("INSERT INTO nvrs (id, name, connection) VALUES (?, ?, ?)")
        .run(record.id, record.name, JSON.stringify(record.connection));
      for (const camera of cameras) {
        this.db
          .prepare("INSERT INTO cameras (id, nvr_id, name, metadata) VALUES (?, ?, ?, ?)")
          .run(camera.id, camera.nvrId, camera.name, JSON.stringify(camera.metadata));
        this.db
          .prepare("INSERT INTO camera_thumbnails (camera_id, enabled, frequency_s) VALUES (?, ?, ?)")
          .run(camera.id, thumbnailsEnabled ? 1 : 0, DEFAULT_THUMBNAIL_FREQUENCY_S);
      }
    });
  }

  // ---- cameras ------------------------------------------------------------
  listCameras(nvrId?: string): CameraRecord[] {
    const rows = (nvrId
      ? this.db.prepare("SELECT * FROM cameras WHERE nvr_id = ? ORDER BY id").all(nvrId)
      : this.db.prepare("SELECT * FROM cameras ORDER BY id").all()) as unknown as CameraRow[];
    return rows.map(cameraFromRow).sort(byId);
  }

  getCamera(id: string): CameraRecord | null {
    const row = this.db.prepare("SELECT * FROM cameras WHERE id = ?").get(id) as unknown as CameraRow | undefined;
    return row ? cameraFromRow(row) : null;
  }

  // ---- storages + settings ----------------------------------------------
  listStorages(): StorageRecord[] {
    return (this.db.prepare("SELECT id, type, config FROM storages ORDER BY id").all() as unknown as StorageRow[]).map(
      row => ({ id: row.id, type: row.type, config: JSON.parse(row.config) as Record<string, unknown> })
    );
  }

  getStorage(id: string): StorageRecord | null {
    const row = this.db.prepare("SELECT id, type, config FROM storages WHERE id = ?").get(id) as unknown as
      | StorageRow
      | undefined;
    if (!row) return null;
    return { id: row.id, type: row.type, config: JSON.parse(row.config) as Record<string, unknown> };
  }

  upsertStorage(record: StorageRecord): void {
    this.db
      .prepare(
        "INSERT INTO storages (id, type, config) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET type = excluded.type, config = excluded.config"
      )
      .run(record.id, record.type, JSON.stringify(record.config));
  }

  // Cameras targeting it fall back to the default storage; its thumbnail index
  // rows go (the stored objects are left in place).
  deleteStorage(id: string): void {
    this.transaction(() => {
      this.db.prepare("UPDATE camera_thumbnails SET storage_id = NULL WHERE storage_id = ?").run(id);
      this.db.prepare("DELETE FROM thumbnails WHERE storage_id = ?").run(id);
      this.db.prepare("DELETE FROM storages WHERE id = ?").run(id);
    });
  }

  getSetting(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row ? row.value : null;
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, value);
  }

  // ---- per-camera thumbnail config ----------------------------------------
  // Missing row = defaults (enabled, default storage, 30s).
  listThumbnailConfigs(): ThumbnailConfig[] {
    const rows = this.db
      .prepare(
        "SELECT c.id AS camera_id, t.enabled AS enabled, t.storage_id AS storage_id, t.frequency_s AS frequency_s FROM cameras c LEFT JOIN camera_thumbnails t ON t.camera_id = c.id ORDER BY c.id"
      )
      .all() as unknown as Array<{
      camera_id: string;
      enabled: number | null;
      storage_id: string | null;
      frequency_s: number | null;
    }>;
    return rows.map(row => ({
      cameraId: row.camera_id,
      enabled: (row.enabled ?? 1) === 1,
      storageId: row.storage_id,
      frequencyS: row.frequency_s ?? DEFAULT_THUMBNAIL_FREQUENCY_S,
    }));
  }

  upsertThumbnailConfig(cfg: ThumbnailConfig): void {
    this.db
      .prepare(
        "INSERT INTO camera_thumbnails (camera_id, enabled, storage_id, frequency_s) VALUES (?, ?, ?, ?) ON CONFLICT(camera_id) DO UPDATE SET enabled = excluded.enabled, storage_id = excluded.storage_id, frequency_s = excluded.frequency_s"
      )
      .run(cfg.cameraId, cfg.enabled ? 1 : 0, cfg.storageId, cfg.frequencyS);
  }

  // ---- captured thumbnails ------------------------------------------------
  recordThumbnail(cameraId: string, ts: number, storageId: string): void {
    this.db
      .prepare("INSERT OR IGNORE INTO thumbnails (camera_id, ts, storage_id) VALUES (?, ?, ?)")
      .run(cameraId, ts, storageId);
  }

  listThumbnails(cameraId: string, fromTs: number, toTs: number): number[] {
    return (
      this.db
        .prepare("SELECT ts FROM thumbnails WHERE camera_id = ? AND ts >= ? AND ts <= ? ORDER BY ts")
        .all(cameraId, fromTs, toTs) as Array<{ ts: number }>
    ).map(row => row.ts);
  }

  getThumbnailStorage(cameraId: string, ts: number): string | null {
    const row = this.db.prepare("SELECT storage_id FROM thumbnails WHERE camera_id = ? AND ts = ?").get(cameraId, ts) as
      | { storage_id: string }
      | undefined;
    return row?.storage_id ?? null;
  }

  oldestThumbnails(storageId: string, beforeTs: number, limit: number): Array<{ cameraId: string; ts: number }> {
    return (
      this.db
        .prepare("SELECT camera_id, ts FROM thumbnails WHERE storage_id = ? AND ts < ? ORDER BY ts LIMIT ?")
        .all(storageId, beforeTs, limit) as Array<{ camera_id: string; ts: number }>
    ).map(row => ({ cameraId: row.camera_id, ts: row.ts }));
  }

  deleteThumbnail(cameraId: string, ts: number): void {
    this.db.prepare("DELETE FROM thumbnails WHERE camera_id = ? AND ts = ?").run(cameraId, ts);
  }

  // ---- tags ---------------------------------------------------------------
  tagLookup(): (id: string) => Tag[] {
    const rows = this.db.prepare("SELECT id, type, value FROM tags ORDER BY id, type, value").all() as Array<{
      id: string;
      type: string;
      value: string;
    }>;
    const byId = new Map<string, Tag[]>();
    for (const row of rows) {
      const list = byId.get(row.id) ?? [];
      list.push({ type: row.type, value: row.value });
      byId.set(row.id, list);
    }
    return id => byId.get(id) ?? [];
  }

  distinctTags(): Tag[] {
    return this.db.prepare("SELECT DISTINCT type, value FROM tags ORDER BY type, value").all() as unknown as Tag[];
  }

  setTags(id: string, tags: Tag[]): void {
    this.transaction(() => {
      this.db.prepare("DELETE FROM tags WHERE id = ?").run(id);
      const insert = this.db.prepare("INSERT OR IGNORE INTO tags (id, type, value) VALUES (?, ?, ?)");
      for (const tag of tags) insert.run(id, tag.type, tag.value);
    });
  }

  // ---- api keys -----------------------------------------------------------
  listApiKeys(): ApiKeyRecord[] {
    return (
      this.db
        .prepare("SELECT id, name, hint, created_at, last_used_at FROM api_keys ORDER BY created_at")
        .all() as unknown as ApiKeyRow[]
    ).map(apiKeyFromRow);
  }

  insertApiKey(record: ApiKeyRecord, hash: string): void {
    this.db
      .prepare("INSERT INTO api_keys (id, name, hash, hint, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(record.id, record.name, hash, record.hint, record.createdAt);
  }

  findApiKeyByHash(hash: string): ApiKeyRecord | null {
    const row = this.db
      .prepare("SELECT id, name, hint, created_at, last_used_at FROM api_keys WHERE hash = ?")
      .get(hash) as unknown as ApiKeyRow | undefined;
    return row ? apiKeyFromRow(row) : null;
  }

  touchApiKey(id: string, at: number): void {
    this.db.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").run(at, id);
  }

  deleteApiKey(id: string): boolean {
    return this.db.prepare("DELETE FROM api_keys WHERE id = ?").run(id).changes > 0;
  }

  // ---- logs ---------------------------------------------------------------
  insertLog(entry: NewLogEntry): void {
    this.db
      .prepare("INSERT INTO logs (ts, level, scope, message, fields) VALUES (?, ?, ?, ?, ?)")
      .run(entry.ts, entry.level, entry.scope, entry.message, JSON.stringify(entry.fields));
  }

  listLogs(filter: {
    levels: readonly LogLevel[];
    scope: LogScope | null;
    text: string | null;
    before: number | null;
    limit: number;
  }): LogEntry[] {
    const where = [`level IN (${filter.levels.map(() => "?").join(", ")})`];
    const args: Array<string | number> = [...filter.levels];
    if (filter.scope !== null) {
      where.push("scope = ?");
      args.push(filter.scope);
    }
    if (filter.text !== null) {
      const pattern = `%${filter.text.replace(/[\\%_]/g, char => `\\${char}`)}%`;
      where.push("(message LIKE ? ESCAPE '\\' OR fields LIKE ? ESCAPE '\\')");
      args.push(pattern, pattern);
    }
    if (filter.before !== null) {
      where.push("id < ?");
      args.push(filter.before);
    }
    const rows = this.db
      .prepare(`SELECT * FROM logs WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ?`)
      .all(...args, filter.limit) as unknown as LogRow[];
    return rows.map(row => ({ ...row, fields: JSON.parse(row.fields) as LogEntry["fields"] }));
  }

  pruneLogs(beforeTs: number, keep: number): void {
    this.db.prepare("DELETE FROM logs WHERE ts < ?").run(beforeTs);
    this.db
      .prepare("DELETE FROM logs WHERE id <= (SELECT id FROM logs ORDER BY id DESC LIMIT 1 OFFSET ?)")
      .run(keep);
  }
}
