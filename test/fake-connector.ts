import type {
  ConnectionStatus,
  ConnectorConnection,
  ConnectorContext,
  RawFrame,
  Recording,
  StreamOptions,
  VideoSubscription,
} from "../src/core/connector.js";
import { Subject } from "../src/core/observable.js";

// An in-memory connector: each camera recorded the given UTC spans; playback
// emits one keyframe per second from startMs.
export class FakeConnection implements ConnectorConnection {
  private readonly live = new Set<string>();
  readonly playbackStreams: string[] = [];

  constructor(
    private readonly ctx: ConnectorContext,
    private readonly recordings: Recording[]
  ) {}

  private known(cameraId: string): boolean {
    return this.ctx.cameras.some(camera => camera.id === cameraId);
  }

  async test() {
    return { ok: true, model: "fake" };
  }

  async discoverCameras() {
    return [{ key: "a", name: "A", metadata: { slot: 0 } }];
  }

  private stream(cameraId: string, startMs: number | null, onStop: () => void): VideoSubscription {
    const frames = new Subject<RawFrame>();
    if (!this.known(cameraId)) {
      frames.close();
      const opened = Promise.reject(new Error(`unknown camera: ${cameraId}`));
      opened.catch(() => undefined);
      return { frames, opened, stop: () => undefined };
    }
    let t = startMs ?? Date.now();
    const timer = setInterval(() => {
      frames.push({ kind: "frame", codec: "h264", data: Buffer.from([0, 0, 0, 1, 0x65]), timestampMs: t, key: true });
      t += 1000;
    }, 1);
    return {
      frames,
      opened: Promise.resolve(),
      stop: () => {
        clearInterval(timer);
        frames.close();
        onStop();
      },
    };
  }

  subscribeLive(cameraId: string, _opts?: StreamOptions): VideoSubscription {
    this.live.add(cameraId);
    return this.stream(cameraId, null, () => this.live.delete(cameraId));
  }

  subscribePlayback(cameraId: string, startMs: number, opts?: StreamOptions): VideoSubscription {
    this.playbackStreams.push(opts?.stream ?? "main");
    return this.stream(cameraId, startMs, () => undefined);
  }

  async listRecordings(cameraIds: string[], fromMs: number, toMs: number): Promise<Recording[]> {
    return this.recordings
      .filter(rec => cameraIds.includes(rec.cameraId))
      .map(rec => ({ ...rec, start: Math.max(rec.start, fromMs), end: Math.min(rec.end, toMs) }))
      .filter(rec => rec.end > rec.start);
  }

  status(): ConnectionStatus {
    return { connected: true, error: null, usedAt: Date.now(), liveCameras: [...this.live] };
  }

  close(): void {}
}
