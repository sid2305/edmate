// Task 3.9d: the clock the worker's real-I/O turn tests run on. Same approach as apps/cli's 3.9b
// fix (`slackClock` in apps/cli/src/commands/chat/deps.ts); a small local copy, since no shared
// test-helper package exists and apps/worker must not depend on apps/cli.
import type { Clock } from '@edmate/harness';

/**
 * The slack the int tests give every harness step budget. On a loaded CI runner a cold first
 * turn's preGuard overran its 400 ms budget on the real clock and failed closed with
 * `guard_blocked` (PR #90, safetyEvent.int.test.ts). Production budgets and clocks are unchanged.
 */
export const STEP_BUDGET_SLACK = 10;

/** A real clock (`Date.now()`/`setTimeout`); a cancelled sleep resolves at once. */
function realClock(): Clock {
  return {
    now: () => Date.now(),
    sleep: (ms, cancel) =>
      new Promise((resolve) => {
        const t = setTimeout(resolve, ms);
        cancel?.onCancel(() => {
          clearTimeout(t);
          resolve();
        });
      }),
  };
}

/**
 * A real clock that runs `factor` times slower: `sleep(ms)` waits `ms * factor` real ms and
 * `now()` advances 1 ms per `factor` real ms. Both slow together, because the harness races step
 * timeouts on `sleep` and also subtracts `now()` deltas from budgets. Still a real clock, so real
 * Redis/Postgres I/O is not read as a deadlock (which a virtual clock would do).
 */
export function slackClock(factor: number = STEP_BUDGET_SLACK): Clock {
  const real = realClock();
  const origin = real.now();
  return {
    now: () => origin + Math.floor((real.now() - origin) / factor),
    sleep: (ms, cancel) => real.sleep(ms * factor, cancel),
  };
}
