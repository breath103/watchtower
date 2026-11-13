// Domain records — exactly what gets persisted (sqlite rows): an NVR is an
// id + name + a connector-typed connection blob; a camera belongs to an NVR and
// carries connector metadata.

export type Codec = "h264" | "hevc";

// connection: { type: "<connector id>", ...connector-specific config }
interface NvrConnectionConfig {
  type: string;
  [key: string]: unknown;
}

export interface NvrRecord {
  id: string;
  name: string;
  connection: NvrConnectionConfig;
}

// metadata: { type: "<connector id>", ...connector-specific camera facts }
interface CameraMetadata {
  type: string;
  [key: string]: unknown;
}

export interface CameraRecord {
  id: string;
  nvrId: string;
  name: string;
  metadata: CameraMetadata;
}

export interface ApiKeyRecord {
  id: string;
  name: string;
  hint: string;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface StorageRecord {
  id: string;
  type: string;
  config: Record<string, unknown>;
}

// One decoded chunk handed to the clip cache's MPEG-TS muxer.
export interface CacheFrame {
  data: Buffer;
  ptsMs: number;
  key: boolean;
  codec: Codec;
}
