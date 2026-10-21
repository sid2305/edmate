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
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MessageChannel, receiveMessageOnPort, Worker } from 'node:worker_threads';
import { checkSafeRegex, type TimingOptions } from './safeRegex.js';

// Resolved lazily, not at module load (1.7 fix round 1): a bundler that evaluates this module
// outside its own realm (Next's build-time "collect page data" step, reached once the age gate,
// task 1.7, imports the locale loader) can hand `import.meta.url` back as a URL from a different
// realm, and Node's `fileURLToPath` rejects that with ERR_INVALID_ARG_TYPE even though it reads
// as a URL. Nothing here runs until the first real check, well after module load.
//
// 1.7b: the path is built with `fileURLToPath` + `path.join`, never `new URL(<literal>,
// import.meta.url)`. That exact expression is webpack 5's (and Turbopack's) built-in "URL asset"
// convention: a production Next build parses it and copies only `safeRegexWorkerEntry.js`'s own
// bytes to a hashed output path, without resolving that file's own relative import of
// `safeRegex.js`. The worker then fails to load, every check hits the wall-clock ceiling, and
// every pattern is reported unsafe (the IN pack's real PII patterns among them). Passing a plain
// string path to `Worker` (it accepts either a `URL` or a string) avoids the asset-URL rewrite
// entirely -- nothing bundler-specific is left for either bundler to misparse.
let workerFile: { path: string } | undefined;

// Fix round (security review of PR #76): `next build --webpack` still folds `@edmate/content`
// into the app's own server chunk even with `serverExternalPackages: ['@edmate/content']`
// (`apps/web/next.config.ts`) -- that option's "is this under node_modules" check runs on the
// *resolved* real path, and a pnpm workspace package's real path (`packages/content/dist/**`)
// sits outside any node_modules tree, so the check misses it. Bundled, `import.meta.url` is
// rewritten by webpack to the build machine's own absolute source path -- correct only there, not
// in the Docker image (built in `/repo`, run from `/app`) or any relocated standalone copy.
// Deriving the fallback from `process.cwd()` does not work either: Next's own standalone
// `server.js` calls `process.chdir(__dirname)` before anything else runs, so the server's cwd is
// always its *own* directory (`<server root>/apps/web`), not the server root -- a depth this
// package has no business assuming about whichever app embeds it.
//
// `bySibling` below (the path this guard always used) stays correct for the real, unbundled
// `dist` -- this package's own tests, `edmate content validate`, any non-bundled runtime -- so it
// is tried first and used whenever it genuinely exists on disk. Only when it does not (the
// bundled-and-relocated case) does `EDMATE_CONTENT_WORKER_DIR` take over: an explicit, env-set
// absolute directory holding this package's compiled `dist/` (its embedder's responsibility to
// set correctly -- `apps/web/Dockerfile` sets it to the Docker image's own known layout; the
// build-smoke test sets it to its relocated copy's layout). No path here is ever baked by a
// bundler: `process.env` is read at call time, same as `process.cwd()`, just without the
// standalone server's own `chdir` getting in the way.
function getWorkerFile(): { path: string } {
  if (!workerFile) {
    const here = fileURLToPath(import.meta.url);
    const bySibling = path.join(path.dirname(here), 'safeRegexWorkerEntry.js');
    const dir = process.env.EDMATE_CONTENT_WORKER_DIR;
    const byEnv = dir ? path.join(dir, 'safeRegexWorkerEntry.js') : undefined;
    const filePath = existsSync(bySibling) ? bySibling : (byEnv ?? bySibling);
    workerFile = { path: filePath };
  }
  return workerFile;
}

// Fix round (security review of PR #76): the in-process fallback below is meant for this
// package's own tests and for `edmate content validate` run straight from TypeScript source --
// cases where there genuinely is no build step, so the worker file genuinely cannot exist, and
// running `checkSafeRegex` in-process (no wall-clock limit, but also nothing to time out on a
// developer's own machine) is a reasonable substitute. In a production *runtime* the fallback
// means something else: the compiled worker file -- and the app's compiled copy of
// `@edmate/content` generally -- went missing after the build (a bundler inlined
// `@edmate/content` into a server chunk and dropped its `dist/**` siblings, a container image's
// standalone copy didn't carry `dist/**` along, ...). Reporting every pattern as unsafe without
// a time limit (the fallback's literal behaviour today) silently drops the limit a production
// deployment depends on -- failing open, not closed, exactly where this guard must not. Treat a
// missing worker as unsafe instead whenever `NODE_ENV=production`, logged once so the gap is
// visible in production logs without spamming them per pattern checked.
let loggedMissingWorkerInProduction = false;

function unsafeInProduction(): string[] {
  if (!loggedMissingWorkerInProduction) {
    loggedMissingWorkerInProduction = true;
    console.error(
      '[@edmate/content] safeRegexGuard: the compiled safe-regex worker is missing in ' +
        'production; every pattern is being reported unsafe (failing closed) until this is fixed',
    );
  }
  return ['the compiled safe-regex worker is missing in production (failing closed)'];
}

function inProcessOrFailClosed(source: string, opts: TimingOptions): string[] {
  if (process.env.NODE_ENV === 'production') return unsafeInProduction();
  return checkSafeRegex(source, opts); // no compiled worker file: dev and test only
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
  if (!existsSync(file.path)) return inProcessOrFailClosed(source, opts);

  const flag = new Int32Array(new SharedArrayBuffer(4));
  const { port1, port2 } = new MessageChannel();
  let worker: Worker;
  try {
    worker = new Worker(file.path, {
      workerData: { source, opts: serializableOpts(opts), port: port2, flag },
      transferList: [port2],
    });
  } catch {
    port1.close();
    port2.close();
    return inProcessOrFailClosed(source, opts); // could not even start a worker
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
