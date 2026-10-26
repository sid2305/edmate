// Shared cancel/timeout/validate idiom (3.3a: 3.3 review found `askIntentModel` and
// `askClassifier` repeating the same wiring). Each caller keeps its own error classes, messages
// and guard-name arguments; this only shares the race-and-validate mechanics, not behaviour.
import type { z } from 'zod';
import type { CancelToken, Clock } from './clock.js';
import { runWithTimeout } from './timeout.js';

/** The error to throw for each failure the race can produce. */
export interface GuardedCallErrors {
  cancelled(): Error;
  timedOut(ms: number): Error;
  invalid(): Error;
}

/**
 * Races `call()` against `timeoutMs` on `clock`, cancellable via `cancel`. Throws
 * `errors.cancelled()` if already cancelled or cancelled mid-call, `errors.timedOut(ms)` on
 * timeout, rethrows a call error as-is, and `errors.invalid()` if the resolved value fails
 * `schema`. Returns the parsed value otherwise.
 */
export async function callGuarded<T>(
  cancel: CancelToken,
  clock: Clock,
  call: () => Promise<unknown>,
  schema: z.ZodType<T>,
  timeoutMs: number,
  errors: GuardedCallErrors,
): Promise<T> {
  if (cancel.cancelled) throw errors.cancelled();
  const r = await runWithTimeout(
    () =>
      new Promise<unknown>((resolve, reject) => {
        cancel.onCancel(() => reject(errors.cancelled()));
        call().then(resolve, reject);
      }),
    timeoutMs,
    clock,
  );
  if (r.status === 'timeout') throw errors.timedOut(timeoutMs);
  if (r.status === 'error') throw r.error;
  const parsed = schema.safeParse(r.value);
  if (!parsed.success) throw errors.invalid();
  return parsed.data;
}
