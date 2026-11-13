// Serializes short-lived data sessions per NVR. The protocol has no per-channel
// close, so two simultaneous open-channel sessions on one NVR compete for the
// same uplink and can starve each other's keyframes.
export class DataSessionLock {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release = (): void => {};
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    this.tails.set(
      key,
      previous.then(() => gate)
    );
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}
