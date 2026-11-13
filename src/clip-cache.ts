import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createWriteStream, existsSync, type WriteStream } from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { finished } from "node:stream/promises";
import { type CacheFrame, type Codec } from "./core/types.js";
import { remuxToMp4 } from "./ffmpeg.js";
import { MpegTsWriter } from "./mpegts.js";

export type { CacheFrame };

interface ClipCacheRequest {
  nvr: string;
  camera: string;
  start: number;
  end: number;
  stream: string;
  transcode?: boolean;
}

interface ClipCacheEntry {
  file: string;
  codec: Codec;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 60 * 60 * 1000;

export const clipCacheKey = (request: ClipCacheRequest): string =>
  [request.nvr, request.camera, request.start, request.end, request.stream, request.transcode ? "h264" : "source"].join(
    ":"
  );

// "v3:" salt: v1 was remuxed from fragment boundaries (bogus stss) and v2 from
// raw Annex-B where VOD keyframe-scramble fooled ffmpeg's key detection. v3
// feeds the same MpegTsWriter + remuxToMp4 pipeline the save jobs use — the
// one artifact proven to seek and play everywhere.
function hashKey(key: string): string {
  return createHash("sha256").update(`v3:${key}`).digest("hex");
}

class CacheWriter {
  private readonly stream: WriteStream;
  private muxer: MpegTsWriter | null = null;
  private codec: Codec | null = null;

  constructor(
    private readonly opts: {
      tsPath: string;
      final: string;
      meta: string;
      transcode: boolean;
      ttlMs: number;
    }
  ) {
    this.stream = createWriteStream(this.opts.tsPath);
  }

  async feed(frame: CacheFrame): Promise<void> {
    if (!this.muxer) {
      this.muxer = new MpegTsWriter(frame.codec);
      this.codec = frame.codec;
    }
    const packet = this.muxer.frame(frame.ptsMs, frame.data, frame.key);
    if (!this.stream.write(packet)) await once(this.stream, "drain");
  }

  async finish(): Promise<ClipCacheEntry> {
    if (!this.muxer || !this.codec) throw new Error("clip cache received no frames");
    this.stream.end();
    await finished(this.stream);
    await remuxToMp4(this.opts.tsPath, this.opts.final, this.codec, this.opts.transcode);
    await fsp.rm(this.opts.tsPath, { force: true });
    const entry: ClipCacheEntry = {
      file: this.opts.final,
      codec: this.opts.transcode && this.codec === "hevc" ? "h264" : this.codec,
      expiresAt: Date.now() + this.opts.ttlMs,
    };
    await fsp.writeFile(this.opts.meta, JSON.stringify(entry));
    return entry;
  }

  async abort(): Promise<void> {
    this.stream.destroy();
    await fsp.rm(this.opts.tsPath, { force: true });
  }
}

// A local MP4 cache for clip windows. A completed progressive stream fills it
// (fed from the same decoded chunks the browser streamed); a job also stores
// its finished MP4 here. Entries expire after TTL, removed lazily on read and
// at startup.
export class ClipCache {
  constructor(
    private readonly dir: string,
    private readonly ttlMs = DEFAULT_TTL_MS
  ) {}

  private paths(key: string) {
    const hash = hashKey(key);
    const dir = path.join(this.dir, hash);
    return {
      dir,
      final: path.join(dir, `${hash}.mp4`),
      meta: path.join(dir, "meta.json"),
    };
  }

  async get(key: string): Promise<ClipCacheEntry | null> {
    const { dir, final, meta } = this.paths(key);
    try {
      const entry = JSON.parse(await fsp.readFile(meta, "utf8")) as ClipCacheEntry;
      if (entry.expiresAt <= Date.now() || !existsSync(final)) {
        await fsp.rm(dir, { recursive: true, force: true });
        return null;
      }
      return { ...entry, file: final };
    } catch {
      return null;
    }
  }

  async putFile(key: string, source: string, codec: Codec): Promise<ClipCacheEntry> {
    const { dir, final, meta } = this.paths(key);
    await fsp.mkdir(dir, { recursive: true });
    const tmp = path.join(dir, `${randomUUID()}.mp4`);
    await fsp.copyFile(source, tmp);
    await fsp.rename(tmp, final);
    const entry = { file: final, codec, expiresAt: Date.now() + this.ttlMs };
    await fsp.writeFile(meta, JSON.stringify(entry));
    return entry;
  }

  async begin(key: string, transcode: boolean): Promise<CacheWriter> {
    const { dir, final, meta } = this.paths(key);
    await fsp.mkdir(dir, { recursive: true });
    const tsPath = path.join(dir, `${randomUUID()}.ts`);
    return new CacheWriter({ tsPath, final, meta, transcode, ttlMs: this.ttlMs });
  }

  async cleanup(): Promise<void> {
    const names = await fsp.readdir(this.dir).catch(() => []);
    await Promise.all(
      names.map(async name => {
        const dir = path.join(this.dir, name);
        try {
          const entry = JSON.parse(await fsp.readFile(path.join(dir, "meta.json"), "utf8")) as ClipCacheEntry;
          if (entry.expiresAt <= Date.now() || !existsSync(entry.file)) {
            await fsp.rm(dir, { recursive: true, force: true });
          }
        } catch {
          await fsp.rm(dir, { recursive: true, force: true });
        }
      })
    );
  }
}
