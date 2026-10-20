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
// The main thread blocks synchronously on `Atomics.wait`, which stops its own event loop: a
// 'message' or 'error' listener on the worker object would be queued but never delivered while
// blocked, so there is no way to react to one. Only a raw `Atomics.notify` on a shared flag --
// called directly by the worker thread, not from a main-thread callback -- can wake it; the
// result itself crosses on a transferred `MessagePort`, read back with the synchronous
// `receiveMessageOnPort` (no event loop needed) once the wait returns. A worker that never
// notifies (it is missing, or it crashes before posting) is indistinguishable from one still
// working, and is reported as unsafe when the ceiling passes -- the safe default when the check
// could not be completed.
//
// Fix round 1 also checks the compiled worker file exists before spawning anything: it is missing
// only when this module runs straight from TypeScript source with no build step, the case in this
// package's own tests, and an attempt to load it would still cost the full `wallClockMs` (a
// module-not-found error from inside the worker reaches the main thread the same asynchronous way
// a 'message' would, so it cannot preempt the wait either). Production always runs the built
// `dist`, where the worker file sits next to this one.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MessageChannel, receiveMessageOnPort, Worker } from 'node:worker_threads';
import { checkSafeRegex, type TimingOptions } from './safeRegex.js';

// Resolved lazily, not at module load (1.7 fix round 1): a bundler that evaluates this module
// outside its own realm (Next's build-time "collect page data" step, reached once the age gate,
// task 1.7, imports the locale loader) can hand `import.meta.url` back as a URL from a different
// realm, and Node's `fileURLToPath` rejects that with ERR_INVALID_ARG_TYPE even though it reads
// as a URL. Nothing here runs until the first real check, well after module load.
let workerFile: { url: URL; path: string } | undefined;

function getWorkerFile(): { url: URL; path: string } {
  if (!workerFile) {
    const url = new URL('./safeRegexWorkerEntry.js', import.meta.url);
    workerFile = { url, path: fileURLToPath(url) };
  }
  return workerFile;
}

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
  const file = getWorkerFile();
  if (!existsSync(file.path)) return checkSafeRegex(source, opts); // no compiled worker file on disk: in-process, tests only

  const flag = new Int32Array(new SharedArrayBuffer(4));
  const { port1, port2 } = new MessageChannel();
  let worker: Worker;
  try {
    worker = new Worker(file.url, {
      workerData: { source, opts: serializableOpts(opts), port: port2, flag },
      transferList: [port2],
    });
  } catch {
    port1.close();
    port2.close();
    return checkSafeRegex(source, opts); // could not even start a worker: in-process, tests only
  }
  // `Atomics.wait` blocks this thread's event loop, so a worker's 'error' event (it threw inside
  // `checkSafeRegex`, or crashed some other way) is always queued and delivered only after the
  // wait already returned -- there is no way for this listener to preempt or shorten the wait. It
  // exists only so that later delivery finds a listener: with none, Node treats the event as an
  // uncaught exception and crashes the host process (fix round 2, typescript-reviewer). The guard
  // already reports the pattern as unsafe either way: the flag was never notified, so the ceiling
  // branch below fires regardless of whether the worker threw or is merely still running.
  worker.on('error', () => undefined);
  Atomics.wait(flag, 0, 0, wallClockMs);
  const answered = Atomics.load(flag, 0) === 1;
  const received = answered ? receiveMessageOnPort(port1) : undefined;
  void worker.terminate();
  port1.close();
  if (received !== undefined) return messageShape(received.message);
  return [`exceeded the ${wallClockMs} ms hard limit for the load/validate path (terminated)`];
}

/**
 * `received.message` crossed a `MessagePort` from another thread, so nothing guarantees its shape
 * at the type level. An unexpected shape is reported as unsafe rather than trusted (fix round 2,
 * typescript-reviewer): the safe default when the check could not be completed as expected.
 */
function messageShape(message: unknown): string[] {
  if (Array.isArray(message) && message.every((m) => typeof m === 'string')) return message;
  return ['the worker answered with an unexpected shape'];
}
