// Task 9.1a: /home and /teacher score >= 95 (Lighthouse's accessibility category, at 360x640
// mobile) on a real production build, in CI.
//
// Runs in place from `.next/standalone` (unlike build-smoke.test.ts, no relocation-to-tmpdir
// dance): that copy exists only to catch a bundled-worker absolute-path bug
// (packages/content/src/safeRegexGuard.ts) this task has no stake in -- neither /home nor
// /teacher renders the age gate (both sessions below are already cleared/non-student), so the
// worker's own content-locale loading path is never exercised here.
//
// Mints two real, DB-backed sessions (same pattern as build-smoke.test.ts and
// apps/web/e2e/fixtures.ts's signInAsFreshStudent): a fresh student, 25 years old (so
// `learnerStatus` is 'clear' and `requireRole(['student'])`'s default `age` clearance passes,
// reaching /home's real content instead of a redirect to /welcome/age), and a fresh teacher
// (identity.createStudent + identity.grantRole({ role: 'teacher', by: 'operator' }) -- there is
// no separate identity.createTeacher; a teacher is a student-shaped row with role granted, same
// as src/auth/age.test.ts's own fixtures). /teacher's guard (`requireRole(['teacher'])`) needs no
// clearance (non-students always read as cleared, src/auth/guard.ts's `cleared`) and no
// verification: `app/teacher/page.tsx` only reads `publish.changedSinceLastPublish`, already
// wrapped in its own try/catch, so an unverified or unpublished teacher still renders.
//
// Requires Postgres (TEST_DATABASE_URL), same skip/fail pattern as build-smoke.test.ts: skips
// locally when unreachable, fails in CI.
import { randomBytes } from 'node:crypto';
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import { connect, createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as chromeLauncher from 'chrome-launcher';
import lighthouse from 'lighthouse';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const APPS_WEB = dirname(HERE);
const BUILD_SERVER_JS = join(APPS_WEB, '.next', 'standalone', 'apps', 'web', 'server.js');
// The standalone output never carries static assets (CSS, chunk JS) on its own -- the same
// reason `apps/web/Dockerfile` has its own `COPY .../.next/static .../apps/web/.next/static`
// step. Without it, `/_next/static/**` 404s and every page renders with zero CSS: accessibility
// audits that depend on layout (e.g. `target-size`, spacing between nav links) would be scored
// against unstyled markup, not the real deployed site. Idempotent (`force: true` overwrites a
// stale copy from an earlier build).
const BUILD_STATIC_SRC = join(APPS_WEB, '.next', 'static');
const BUILD_STATIC_DEST = join(APPS_WEB, '.next', 'standalone', 'apps', 'web', '.next', 'static');
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://127.0.0.1:55432/no-such-db';
const AUTH_SECRET = 'lighthouse-a11y-test-secret-'.padEnd(40, 'x');
const SESSION_COOKIE = 'authjs.session-token'; // http, not https: secureCookies is false

// The board's accept line for this task (plan: "Threshold 95 (the board accept line)").
const MIN_ACCESSIBILITY_SCORE = 95;

/** A raw TCP probe only (same depth as build-smoke.test.ts's own `reachable`). */
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

interface AccessibilityResult {
  /** 0-100 integer score (Lighthouse's own accessibility category score, rounded). */
  score: number;
  /** Ids of weighted audits (weight > 0) that did not score 1, soonest-failing-first -- named in
   * the assertion message below so a future regression names its own cause instead of a bare
   * number. */
  failingAuditIds: string[];
}

/** Lighthouse's accessibility category score for `path`, at a 360x640 mobile viewport, through
 * `cookie` (a real session cookie -- Lighthouse's own `extraHeaders` flag, not a Puppeteer page,
 * since no interaction beyond "load the page" is needed). */
async function accessibilityScore(
  chrome: chromeLauncher.LaunchedChrome,
  origin: string,
  path: string,
  cookie: string,
): Promise<AccessibilityResult> {
  const result = await lighthouse(
    `${origin}${path}`,
    {
      port: chrome.port,
      onlyCategories: ['accessibility'],
      extraHeaders: { cookie },
      // 360x640 (the plan's accept line's mobile viewport), no device-scale/throttling needed:
      // this is a markup/contrast check, not a performance one.
      screenEmulation: { mobile: true, width: 360, height: 640, deviceScaleFactor: 1, disabled: false },
      formFactor: 'mobile',
    },
    undefined,
  );
  const score = result?.lhr.categories.accessibility?.score;
  if (score === null || score === undefined || !result) {
    throw new Error(`lighthouse: no accessibility score for ${path}`);
  }
  const failingAuditIds = (result.lhr.categories.accessibility?.auditRefs ?? [])
    .filter((ref) => ref.weight > 0 && result.lhr.audits[ref.id]?.score !== 1)
    .map((ref) => ref.id);
  return { score: Math.round(score * 100), failingAuditIds };
}

const up = await reachable();
if (!up && process.env.CI === 'true') {
  throw new Error('CI=true but Postgres (TEST_DATABASE_URL) is unreachable');
}
const SKIP = 'SKIPPED: no Postgres at TEST_DATABASE_URL; see the header';
if (!up) process.stderr.write(`[@edmate/web] lighthouse-a11y ${SKIP}\n`);

describe.skipIf(!up)(`lighthouse accessibility: /home and /teacher${up ? '' : ` (${SKIP})`}`, () => {
  let child: ChildProcessWithoutNullStreams | undefined;
  let origin: string;
  let dbClose: (() => Promise<void>) | undefined;
  let chrome: chromeLauncher.LaunchedChrome | undefined;
  let studentCookie: string;
  let teacherCookie: string;
  const stderrChunks: string[] = [];

  beforeAll(async () => {
    if (!existsSync(BUILD_SERVER_JS)) {
      throw new Error(
        `${BUILD_SERVER_JS} is missing: run \`next build --webpack\` (this package's own build task) before lighthouse-a11y`,
      );
    }
    await cp(BUILD_STATIC_SRC, BUILD_STATIC_DEST, { recursive: true, force: true });

    const { migrateDatabase, openDatabase } = await import('@edmate/db');
    await migrateDatabase(TEST_DATABASE_URL);
    const { identity, close } = openDatabase({ DATABASE_URL: TEST_DATABASE_URL });
    dbClose = close;

    // A fresh, adult ('clear') student: requireRole(['student'])'s default `age` clearance needs
    // learnerStatus to be 'clear', not 'age_needed' -- same shape as e2e/fixtures.ts's
    // signInAsFreshStudent.
    const student = await identity.createStudent({
      email: `lighthouse-a11y-student-${randomBytes(4).toString('hex')}@example.invalid`,
      emailVerifiedAt: null,
      name: 'Lighthouse A11y Student',
    });
    await identity.recordAgeAnswer({
      userId: student.id,
      market: 'global',
      birthYear: new Date().getUTCFullYear() - 25,
      noticeVersion: 'lighthouse-a11y-test',
    });
    const studentSid = randomBytes(24).toString('hex');
    await identity.createSession(studentSid, student.id, new Date(Date.now() + 86_400_000));
    studentCookie = `${SESSION_COOKIE}=${studentSid}`;

    // A fresh teacher: no identity.createTeacher exists -- a teacher is a student-shaped row
    // with the role granted (identity.grantRole), same as src/auth/age.test.ts's own fixtures.
    // Non-students always read as cleared (src/auth/guard.ts's `cleared`): no age answer needed.
    const teacherUser = await identity.createStudent({
      email: `lighthouse-a11y-teacher-${randomBytes(4).toString('hex')}@example.invalid`,
      emailVerifiedAt: null,
      name: 'Lighthouse A11y Teacher',
    });
    await identity.grantRole({ userId: teacherUser.id, role: 'teacher', by: 'operator' });
    const teacherSid = randomBytes(24).toString('hex');
    await identity.createSession(teacherSid, teacherUser.id, new Date(Date.now() + 86_400_000));
    teacherCookie = `${SESSION_COOKIE}=${teacherSid}`;

    const port = await freePort();
    origin = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [BUILD_SERVER_JS], {
      cwd: APPS_WEB,
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
        AUTH_GOOGLE_ID: 'lighthouse-a11y-unused',
        AUTH_GOOGLE_SECRET: 'lighthouse-a11y-unused',
      },
    });
    // A spawn failure (ENOENT, EACCES, ...) fires an 'error' event; with no listener Node treats
    // it as an uncaught exception and crashes the whole vitest process (same fix as
    // build-smoke.test.ts's own beforeAll).
    let spawnError: Error | undefined;
    child.on('error', (err) => {
      spawnError = err;
    });
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk.toString('utf8')));
    child.stdout.on('data', () => undefined);
    try {
      await waitForHealth(origin, 20_000);
    } catch (error) {
      const tail = stderrChunks.join('').slice(-2_000);
      throw spawnError ?? new Error(`${String(error)}\nserver stderr (tail):\n${tail}`);
    }
    if (spawnError) throw spawnError;

    chrome = await chromeLauncher.launch({
      chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu'],
    });
  });

  afterAll(async () => {
    // Each cleanup step runs independently (Promise.allSettled): a thrown chrome.kill() must not
    // skip killing the server process or closing the DB pool, which would leak both. Any failure
    // is still surfaced afterwards, not swallowed.
    const results = await Promise.allSettled([
      (async () => {
        if (chrome) await chrome.kill();
      })(),
      (async () => {
        if (child && !child.killed) {
          child.kill();
          await new Promise((resolve) => child?.once('exit', resolve));
        }
      })(),
      (async () => {
        if (dbClose) await dbClose();
      })(),
    ]);
    const failures = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    if (failures.length === 1) throw failures[0]!.reason;
    if (failures.length > 1) {
      throw new AggregateError(
        failures.map((f) => f.reason),
        'afterAll cleanup: multiple steps failed',
      );
    }
  });

  it(`/home scores >= ${MIN_ACCESSIBILITY_SCORE} (accessibility, 360x640, production build)`, async () => {
    if (!chrome) throw new Error('chrome did not launch');
    const { score, failingAuditIds } = await accessibilityScore(chrome, origin, '/home', studentCookie);
    // eslint-disable-next-line no-console -- the handoff pastes this console output as evidence.
    console.log(`[lighthouse-a11y] /home accessibility score: ${score}`);
    expect(score, `failing audits: ${failingAuditIds.join(', ') || 'none'}`).toBeGreaterThanOrEqual(
      MIN_ACCESSIBILITY_SCORE,
    );
  });

  it(`/teacher scores >= ${MIN_ACCESSIBILITY_SCORE} (accessibility, 360x640, production build)`, async () => {
    if (!chrome) throw new Error('chrome did not launch');
    const { score, failingAuditIds } = await accessibilityScore(chrome, origin, '/teacher', teacherCookie);
    // eslint-disable-next-line no-console -- the handoff pastes this console output as evidence.
    console.log(`[lighthouse-a11y] /teacher accessibility score: ${score}`);
    expect(score, `failing audits: ${failingAuditIds.join(', ') || 'none'}`).toBeGreaterThanOrEqual(
      MIN_ACCESSIBILITY_SCORE,
    );
  });
});
