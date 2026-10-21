// The one test in this package that runs the real `node:worker_threads` / `Atomics` / `MessagePort`
// protocol end to end (task 3.10, fix round 2; typescript-reviewer: the other tests either take
// the no-`dist` in-process fallback (`safeRegexGuard.test.ts`) or mock `node:worker_threads`
// (`safeRegexGuardWorker.test.ts`) -- neither exercises a real spawned worker).
//
// `checkSafeRegexGuarded` looks for its compiled worker file next to its own module
// (`import.meta.url`), so the only way to make it take the real-worker branch is to run it from a
// build: `beforeAll` compiles this package with `tsc -p tsconfig.build.json` (the package's own
// build script), then the test dynamically imports the compiled `dist/safeRegexGuard.js`. The two
// "terminated" cases below pass a short 300 ms ceiling and the inputs are designed to never answer
// inside it -- a real worker cannot finish them in time, so a slow/noisy CI runner only makes the
// termination happen (correctly) sooner relative to real work, never a false pass. The "answers
// fast" case passes the library's own default ceiling (2,000 ms, see `safeRegexGuard.ts`) instead
// of a tight one: this test spawns a real `node:worker_threads` worker from inside a vitest worker
// thread, and under CI's heavy per-file worker isolation (many nested worker threads scheduled at
// once) that spawn + round trip can occasionally take longer than a tight budget even though the
// check itself is trivial -- a 300 ms ceiling here was a false-positive source (CI: the real work
// took 437 ms once), not a real hang. The production default ceiling itself is untouched.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const PACKAGE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TSC_BIN = path.join(PACKAGE_ROOT, 'node_modules', '.bin', 'tsc');
const DIST_GUARD = path.join(PACKAGE_ROOT, 'dist', 'safeRegexGuard.js');
const DIST_WORKER = path.join(PACKAGE_ROOT, 'dist', 'safeRegexWorkerEntry.js');

let checkSafeRegexGuarded: (
  source: string,
  opts?: Record<string, unknown>,
  wallClockMs?: number,
) => string[];
let builtHere = false;

beforeAll(async () => {
  // A previous full-package build (another test run, or `pnpm build`) may already have left a
  // usable `dist` on disk; rebuilding every run is not required for correctness, only for a clean
  // worktree. Build only when the worker file this test needs is missing.
  if (!existsSync(DIST_WORKER)) {
    execFileSync(TSC_BIN, ['-p', 'tsconfig.build.json'], { cwd: PACKAGE_ROOT, stdio: 'pipe' });
    builtHere = true;
  }
  expect(existsSync(DIST_WORKER)).toBe(true); // the real-worker branch needs this file to exist
  const mod = (await import(`${DIST_GUARD}?t=${Date.now()}`)) as {
    checkSafeRegexGuarded: typeof checkSafeRegexGuarded;
  };
  checkSafeRegexGuarded = mod.checkSafeRegexGuarded;
}, 120_000);

afterAll(() => {
  // Leaves `dist` in place when this test built it: other packages' own build steps (and a real
  // production build) overwrite it, and removing it here would make a second local run in the
  // same worktree rebuild for no reason. Nothing commits `dist` (gitignored).
  void builtHere;
});

describe('checkSafeRegexGuarded, a real spawned worker', () => {
  it('a safe pattern answers fast, through the real worker protocol', () => {
    // No explicit ceiling: the library's own default (2,000 ms) absorbs CI scheduling noise from
    // nested worker threads. `toEqual([])` already proves the worker answered before any ceiling
    // (a terminated check always returns an "exceeded" message); `toBeLessThan` here is a loose
    // sanity bound, not the thing under test.
    const start = performance.now();
    expect(checkSafeRegexGuarded('\\d{4}x', {})).toEqual([]);
    expect(performance.now() - start).toBeLessThan(2_000);
  });

  it('a worker that throws inside the check is reported unsafe, not a crash', () => {
    // `''.repeat(Infinity)` throws a RangeError inside `probeTiming` -> the worker thread dies
    // with an uncaught exception instead of ever notifying the shared flag. Without the fix
    // round 2 `worker.on('error', ...)` listener, Node delivers that queued 'error' event after
    // the ceiling with no listener and crashes the process -- this test is the regression check.
    const start = performance.now();
    expect(checkSafeRegexGuarded('a', { units: [''] }, 300)).toEqual([
      'exceeded the 300 ms hard limit for the load/validate path (terminated)',
    ]);
    expect(performance.now() - start).toBeGreaterThanOrEqual(300);
  });

  it('a polynomial pattern on a short ceiling is terminated and reported near the ceiling', () => {
    // No group, no alternation: not caught by the structural check (`safeRegex.test.ts` covers
    // that directly). Anchored so the engine cannot return a cheap successful substring match; a
    // real worker running the full check (structure, then the timing probe over inputs up to
    // 8,192 characters) cannot finish this inside 300 ms, so the ceiling is what reports it.
    const source = '^' + 'a?'.repeat(25) + 'a'.repeat(25) + '$';
    const start = performance.now();
    expect(checkSafeRegexGuarded(source, {}, 300)).toEqual([
      'exceeded the 300 ms hard limit for the load/validate path (terminated)',
    ]);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(300);
    expect(elapsed).toBeLessThan(2_000); // "near the ceiling", not stalled far past it
  });
});
