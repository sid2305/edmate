// Injected time and ids for the turn pipeline (build plan § Turn pipeline spec, Determinism).
// Harness types, not contracts ports: they are parameters of `runTurn`, not adapters that the
// db, gateway or worker packages implement (3.1 decision). Production adapters come with the
// first real caller (3.9); tests use `virtualClock()` and `sequentialIds()` from harness/testing.

/** Runtime-neutral cancellation (no AbortSignal: the harness lib is ES2023 with no DOM types). */
export interface Cancel {
  onCancel(fn: () => void): void;
}

/** A cancel token a step can poll as well as subscribe to. */
export interface CancelToken extends Cancel {
  readonly cancelled: boolean;
}

export interface Clock {
  /** Epoch milliseconds. */
  now(): number;
  /** Resolves after `ms`; a cancelled sleep resolves at once and drops its timer. */
  sleep(ms: number, cancel?: Cancel): Promise<void>;
}

export type IdKind = 'turn' | 'message' | 'alert';

export interface IdSource {
  /** Must return a contracts-valid id (1-128 of A-Z a-z 0-9 _ -). */
  next(kind: IdKind): string;
}

/** ISO 8601 timestamp for an epoch-ms value from the injected clock. */
export const isoAt = (ms: number): string => new Date(ms).toISOString();

/** A cancel token plus the function that fires it. Listeners run once, in registration order. */
export function cancelSource(): { token: CancelToken; cancel(): void } {
  let cancelled = false;
  const listeners: (() => void)[] = [];
  const token: CancelToken = {
    get cancelled() {
      return cancelled;
    },
    onCancel(fn) {
      if (cancelled) fn();
      else listeners.push(fn);
    },
  };
  return {
    token,
    cancel() {
      if (cancelled) return;
      cancelled = true;
      for (const fn of listeners.splice(0)) fn();
    },
  };
}

/** A token that fires as soon as any of `tokens` fires (at once if one already has). */
export function linkCancel(...tokens: readonly CancelToken[]): CancelToken {
  const source = cancelSource();
  for (const t of tokens) t.onCancel(() => source.cancel());
  return source.token;
}
