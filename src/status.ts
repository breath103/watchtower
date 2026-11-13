import type { ConnectionStatus } from "./core/connector.js";
import type { NvrRecord } from "./core/types.js";
import type { ClipJob } from "./services/clips.js";
import type { ThumbnailInfo } from "./services/thumbnails.js";

export interface StatusSnapshot {
  startedAt: string;
  storage: string | null;
  thumbnailsEnabled: boolean;
  nvrs: Array<{
    id: string;
    name: string;
    connector: string;
    cameraIds: string[];
    control: ConnectionStatus;
  }>;
  clips: {
    total: number;
    queued: number;
    running: number;
    ready: number;
    failed: number;
  };
  thumbnails: ThumbnailInfo | null;
}

const NOT_CONNECTED: ConnectionStatus = { connected: false, error: "not connected", usedAt: 0, liveCameras: [] };

export function statusSnapshot(opts: {
  startedAt: number;
  nvrs: NvrRecord[];
  cameraIds: Map<string, string[]>;
  statuses: Map<string, ConnectionStatus>;
  clips: ClipJob[];
  storage: string | null;
  thumbnailsEnabled: boolean;
  thumbnails: ThumbnailInfo | null;
}): StatusSnapshot {
  const { startedAt, nvrs, cameraIds, statuses, clips, storage, thumbnailsEnabled, thumbnails } = opts;
  const count = (status: ClipJob["status"]) => clips.filter(job => job.status === status).length;
  return {
    startedAt: new Date(startedAt).toISOString(),
    storage,
    thumbnailsEnabled,
    nvrs: nvrs.map(nvr => ({
      id: nvr.id,
      name: nvr.name,
      connector: nvr.connection.type,
      cameraIds: cameraIds.get(nvr.id) ?? [],
      control: statuses.get(nvr.id) ?? NOT_CONNECTED,
    })),
    clips: {
      total: clips.length,
      queued: count("queued"),
      running: count("running"),
      ready: count("ready"),
      failed: count("failed"),
    },
    thumbnails,
  };
}
