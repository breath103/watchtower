// A dependency-free push-based stream: connectors push frames, services pull
// them through tiny adapters. Chosen over AsyncIterable because fan-out
// (one device channel, many subscribers) and "stop without throwing" are the
// common cases here.

type Unsubscribe = () => void;

export interface Observable<T> {
  subscribe(next: (value: T) => void): Unsubscribe;
  // Fires once when the source terminates (device stop, socket drop, stop()).
  onClose(cb: () => void): Unsubscribe;
}

export class Subject<T> implements Observable<T> {
  private readonly observers = new Set<(value: T) => void>();
  private readonly closeObservers = new Set<() => void>();
  private closed = false;

  subscribe(next: (value: T) => void): Unsubscribe {
    if (this.closed) return () => undefined;
    this.observers.add(next);
    return () => {
      this.observers.delete(next);
    };
  }

  onClose(cb: () => void): Unsubscribe {
    if (this.closed) {
      cb();
      return () => undefined;
    }
    this.closeObservers.add(cb);
    return () => {
      this.closeObservers.delete(cb);
    };
  }

  push(value: T): void {
    if (this.closed) return;
    for (const observer of this.observers) observer(value);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.observers.clear();
    for (const cb of this.closeObservers) cb();
    this.closeObservers.clear();
  }

  get isClosed(): boolean {
    return this.closed;
  }
}

// Sequential pull adapter over a push stream, with timeout and termination.
// next() drains buffered values after the source closes, then returns null.
export class FramePull<T> {
  private readonly queue: T[] = [];
  private wake: (() => void) | null = null;
  private sourceClosed = false;
  // Set by close(); public read so pumps can end instead of looping on nulls.
  stopped = false;
  private readonly unsubscribe: Unsubscribe;
  private readonly unsubscribeClose: Unsubscribe;

  constructor(source: Observable<T>) {
    this.unsubscribe = source.subscribe(value => {
      this.queue.push(value);
      this.wakeNow();
    });
    this.unsubscribeClose = source.onClose(() => {
      this.sourceClosed = true;
      this.wakeNow();
    });
  }

  private wakeNow(): void {
    const resolve = this.wake;
    this.wake = null;
    resolve?.();
  }

  // Caller-driven teardown (viewer left, request aborted).
  close(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.unsubscribe();
    this.unsubscribeClose();
    this.wakeNow();
  }

  // Terminal: source ended AND drained — a null from next() while terminated
  // means "dead", while not terminated means "quiet, keep waiting".
  get terminated(): boolean {
    return this.sourceClosed && this.queue.length === 0;
  }

  async next(timeoutMs: number): Promise<T | null> {
    const head = this.queue.shift();
    if (head !== undefined) return head;
    if (this.stopped || this.sourceClosed) return null;
    return new Promise<T | null>(resolve => {
      const timer = setTimeout(
        () => {
          this.wake = null;
          resolve(null);
        },
        Math.max(0, timeoutMs)
      );
      this.wake = () => {
        clearTimeout(timer);
        resolve(this.queue.shift() ?? null);
      };
    });
  }
}
