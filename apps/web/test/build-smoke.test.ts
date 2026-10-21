// Task 1.7b: a production web build (`next build --webpack`, this app's own build script) loads
// the safe-regex worker -- the age gate's locale packs are loaded from a *built* `@edmate/content`,
// not from source via vitest's own transform (the only way to have caught the original bug: the
// worker never loaded once Next's bundler touched `safeRegexGuard.ts`'s `new URL(<literal>,
// import.meta.url)` expression, see packages/content/src/safeRegexGuard.ts).
//
// Fix round (security review of PR #76): running `.next/standalone` *in place*, on the same
// machine and in the same directory as the build, could never have caught the bug that review
// found: `next build --webpack` still folds `@edmate/content` into the app's own server chunk
// (`serverExternalPackages` does not stop it for a pnpm workspace package; see the comment in
// `packages/content/src/safeRegexGuard.ts`), and bundled, `import.meta.url` is rewritten to the
// *build machine's own absolute path* -- which still resolves when the build and the test run in
// the same checkout. This copies `.next/standalone` to a throwaway directory under the OS temp
// dir and hides this checkout's own `packages/content/dist` for the duration of the test, so the
// only way the spawned server can find its worker file is through the copy -- exactly what a
// Docker image (built in one directory tree, run from another) or any relocated standalone output
// does. The "safe pattern" and "deliberately unsafe pattern" assertions below only pass if the
// worker genuinely ran from the copy: if it did not (this checkout's `dist` is hidden, so no
// worker can load), the production fail-closed behaviour (`safeRegexGuard.ts`) reports *every*
// pattern unsafe, including `IN`'s real ones, and `'IN'` disappears from the age gate's market
// list -- the same observable failure the original relocation bug caused.
//
// Runs `node <copy>/apps/web/server.js` -- the standalone output `apps/web/Dockerfile` ships,
// relocated -- against a real Postgres (so a real, DB-backed sign-in session can reach the age
// gate; the "database" session strategy, config.ts) and a fixture content directory (never
// `content/locales/**`, see test/fixtures/build-smoke/). One server start, a few requests (lead's
// answer, 1.7b plan): the fixture packs let one request prove all three acceptance points at once,
// from the relocated copy --
//   (a) 'IN' (a market with real, structurally-safe PII patterns) is served: proves the worker
//       loaded *from the copy* and reported those patterns safe, fast, not "unsafe" by a timed-out
//       ceiling or by the production fail-closed path (either of which would also refuse 'IN').
//   (b) 'ZZ' (a pack with one deliberately unsafe pattern) is refused with the *specific*
//       structural reason, not the generic "exceeded ... hard limit" / "failing closed" message a
//       broken or missing worker would report for every pattern alike -- proof the guard still
//       tells safe from unsafe, not just "always unsafe".
//   (c) the refusal is logged once, naming the file and the reason (apps/web/src/auth/age.ts).
//
// Requires Postgres (TEST_DATABASE_URL, same var and skip/fail pattern as rate-limit.int.test.ts):
// locally, skips with a loud message when unreachable; in CI (which always provides one, ci.yml),
// fails instead of skipping.
import { randomBytes } from 'node:crypto';
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const APPS_WEB = dirname(HERE);
const REPO_ROOT = dirname(dirname(APPS_WEB));
const BUILD_STANDALONE = join(APPS_WEB, '.next', 'standalone');
const BUILD_SERVER_JS = join(BUILD_STANDALONE, 'apps', 'web', 'server.js');
const BUILD_TREE_CONTENT_DIST = join(REPO_ROOT, 'packages', 'content', 'dist');
const HIDDEN_CONTENT_DIST = `${BUILD_TREE_CONTENT_DIST}.build-smoke-hidden`;
const FIXTURE_CONTENT = join(HERE, 'fixtures', 'build-smoke');
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://127.0.0.1:55432/no-such-db';
const AUTH_SECRET = 'build-smoke-test-secret-'.padEnd(40, 'x');
const SESSION_COOKIE = 'authjs.session-token'; // http, not https: secureCookies is false, no __Host- prefix
// Random, not fixed: a fixed token would collide with an earlier run's row (the session token's
// hash is unique) on a database a previous run didn't clean up (e.g. a shared dev Postgres).
const SID = randomBytes(24).toString('hex');

