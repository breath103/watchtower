import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import type { ConnectionStatus } from "../core/connector.js";
import { LOG_LEVELS, LOG_SCOPES, type Logger } from "../core/logger.js";
import { tagSchema } from "../core/types.js";
import type { Registry } from "../core/registry.js";
import { type Database, DEFAULT_THUMBNAIL_FREQUENCY_S } from "../db/index.js";
import { createApiKey } from "../services/api-keys.js";
import type { Auth } from "../services/auth.js";
import type { LogFiles } from "../services/log-files.js";
import type { ClipService } from "../services/clips.js";
import type { ConnectionPool } from "../services/pool.js";
import type { StorageHub } from "../services/storage-hub.js";
import type { ThumbnailService } from "../services/thumbnails.js";
import type { TimelineService } from "../services/timeline.js";
import { statusSnapshot } from "../status.js";
import {
  camerasFilter,
  cameraOpener,
  checkClipRange,
  clipQuery,
  filterCameras,
  jsonQuery,
  jsonSchemaOf,
  mergeConfig,
  publicCamera,
  publicJob,
  redactSecrets,
  slug,
} from "./helpers.js";
import { type ApiOf, type RouteDef, route } from "./route.js";

export interface ApiDeps {
  auth: Auth;
  db: Database;
  registry: Registry;
  pool: ConnectionPool;
  timeline: TimelineService;
  clips: ClipService;
  thumbnails: ThumbnailService;
  hub: StorageHub;
  startedAt: number;
  logger: Logger;
  logFiles: LogFiles;
}

const routes = <const T extends RouteDef[]>(...defs: T): T => defs;

const wizardBody = { connector: z.string(), connection: z.unknown() };

