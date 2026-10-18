// Every step runs with its own timeout on the injected clock (build plan § Turn pipeline spec).
import { cancelSource, type CancelToken, type Clock } from './clock.js';

export type TimedResult<T> =
  | { status: 'ok'; value: T; ms: number }
  | { status: 'error'; error: unknown; ms: number }
  | { status: 'timeout'; ms: number };

/**
 * Races `fn` against `clock.sleep(ms)`. Whichever settles first wins; then the cancel token fires,
 * which drops the timer and tells the step to stop. A late result is ignored and a late rejection
 * is caught, so it never surfaces as an unhandled rejection. Never rejects.
 */
export async function runWithTimeout<T>(
  fn: (cancel: CancelToken) => Promise<T>,
  ms: number,
  clock: Clock,
): Promise<TimedResult<T>> {
  const started = clock.now();
  if (!(ms > 0)) return { status: 'timeout', ms: 0 };
  const source = cancelSource();
  const work = Promise.resolve()
    .then(() => fn(source.token))
    .then(
      (value) => ({ status: 'ok' as const, value }),
      (error: unknown) => ({ status: 'error' as const, error }),
    );
  const timer = clock.sleep(ms, source.token).then(() => ({ status: 'timeout' as const }));
  const winner = await Promise.race([work, timer]);
  source.cancel();
  return { ...winner, ms: clock.now() - started };
}