/** A raw TCP probe only (same depth as rate-limit.int.test.ts's Redis check): good enough to tell
 * "nothing is listening" (skip locally) from "something is" (let `migrateDatabase` below speak to
 * whether it is really a usable Postgres). */
async function reachable(): Promise<boolean> {
  const { hostname, port } = new URL(TEST_DATABASE_URL);
  return new Promise((resolve) => {
    const socket = connect({ host: hostname, port: Number(port) || 5432, timeout: 2_000 });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/** An unused loopback port: 0 asks the OS for one, then the socket is closed before reuse. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      const port = typeof address === 'object' && address !== null ? address.port : undefined;
      srv.close(() => (port === undefined ? reject(new Error('no port')) : resolve(port)));
    });
  });
}

async function waitForHealth(origin: string, deadlineMs: number): Promise<void> {
  const until = Date.now() + deadlineMs;
  let lastError: unknown;
  while (Date.now() < until) {
    try {
      const res = await fetch(`${origin}/api/health`);
      if (res.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`server never became healthy at ${origin}: ${String(lastError)}`);
}

const up = await reachable();
if (!up && process.env.CI === 'true') {
  throw new Error('CI=true but Postgres (TEST_DATABASE_URL) is unreachable');
}
const SKIP = 'SKIPPED: no Postgres at TEST_DATABASE_URL; see the header';
if (!up) process.stderr.write(`[@edmate/web] build-smoke ${SKIP}\n`);

describe.skipIf(!up)(`build smoke: the age gate on a real, relocated build${up ? '' : ` (${SKIP})`}`, () => {
  let child: ChildProcessWithoutNullStreams | undefined;
  let origin: string;
  const stderrChunks: string[] = [];
  let dbClose: (() => Promise<void>) | undefined;
  let tmpRoot: string | undefined;
  let hidBuildTreeDist = false;

  beforeAll(async () => {
    if (!existsSync(BUILD_SERVER_JS)) {
      throw new Error(
        `${BUILD_SERVER_JS} is missing: run \`next build --webpack\` (this package's own build task) before build-smoke`,
      );
    }

    // Relocate: copy the standalone output to a throwaway directory, away from this checkout, and
    // hide this checkout's own compiled `@edmate/content` for the duration of the test. The build
    // machine's absolute path a bundled chunk may have inlined (see the header) points inside this
    // checkout; with both the copy elsewhere and the original hidden, the only `dist` the spawned
    // server can possibly find is the one that travelled inside the copy itself.
    tmpRoot = mkdtempSync(join(tmpdir(), 'edmate-build-smoke-'));
    cpSync(BUILD_STANDALONE, tmpRoot, { recursive: true });
    const serverJs = join(tmpRoot, 'apps', 'web', 'server.js');
    if (existsSync(BUILD_TREE_CONTENT_DIST)) {
      renameSync(BUILD_TREE_CONTENT_DIST, HIDDEN_CONTENT_DIST);
      hidBuildTreeDist = true;
    }

    // Real Postgres, real identity store, from the *built* @edmate/db (workspace dependency,
    // resolved the same way the running app resolves it) -- a real, DB-backed sign-in session is
    // the only way to reach the age gate's market list through a real HTTP request.
    const { migrateDatabase, openDatabase } = await import('@edmate/db');
    await migrateDatabase(TEST_DATABASE_URL);
    const { identity, close } = openDatabase({ DATABASE_URL: TEST_DATABASE_URL });
    dbClose = close;
    const user = await identity.createStudent({
      email: `build-smoke-${randomBytes(4).toString('hex')}@example.test`,
      emailVerifiedAt: null,
      name: 'Build Smoke',
    });
    await identity.createSession(SID, user.id, new Date(Date.now() + 86_400_000));

    const port = await freePort();
    origin = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [serverJs], {
      // Not REPO_ROOT: the relocated copy's own root, matching `apps/web/Dockerfile`'s
      // `WORKDIR /app` -- the server's cwd is part of what proves the worker resolved from the
      // copy, not from this checkout (see `packages/content/src/safeRegexGuard.ts`'s `byCwd`).
      cwd: tmpRoot,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(port),
        HOSTNAME: '127.0.0.1',
        DATABASE_URL: TEST_DATABASE_URL,
        AUTH_SECRET,
        AUTH_URL: origin,
        // Never used: no OAuth call is made (a real DB session bypasses sign-in entirely). Only
        // present because readAuthEnv requires at least one configured sign-in provider to start.
        AUTH_GOOGLE_ID: 'build-smoke-unused',
        AUTH_GOOGLE_SECRET: 'build-smoke-unused',
        EDMATE_CONTENT_DIR: FIXTURE_CONTENT,
        // Matches `apps/web/Dockerfile`: the bundled server chunk cannot locate the safe-regex
        // worker through its own baked (and here, deliberately hidden) build-machine path, and
        // `process.cwd()` is no help either -- the standalone `server.js` chdirs to its own
        // directory before anything else runs (`safeRegexGuard.ts`). Point it at the copy.
        EDMATE_CONTENT_WORKER_DIR: join(tmpRoot, 'packages', 'content', 'dist'),
      },
    });
    // A spawn failure (ENOENT, EACCES, ...) fires an 'error' event; with no listener Node treats
    // it as an uncaught exception and crashes the whole vitest process instead of failing this
    // test cleanly (typescript-reviewer, fix round). `waitForHealth` already times out and fails
    // the test on its own if the process never comes up for any other reason.
    let spawnError: Error | undefined;
    child.on('error', (err) => {
      spawnError = err;
    });
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk.toString('utf8')));
    child.stdout.on('data', () => undefined); // drained, not asserted on
    try {
      await waitForHealth(origin, 20_000);
    } catch (error) {
      throw spawnError ?? error;
    }
    if (spawnError) throw spawnError;
  });

  afterAll(async () => {
    if (child && !child.killed) {
      child.kill();
      await new Promise((resolve) => child?.once('exit', resolve));
    }
    if (dbClose) await dbClose();
    if (hidBuildTreeDist) renameSync(HIDDEN_CONTENT_DIST, BUILD_TREE_CONTENT_DIST);
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('from the relocated copy: serves IN (safe patterns), refuses ZZ (one unsafe pattern), logs it once', async () => {
    const res = await fetch(`${origin}/welcome/age`, {
      headers: { cookie: `${SESSION_COOKIE}=${SID}` },
      redirect: 'manual',
    });
    expect(res.status).toBe(200); // a redirect here would mean the session, not the content, broke
    const body = await res.text();
    // 'IN' only appears if the worker loaded *from the relocated copy* and reported its real
    // patterns safe. If relocation had broken the worker (the bug this test guards against), the
    // production fail-closed path (safeRegexGuard.ts) would report every pattern unsafe, 'IN'
    // included, and this would fail here -- not just on the 'ZZ' assertions below.
    expect(body).toContain('value="IN"');
    expect(body).not.toContain('value="ZZ"');

    // The refusal is logged once the first request loads content (lazy init, src/auth/index.ts);
    // give the child process's stdio pipe a moment to flush before reading it back.
    const until = Date.now() + 5_000;
    let log = stderrChunks.join('');
    while (!log.includes('ZZ.yaml') && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 100));
      log = stderrChunks.join('');
    }
    const lines = log.split('\n').filter((l) => l.includes('refused locale pack'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('ZZ.yaml');
    expect(lines[0]).toContain('nests a quantifier inside a repeated group');
    // Not the generic ceiling message, and not the production fail-closed message: proves the
    // worker answered from the relocated copy, rather than every check timing out, or the worker
    // file being missing altogether, and reporting everything unsafe alike (this bug's symptom,
    // and the relocation bug's symptom, look the same from here).
    expect(lines[0]).not.toContain('exceeded the');
    expect(lines[0]).not.toContain('failing closed');
  });
});