export function apiRoutes(deps: ApiDeps) {
  const { auth, db, registry, pool, timeline, clips, thumbnails, hub, startedAt, logger, logFiles } = deps;
  const openCamera = cameraOpener(db, pool);
  const listStorages = () => db.listStorages().map(record => ({ ...record, config: redactSecrets(record.config) }));

  return routes(
    route("/api/session", "GET", {
      handler: async ({ c }) => ({ signedIn: await auth.signedIn(c) }),
    }),

    route("/api/login", "POST", {
      body: { username: z.string(), password: z.string() },
      handler: async ({ c, body }) => {
        if (!auth.matches(body.username, body.password)) {
          await new Promise(resolve => setTimeout(resolve, 500));
          logger.log({ level: "warn", message: "login failed", username: body.username });
          throw new HTTPException(401, { message: "wrong username or password" });
        }
        await auth.signIn(c);
        return { ok: true };
      },
    }),

    route("/api/logout", "POST", {
      handler: ({ c }) => {
        auth.signOut(c);
        return { ok: true };
      },
    }),

    route("/api/status", "GET", {
      handler: () => {
        const nvrs = db.listNvrs();
        const statuses = new Map<string, ConnectionStatus>();
        for (const nvr of nvrs) {
          const status = pool.status(nvr.id);
          if (status) statuses.set(nvr.id, status);
        }
        return statusSnapshot({
          startedAt,
          nvrs,
          cameraIds: new Map(nvrs.map(nvr => [nvr.id, db.listCameras(nvr.id).map(camera => camera.id)])),
          statuses,
          clips: clips.list(),
          storage: hub.get()?.label ?? null,
          thumbnailsEnabled: thumbnails.enabled,
          thumbnails: thumbnails.info(),
        });
      },
    }),

    route("/api/connectors", "GET", {
      handler: () => ({
        connectors: [...registry.connectors.values()].map(def => ({
          id: def.id,
          title: def.title,
          description: def.description ?? "",
          capabilities: def.capabilities,
          streams: def.streams,
          configSchema: jsonSchemaOf(def.connectionConfigSchema),
        })),
      }),
    }),

    route("/api/nvrs/test", "POST", {
      body: wizardBody,
      handler: async ({ body }) => {
        const conn = pool.temp(body.connector, body.connection);
        try {
          return await conn.test();
        } finally {
          conn.close();
        }
      },
    }),

    route("/api/nvrs/discover", "POST", {
      body: wizardBody,
      handler: async ({ body }) => {
        const conn = pool.temp(body.connector, body.connection);
        try {
          const test = await conn.test();
          if (!test.ok) throw new HTTPException(400, { message: test.error ?? "connection test failed" });
          return { cameras: await conn.discoverCameras(), model: test.model ?? null };
        } finally {
          conn.close();
        }
      },
    }),

    route("/api/nvrs", "GET", {
      handler: () => {
        const configs = new Map(db.listThumbnailConfigs().map(cfg => [cfg.cameraId, cfg]));
        const tagsOf = db.tagLookup();
        return {
          nvrs: db.listNvrs().map(nvr => {
            const def = registry.connector(nvr.connection.type);
            return {
              id: nvr.id,
              name: nvr.name,
              tags: tagsOf(nvr.id),
              connector: nvr.connection.type,
              capabilities: def.capabilities,
              streams: def.streams,
              cameras: db
                .listCameras(nvr.id)
                .map(camera => publicCamera(camera, configs.get(camera.id), tagsOf(camera.id))),
            };
          }),
        };
      },
    }),

    route("/api/nvrs", "POST", {
      body: {
        id: z.string().optional(),
        name: z.string().min(1),
        connector: z.string(),
        connection: z.unknown(),
        cameras: z.array(
          z.object({
            id: z.string().optional(),
            key: z.string(),
            name: z.string(),
            metadata: z.record(z.string(), z.unknown()),
          })
        ),
        thumbnails: z.boolean().optional(),
      },
      handler: ({ body }) => {
        const def = registry.connector(body.connector);
        const parsedConfig = def.connectionConfigSchema.parse(body.connection) as Record<string, unknown>;
        let nvrId: string;
        if (body.id) {
          nvrId = slug(body.id);
          if (!nvrId) throw new HTTPException(400, { message: `invalid nvr id: ${body.id}` });
          if (db.getNvr(nvrId)) throw new HTTPException(409, { message: `nvr already exists: ${nvrId}` });
        } else {
          nvrId = slug(body.name) || "nvr";
          let suffix = 2;
          while (db.getNvr(nvrId)) nvrId = `${slug(body.name) || "nvr"}-${suffix++}`;
        }
        const cameras = body.cameras.map(camera => ({
          id: camera.id ? slug(camera.id) : `${nvrId}-${slug(camera.key) || camera.key}`,
          nvrId,
          name: camera.name,
          metadata: { type: body.connector, ...camera.metadata },
        }));
        const taken = cameras.filter(camera => !camera.id || db.getCamera(camera.id));
        if (taken.length > 0) {
          throw new HTTPException(409, { message: `camera id invalid or taken: ${taken.map(c => c.id).join(", ")}` });
        }
        db.insertNvr(
          { id: nvrId, name: body.name, connection: { type: body.connector, ...parsedConfig } },
          cameras,
          body.thumbnails ?? true
        );
        pool.invalidate(nvrId);
        logger.log({
          level: "info",
          message: "nvr registered",
          nvr: nvrId,
          connector: body.connector,
          cameras: body.cameras.length,
        });
        return { id: nvrId };
      },
    }),

    route("/api/nvrs/:id", "GET", {
      handler: ({ params }) => {
        const nvr = db.getNvr(params.id);
        if (!nvr) throw new HTTPException(404, { message: "nvr not found" });
        const { type, ...connection } = nvr.connection;
        const tagsOf = db.tagLookup();
        return {
          id: nvr.id,
          name: nvr.name,
          tags: tagsOf(nvr.id),
          connector: type,
          connection: redactSecrets(connection),
          cameras: db
            .listCameras(nvr.id)
            .map(camera => ({ id: camera.id, name: camera.name, tags: tagsOf(camera.id) })),
        };
      },
    }),

    route("/api/nvrs/:id", "PUT", {
      body: {
        name: z.string().trim().min(1),
        connection: z.record(z.string(), z.unknown()),
        cameras: z.array(z.object({ id: z.string(), name: z.string().trim().min(1) })).optional(),
      },
      handler: ({ params, body }) => {
        const nvr = db.getNvr(params.id);
        if (!nvr) throw new HTTPException(404, { message: "nvr not found" });
        const { type, ...stored } = nvr.connection;
        const connection = registry
          .connector(type)
          .connectionConfigSchema.parse(mergeConfig(stored, body.connection)) as Record<string, unknown>;
        db.updateNvr({ id: nvr.id, name: body.name, connection: { type, ...connection } }, body.cameras ?? []);
        pool.invalidate(nvr.id);
        logger.log({ level: "info", message: "nvr updated", nvr: nvr.id });
        return { ok: true };
      },
    }),

    route("/api/nvrs/:id", "DELETE", {
      handler: ({ params }) => {
        if (!db.getNvr(params.id)) throw new HTTPException(404, { message: "nvr not found" });
        pool.invalidate(params.id);
        db.deleteNvr(params.id);
        logger.log({ level: "info", message: "nvr removed", nvr: params.id });
        return { ok: true };
      },
    }),

    route("/api/timeline", "GET", {
      query: { nvr: z.string(), from: z.coerce.number().int(), to: z.coerce.number().int() },
      handler: async ({ query }) => {
        if (query.to <= query.from) throw new HTTPException(400, { message: "to must be after from" });
        const def = pool.connectorOf(query.nvr);
        if (!def) throw new HTTPException(404, { message: "nvr not found" });
        if (!def.capabilities.recordings) {
          throw new HTTPException(400, { message: `${def.title} does not support recordings` });
        }
        return timeline.get(query.nvr, query.from, query.to);
      },
    }),

    route("/api/clips", "POST", {
      body: clipQuery,
      handler: async ({ body }) => {
        checkClipRange(body);
        const { stream } = openCamera(body.camera, "playback", body.stream);
        const job = await clips.create({
          camera: body.camera,
          start: body.start,
          end: body.end,
          stream,
          transcode: body.transcode === "h264",
        });
        return publicJob(job);
      },
    }),

    route("/api/clips/:id", "GET", {
      handler: ({ params }) => {
        const job = clips.get(params.id);
        if (!job) throw new HTTPException(404, { message: "clip not found" });
        return publicJob(job);
      },
    }),

    route("/api/settings/thumbnails", "POST", {
      body: { enabled: z.boolean() },
      handler: ({ body: { enabled } }) => {
        if (enabled) thumbnails.start();
        else thumbnails.stop();
        db.setSetting("thumbnails.enabled", enabled ? "1" : "0");
        logger.log({ level: "info", message: "thumbnail capture switched", enabled });
        return { ok: true, enabled };
      },
    }),

    route("/api/storages", "GET", {
      handler: () => ({
        types: [...registry.storages.values()].map(def => ({
          id: def.id,
          title: def.title,
          description: def.description ?? "",
          configSchema: jsonSchemaOf(def.configSchema),
        })),
        storages: listStorages(),
        defaultStorage: db.getSetting("defaultStorage"),
        thumbnails: thumbnails.enabled,
      }),
    }),

    route("/api/storages", "POST", {
      body: { id: z.string().optional(), type: z.string(), config: z.unknown() },
      handler: ({ body }) => {
        const parsed = registry.storage(body.type).configSchema.parse(body.config) as Record<string, unknown>;
        const id = body.id ? slug(body.id) : slug(`${body.type}-${Date.now().toString(36)}`);
        db.upsertStorage({ id, type: body.type, config: parsed });
        hub.invalidate(id);
        if (!db.getSetting("defaultStorage")) hub.setDefault(id);
        logger.log({ level: "info", message: "storage added", storage: id, type: body.type });
        return { ok: true, id };
      },
    }),

    route("/api/storages/:id", "PUT", {
      body: { config: z.record(z.string(), z.unknown()) },
      handler: ({ params, body }) => {
        const record = db.getStorage(params.id);
        if (!record) throw new HTTPException(404, { message: "storage not found" });
        const parsed = registry.storage(record.type).configSchema.parse(mergeConfig(record.config, body.config));
        db.upsertStorage({ id: record.id, type: record.type, config: parsed as Record<string, unknown> });
        hub.invalidate(record.id);
        logger.log({ level: "info", message: "storage updated", storage: record.id });
        return { ok: true };
      },
    }),

    route("/api/storages/:id", "DELETE", {
      handler: ({ params }) => {
        if (!db.getStorage(params.id)) throw new HTTPException(404, { message: "storage not found" });
        if (db.getSetting("defaultStorage") === params.id) {
          throw new HTTPException(409, { message: "this is the default storage; make another one default first" });
        }
        db.deleteStorage(params.id);
        hub.invalidate(params.id);
        logger.log({ level: "info", message: "storage deleted", storage: params.id });
        return { ok: true };
      },
    }),

    route("/api/storages/default", "POST", {
      body: { id: z.string() },
      handler: ({ body: { id } }) => {
        hub.setDefault(id);
        return { ok: true, id };
      },
    }),

    route("/api/thumbnails", "GET", {
      query: { camera: z.string(), from: z.coerce.number().int(), to: z.coerce.number().int() },
      handler: ({ query }) => ({ ts: db.listThumbnails(query.camera, query.from, query.to) }),
    }),

    route("/api/thumbnails/config", "GET", {
      handler: () => ({
        nvrs: db.listNvrs().map(nvr => ({ id: nvr.id, name: nvr.name, connector: nvr.connection.type })),
        cameras: db.listThumbnailConfigs().map(cfg => {
          const camera = db.getCamera(cfg.cameraId);
          return {
            ...cfg,
            nvrId: camera?.nvrId ?? null,
            name: camera?.name ?? cfg.cameraId,
            state: thumbnails.state(cfg.cameraId),
          };
        }),
      }),
    }),

    route("/api/thumbnails/config/bulk", "POST", {
      body: { cameraIds: z.array(z.string()).min(1), enabled: z.boolean() },
      handler: ({ body }) => {
        const configs = db.listThumbnailConfigs();
        for (const id of body.cameraIds) {
          if (!db.getCamera(id)) continue;
          const current = configs.find(cfg => cfg.cameraId === id);
          db.upsertThumbnailConfig({
            cameraId: id,
            enabled: body.enabled,
            storageId: current?.storageId ?? null,
            frequencyS: current?.frequencyS ?? DEFAULT_THUMBNAIL_FREQUENCY_S,
          });
        }
        logger.log({
          level: "info",
          message: "thumbnail config changed",
          cameras: body.cameraIds.length,
          enabled: body.enabled,
        });
        return { ok: true };
      },
    }),

    route("/api/thumbnails/config", "POST", {
      body: {
        cameraId: z.string(),
        enabled: z.boolean().optional(),
        storageId: z.string().nullable().optional(),
        frequencyS: z.number().int().min(5).max(86_400).optional(),
      },
      handler: ({ body }) => {
        if (!db.getCamera(body.cameraId)) throw new HTTPException(404, { message: "camera not found" });
        const current = db.listThumbnailConfigs().find(cfg => cfg.cameraId === body.cameraId);
        const merged = {
          cameraId: body.cameraId,
          enabled: body.enabled ?? current?.enabled ?? true,
          storageId: body.storageId === undefined ? (current?.storageId ?? null) : body.storageId,
          frequencyS: body.frequencyS ?? current?.frequencyS ?? DEFAULT_THUMBNAIL_FREQUENCY_S,
        };
        db.upsertThumbnailConfig(merged);
        logger.log({
          level: "info",
          message: "thumbnail config changed",
          camera: merged.cameraId,
          enabled: merged.enabled,
          frequencyS: merged.frequencyS,
          storage: merged.storageId,
        });
        return merged;
      },
    }),

    route("/api/tags", "GET", { handler: () => ({ tags: db.distinctTags() }) }),

    route("/api/tags/:id", "PUT", {
      body: { tags: z.array(tagSchema).max(50) },
      handler: ({ params, body }) => {
        if (!db.getNvr(params.id) && !db.getCamera(params.id)) {
          throw new HTTPException(404, { message: "no nvr or camera with that id" });
        }
        db.setTags(params.id, body.tags);
        logger.log({
          level: "info",
          message: "tags set",
          id: params.id,
          tags: body.tags.map(tag => `${tag.type}=${tag.value}`).join(", "),
        });
        return { ok: true };
      },
    }),

    route("/api/keys", "GET", { handler: () => ({ keys: db.listApiKeys() }) }),

    route("/api/keys", "POST", {
      body: { name: z.string().trim().min(1).max(100) },
      handler: ({ body }) => {
        const { record, key } = createApiKey(db, body.name);
        logger.log({ level: "info", message: "api key created", name: record.name, hint: record.hint });
        return { ...record, key };
      },
    }),

    route("/api/keys/:id", "DELETE", {
      handler: ({ params }) => {
        if (!db.deleteApiKey(params.id)) throw new HTTPException(404, { message: "api key not found" });
        logger.log({ level: "info", message: "api key revoked", key: params.id });
        return { ok: true };
      },
    }),

    route("/api/logs", "GET", {
      query: {
        level: z.enum(LOG_LEVELS).default("info"),
        scope: z.enum(LOG_SCOPES).optional(),
        q: z.string().trim().min(1).max(200).optional(),
        before: z.coerce.number().int().optional(),
        after: z.coerce.number().int().optional(),
        limit: z.coerce.number().int().min(1).max(500).default(200),
      },
      handler: async ({ query }) => ({
        entries: await logFiles.query({
          levels: LOG_LEVELS.slice(LOG_LEVELS.indexOf(query.level)),
          scope: query.scope ?? null,
          text: query.q ?? null,
          before: query.before ?? null,
          after: query.after ?? null,
          limit: query.limit,
        }),
      }),
    }),

    route("/api/v1/cameras", "GET", {
      query: { filter: jsonQuery(camerasFilter).optional() },
      handler: ({ query }) => {
        const configs = new Map(db.listThumbnailConfigs().map(cfg => [cfg.cameraId, cfg]));
        const tagsOf = db.tagLookup();
        const nvrs = db.listNvrs().map(nvr => ({
          id: nvr.id,
          name: nvr.name,
          tags: tagsOf(nvr.id),
          cameras: db
            .listCameras(nvr.id)
            .map(camera => publicCamera(camera, configs.get(camera.id), tagsOf(camera.id))),
        }));
        return { nvrs: filterCameras(nvrs, query.filter) };
      },
    })
  );
}

export type WatchtowerApi = ApiOf<ReturnType<typeof apiRoutes>>;
