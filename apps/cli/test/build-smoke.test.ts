// A real `node bin/edmate content validate <dir>` child process, run against the real compiled
// `dist/` of this package and of `@edmate/content` (3.10a review item 2's CLI smoke test).
//
// `checkSafeRegexGuarded` (packages/content/src/safeRegexGuard.ts) takes its fast, no-wall-clock
// in-process fallback only inside this package's own `vitest run` (`process.env.VITEST ===
// 'true'`); everywhere else -- this spawned child included -- a missing compiled worker file must
// fail closed (every PII pattern reported unsafe) instead. `VITEST` is stripped from the child's
// env so this test actually exercises that "everywhere else" branch, not vitest's own convenience
// fallback by accident.
//   - Negative (T5): the compiled worker (`packages/content/dist/safeRegexWorkerEntry.js`) is
//     temporarily hidden, and `EDMATE_CONTENT_WORKER_DIR` is pointed at an empty directory (so
//     neither of `getWorkerFile`'s two candidate paths exists) -- `edmate content validate`
//     against a locale-packs fixture with one PII pattern must exit non-zero: the guard fails
//     closed, `checkLocalePacks` reports an issue, `validateContentDir` is not ok.
//   - Positive (T6): the real worker file is left in place -- the same fixture, which is
//     genuinely valid, must exit 0: the guard answers fast and reports the (structurally safe)
//     pattern as safe, not "missing" or "unsafe".
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const APPS_CLI = dirname(HERE);
const REPO_ROOT = dirname(dirname(APPS_CLI));
const CLI_BIN = join(APPS_CLI, 'bin', 'edmate');
const CLI_DIST = join(APPS_CLI, 'dist', 'cli.js');
const CONTENT_DIST = join(REPO_ROOT, 'packages', 'content', 'dist');
const CONTENT_WORKER = join(CONTENT_DIST, 'safeRegexWorkerEntry.js');
const HIDDEN_CONTENT_WORKER = `${CONTENT_WORKER}.build-smoke-hidden`;
const FIXTURE_LOCALES = join(HERE, 'fixtures', 'build-smoke', 'locales');

beforeAll(() => {
  if (!existsSync(CLI_DIST)) {
    throw new Error(
      `${CLI_DIST} is missing: run \`pnpm build\` (this package's own build task) before build-smoke`,
    );
  }
  if (!existsSync(CONTENT_WORKER)) {
    throw new Error(
      `${CONTENT_WORKER} is missing: run \`pnpm build\` for @edmate/content before build-smoke`,
    );
  }
  // A stale hidden file means an earlier run crashed between hiding and restoring it (same
  // precedent as apps/web/test/build-smoke.test.ts): restore it before this run starts.
  if (existsSync(HIDDEN_CONTENT_WORKER)) {
    if (existsSync(CONTENT_WORKER)) rmSync(HIDDEN_CONTENT_WORKER);
    else renameSync(HIDDEN_CONTENT_WORKER, CONTENT_WORKER);
  }
});

/** `process.env` with `VITEST` stripped and any extra entries applied on top. */
function childEnv(extra: Record<string, string>): Record<string, string | undefined> {
  const env = { ...process.env, ...extra };
  delete env.VITEST;
  return env;
}

function runCli(dir: string, extraEnv: Record<string, string>): { status: number } {
  try {
    execFileSync('node', [CLI_BIN, 'content', 'validate', dir], {
      cwd: REPO_ROOT,
      env: childEnv(extraEnv),
      stdio: 'pipe',
    });
    return { status: 0 };
  } catch (e) {
    const status = (e as { status?: number }).status;
    return { status: status ?? 1 };
  }
}

describe('build smoke: edmate content validate, a real spawned worker (3.10a review item 2)', () => {
  it('T6: the real compiled worker present, a valid locale-packs dir -> exits 0', () => {
    const emptyWorkerDir = mkdtempSync(join(tmpdir(), 'edmate-cli-build-smoke-'));
    try {
      const result = runCli(FIXTURE_LOCALES, { EDMATE_CONTENT_WORKER_DIR: emptyWorkerDir });
      expect(result.status).toBe(0);
    } finally {
      rmSync(emptyWorkerDir, { recursive: true, force: true });
    }
  });

  describe('T5: the compiled worker missing -> exits non-zero (fails closed)', () => {
    let emptyWorkerDir: string | undefined;

    afterEach(() => {
      if (existsSync(HIDDEN_CONTENT_WORKER)) renameSync(HIDDEN_CONTENT_WORKER, CONTENT_WORKER);
      if (emptyWorkerDir !== undefined) rmSync(emptyWorkerDir, { recursive: true, force: true });
    });

    it('exits non-zero when neither the sibling nor EDMATE_CONTENT_WORKER_DIR has the worker', () => {
      renameSync(CONTENT_WORKER, HIDDEN_CONTENT_WORKER);
      emptyWorkerDir = mkdtempSync(join(tmpdir(), 'edmate-cli-build-smoke-'));
      const result = runCli(FIXTURE_LOCALES, { EDMATE_CONTENT_WORKER_DIR: emptyWorkerDir });
      expect(result.status).not.toBe(0);
    });
  });
});
