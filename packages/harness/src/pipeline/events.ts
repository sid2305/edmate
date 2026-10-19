// A small push/close async queue: the runner pushes events, the caller iterates them.
// No backpressure: the turn never waits for its consumer.

export class EventQueue<T> implements AsyncIterable<T> {
  private readonly buffer: T[] = [];
  private waiting: ((r: IteratorResult<T>) => void) | undefined;
  private closed = false;
  private detached = false;
  private iterated = false;
  private readonly detachListeners: (() => void)[] = [];

  /** Runs `fn` once when the consumer stops early (calls `return()` before the end). */
  onDetach(fn: () => void): void {
    if (this.detached) fn();
    else this.detachListeners.push(fn);
  }

  push(item: T): void {
    if (this.closed || this.detached) return;
    if (this.waiting !== undefined) {
      const w = this.waiting;
      this.waiting = undefined;
      w({ value: item, done: false });
    } else {
      this.buffer.push(item);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.waiting !== undefined) {
      const w = this.waiting;
      this.waiting = undefined;
      w({ value: undefined, done: true });
    }
  }

  get isClosed(): boolean {
    return this.closed;
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    if (this.iterated) throw new Error('turn events can only be iterated once');
    this.iterated = true;
    return {
      next: () => {
        const item = this.buffer.shift();
        if (item !== undefined) return Promise.resolve({ value: item, done: false });
        if (this.closed || this.detached) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => {
          this.waiting = resolve;
        });
      },
      // The consumer stopped early: drop later events and tell the runner (it cancels generate);
      // the turn itself still runs meter, commit and the trace.
      return: () => {
        const first = !this.detached;
        this.detached = true;
        this.buffer.length = 0;
        if (first) for (const fn of this.detachListeners.splice(0)) fn();
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }
}
