import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";

import type { ApiKeyRecord } from "../core/types.js";
import type { Database } from "../db/index.js";

const KEY_PREFIX = "wt_";
const TOUCH_INTERVAL_MS = 60_000;

const hashKey = (key: string): string => createHash("sha256").update(key).digest("hex");

// The plaintext key is returned once and never stored; only its hash is.
export function createApiKey(db: Database, name: string): { record: ApiKeyRecord; key: string } {
  const key = `${KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
  const record: ApiKeyRecord = {
    id: randomUUID(),
    name,
    hint: key.slice(-4),
    createdAt: Date.now(),
    lastUsedAt: null,
  };
  db.insertApiKey(record, hashKey(key));
  return { record, key };
}

export function requireApiKey(db: Database): MiddlewareHandler {
  return async (c, next) => {
    const match = /^Bearer\s+(\S+)$/i.exec(c.req.header("authorization") ?? "");
    const record = match?.[1] ? db.findApiKeyByHash(hashKey(match[1])) : null;
    if (!record) {
      throw new HTTPException(401, {
        res: c.json({ error: { code: "unauthorized", message: "missing or invalid API key" } }, 401, {
          "WWW-Authenticate": "Bearer",
        }),
      });
    }
    const now = Date.now();
    if (record.lastUsedAt === null || now - record.lastUsedAt > TOUCH_INTERVAL_MS) db.touchApiKey(record.id, now);
    await next();
  };
}
