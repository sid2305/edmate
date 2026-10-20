// The one test in this package that runs the real `node:worker_threads` / `Atomics` / `MessagePort`
// protocol end to end (task 3.10, fix round 2; typescript-reviewer: the other tests either take
// the no-`dist` in-process fallback (`safeRegexGuard.test.ts`) or mock `node:worker_threads`
// (`safeRegexGuardWorker.test.ts`) -- neither exercises a real spawned worker).
//
// `checkSafeRegexGuarded` looks for its compiled worker file next to its own module
// (`import.meta.url`), so the only way to make it take the real-worker branch is to run it from a
// build: `beforeAll` compiles this package with `tsc -p tsconfig.build.json` (the package's own
// build script), then the test dynamically imports the compiled `dist/safeRegexGuard.js`. The
// ceiling is kept short (300 ms) and the inputs small, so the whole file runs in well under a
// second and is deterministic in CI: every case here either answers fast or is designed to never
// answer at all (a real worker cannot finish inside the ceiling), never a close race.
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
    const start = performance.now();
    expect(checkSafeRegexGuarded('\\d{4}x', {}, 300)).toEqual([]);
    expect(performance.now() - start).toBeLessThan(300);
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
