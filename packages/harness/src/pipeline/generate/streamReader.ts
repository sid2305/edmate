// Reads a model stream so that a cancel is seen at once (task 3.7). The frozen `ModelGateway`
// port has no abort signal (lead answer Q5), so each `next()` is raced against the cancel token;
// on cancel the reader stops waiting and calls the iterator's `return()` in the background. The
// SDK adapter aborts the provider request when `return()` reaches it, which is at the next chunk.
import { type ModelChunk, ModelChunkSchema } from '@edmate/contracts';
import type { CancelToken } from '../clock.js';
import { errorName, HarnessError, TurnCancelled } from '../errors.js';

/** The gateway sent a chunk that fails ModelChunkSchema. Names no content. */
export class InvalidChunkError extends HarnessError {
  override readonly name = 'InvalidChunkError';

  constructor() {
    super('the model stream sent an invalid chunk');
  }
}

/** The stream iterator's `return()` failed. Carries the error's name only. */
export class StreamCloseFailed extends HarnessError {
  override readonly name = 'StreamCloseFailed';

  constructor(readonly causeName: string) {
    super(`closing the model stream failed (${causeName})`);
  }
}

/** Rejects with TurnCancelled as soon as `cancel` fires; a late result or rejection is ignored. */
export function raceCancel<T>(work: Promise<T>, cancel: CancelToken): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    cancel.onCancel(() => reject(new TurnCancelled()));
    work.then(resolve, reject);
  });
}

export class StreamReader {
  private readonly iterator: AsyncIterator<unknown>;
  /** The reject of the next() in flight, so one cancel listener serves every read. */
  private waiting: ((e: unknown) => void) | undefined;
  private ended = false;
  private closed = false;

  constructor(
    stream: AsyncIterable<unknown>,
    private readonly cancel: CancelToken,
    private readonly report: (error: unknown) => void,
    private readonly track: (settled: Promise<unknown>) => void = () => undefined,
  ) {
    this.iterator = stream[Symbol.asyncIterator]();
    cancel.onCancel(() => {
      this.close();
      const w = this.waiting;
      this.waiting = undefined;
      w?.(new TurnCancelled());
    });
  }

  /** The next valid chunk; `undefined` when the stream ended. Throws TurnCancelled on cancel. */
  async next(): Promise<ModelChunk | undefined> {
    if (this.cancel.cancelled) throw new TurnCancelled();
    if (this.ended) return undefined;
    let r: IteratorResult<unknown>;
    try {
      r = await new Promise<IteratorResult<unknown>>((resolve, reject) => {
        this.waiting = reject;
        this.iterator.next().then(resolve, reject);
      });
    } catch (error) {
      this.close();
      throw error;
    } finally {
      this.waiting = undefined;
    }
    if (r.done === true) {
      this.ended = true;
      return undefined;
    }
    const parsed = ModelChunkSchema.safeParse(r.value);
    if (!parsed.success) {
      this.close();
      throw new InvalidChunkError();
    }
    return parsed.data;
  }

  /**
   * Stops the stream early: calls the iterator's `return()` once, in the background. A failure is
   * reported by error name only (StreamCloseFailed), never thrown. The close is handed to `track`
   * so the runner can wait for it (bounded) before `finished` resolves. Does nothing once the
   * stream ended or was closed.
   */
  close(): void {
    if (this.ended || this.closed) return;
    this.closed = true;
    const it = this.iterator;
    if (it.return === undefined) return;
    this.track(
      Promise.resolve()
        .then(() => it.return?.())
        .then(
          () => undefined,
          (error: unknown) => {
            this.report(new StreamCloseFailed(errorName(error)));
          },
        ),
    );
  }
}
