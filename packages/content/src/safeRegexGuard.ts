// A hard wall-clock ceiling on `checkSafeRegex` (task 3.10, fix round 1; security review of PR
// #57). The structural check and the in-process timing probe in `safeRegex.ts` catch almost every
// catastrophic pattern, but a pattern class neither anticipates could still stall the process that
// loads or validates locale packs. `checkSafeRegexGuarded` runs the full check in a
// `node:worker_threads` worker and kills it if it does not answer within `wallClockMs` (default
// 2,000 ms), reporting the pattern as unsafe instead of hanging.
//
// Used only on the load/validate path -- `edmate content validate` (`localeRules.ts`) and
// `loadLocalePacks` (`localePacks.ts`) -- never per turn: the guard that scrubs PII on every
// student message runs the already-vetted compiled pattern directly, with no check at all.
//
// The main thread blocks synchronously on `Atomics.wait`, so callers keep the same synchronous
// shape as `checkSafeRegex`: a worker thread can call `Atomics.notify` while the main thread is
// waiting, which a same-thread callback cannot. If the worker cannot start at all -- the compiled
// `safeRegexWorkerEntry.js` is missing, which happens only when this module runs straight from
// TypeScript source with no build step, the case in this package's own tests -- the check runs
// in-process instead, with no hard ceiling; production always runs the built `dist`, where the
// worker file sits next to this one.
import { Worker } from 'node:worker_threads';
import { checkSafeRegex, type TimingOptions } from './safeRegex.js';

const WORKER_URL = new URL('./safeRegexWorkerEntry.js', import.meta.url);

/** Only the plain-data parts of `TimingOptions`: `now` is a function and cannot cross a worker boundary. */
function serializableOpts(opts: TimingOptions): TimingOptions {
  const { budgetMs, attempts, units } = opts;
  const out: TimingOptions = {};
  if (budgetMs !== undefined) out.budgetMs = budgetMs;
  if (attempts !== undefined) out.attempts = attempts;
  if (units !== undefined) out.units = units;
  return out;
}

/**
 * `checkSafeRegex(source, opts)`, run with a hard wall-clock limit of `wallClockMs` (default
 * 2,000). A pattern that would otherwise stall is reported as unsafe instead, never run longer
 * than the limit on the thread that called this.
 */
export function checkSafeRegexGuarded(
  source: string,
  opts: TimingOptions = {},
  wallClockMs = 2_000,
): string[] {
  const flag = new Int32Array(new SharedArrayBuffer(4));
  let worker: Worker;
  try {
    worker = new Worker(WORKER_URL, { workerData: { source, opts: serializableOpts(opts) } });
  } catch {
    return checkSafeRegex(source, opts); // no compiled worker file on disk: in-process, tests only
  }
  let result: string[] | undefined;
  worker.on('message', (msg: string[]) => {
    result = msg;
    Atomics.store(flag, 0, 1);
    Atomics.notify(flag, 0);
  });
  worker.on('error', () => {
    Atomics.store(flag, 0, 2);
    Atomics.notify(flag, 0);
  });
  Atomics.wait(flag, 0, 0, wallClockMs);
  const state = Atomics.load(flag, 0);
  void worker.terminate();
  if (state === 1 && result !== undefined) return result;
  if (state === 2) return checkSafeRegex(source, opts); // worker could not run it: in-process, tests only
  return [`exceeded the ${wallClockMs} ms hard limit for the load/validate path (terminated)`];
}
