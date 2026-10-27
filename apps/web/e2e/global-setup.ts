// Task 9.4 Phase D: migrates and seeds the demo teacher once before the whole suite, the same
// rows task 1.5's `db:migrate` / `db:seed` CLIs write (built @edmate/db, not its internals -- apps
// never import `@edmate/db/internal`, so this spawns the CLI the same way a human would). Runs
// against TEST_DATABASE_URL, the same compose port override the other @edmate/db tests use.
// Idempotent (`ON CONFLICT (id) DO NOTHING`): safe to re-run against a dev database that already
// has these rows.
//
// Task 9.7 Phase A: `seed.ts`'s demo teacher is seeded `verificationStatus: 'pending'`
// (discovery's own filter hides an unverified teacher), so 9.7's full flow needs it verified.
// That is done here, in the e2e database only -- never in `packages/db/src/seed.ts`, which is
// shared by 1.5 and every other task's fixtures (plan 9.7, open question 1). A throwaway staff
// user is created the same way `docs/try-it.md`'s manual walkthrough does it (`identity.
// createStudent` + `identity.grantRole({ by: 'operator', role: 'staff' })`, the bootstrap value
// for "no staff account yet"), then used to call `teacherProfiles.setVerification`. Both steps are
// guarded by `getUserByEmail` first so a re-run against a persistent dev Postgres does not throw
// on the unique email; `setVerification` itself is a plain update, safe to repeat. The email is a
// fixed `@example.invalid` string (seed.ts's own convention) -- no real name or address.
//
// Task 9.7c (security-reviewer MEDIUM on 9.7a): refuses a non-local `TEST_DATABASE_URL` before any
// of the above writes (`localDatabaseGuard.ts`, the same local-host allowlist as
// `stack/mail.ts`'s `localUrl`).
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '@edmate/db';
import { assertLocalDatabaseUrl } from './localDatabaseGuard';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(dirname(dirname(HERE)));
const DB_DIST = join(REPO_ROOT, 'packages', 'db', 'dist', 'bin');

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://edmate:edmate-dev@127.0.0.1:55432/edmate';

/** The seeded demo teacher's id (`DEMO_IDS.teacher`, `packages/db/src/seed.ts`). Not imported
 * from `seed.ts` directly: this file only ever reads/writes through `@edmate/db`'s public store
 * and repositories, never the seed's internals. */
const DEMO_TEACHER_ID = 'demo-teacher';

/** A throwaway e2e-only staff account, never seeded in `seed.ts`. */
const E2E_STAFF_EMAIL = 'e2e-staff@example.invalid';

/** Mirrors `playwright.config.ts`'s own `EDMATE_E2E_PORT ?? 3111` default (same duplicated-default
 * pattern already used for `TEST_DATABASE_URL` above) -- not imported, to avoid a new import cycle
 * between this file and `playwright.config.ts`. */
const PORT = Number(process.env.EDMATE_E2E_PORT ?? 3111);
const BASE_URL = `http://localhost:${PORT}`;

/** The seeded demo agent's package id (`DEMO_AGENT`, `apps/web/e2e/fixtures.ts`). Not imported
 * from `fixtures.ts`: that file already imports *from* `global-setup.ts` (`TEST_DATABASE_URL`), so
 * importing back would create a cycle. Literal, commented as mirroring that constant. */
const DEMO_AGENT_ID = 'demo-agent';

/** 0.20g review (MEDIUM/LOW), reworded in 0.20j (0.20h review): each warm-up fetch's own
 * ceiling. It equals `playwright.config.ts`'s `webServer.timeout` (60 s) in value only -- both
 * ~60 s budgets were chosen independently, and this one does not run nested inside that clock.
 * Playwright's `webServer` plugin finishes waiting for the dev server (that 60 s timeout) before
 * `globalSetup` -- where this warm-up fires -- ever runs; the two never run concurrently. This
 * ceiling exists so a hung warm-up fails this file's own best-effort catch in seconds, instead of
 * hanging `globalSetup` (and so the whole run) indefinitely. */
const WARM_UP_TIMEOUT_MS = 60_000;

/**
 * Task 0.20g: `chat.spec.ts`'s first test is the first visitor in the whole e2e run of
 * `GET /learn/[agentId]` and `POST /api/sessions` -- both routes' auth checks run *after*
 * `next dev` compiles their full import graph on first visit, so the first real test pays that
 * cold-compile cost right before its own bare 5 s assertion. Warming both here (in `globalSetup`,
 * which Playwright's `webServer` plugin has already started and waited on by the time user
 * `globalSetup` runs) pays that cost once, before any spec file runs, without raising any test's
 * timeout. Both calls are unauthenticated on purpose -- the expensive part is the module compile,
 * which happens before either route's auth check, so a 401/404/redirect response is expected and
 * fine; the real tests still exercise these routes for real afterwards. Best-effort: a warm-up
 * failure must never fail the run, so every error is swallowed with a one-line warning.
 */
async function warmRoutes(): Promise<void> {
  // Each in its own try/catch and run together (0.20h, Part 3): independent best-effort warm-ups,
  // so one hanging (or failing) never delays or skips the other -- and `AbortSignal.timeout`
  // guarantees neither ever runs past `WARM_UP_TIMEOUT_MS`, even against a dev server wedged
  // mid-compile.
  const learn = fetch(`${BASE_URL}/learn/${DEMO_AGENT_ID}`, {
    signal: AbortSignal.timeout(WARM_UP_TIMEOUT_MS),
  }).catch((error: unknown) => {
    console.warn('e2e global setup: warm-up GET /learn failed (non-fatal)', error);
  });
  const sessions = fetch(`${BASE_URL}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(WARM_UP_TIMEOUT_MS),
  }).catch((error: unknown) => {
    console.warn('e2e global setup: warm-up POST /api/sessions failed (non-fatal)', error);
  });
  await Promise.all([learn, sessions]);
}

function run(script: string): void {
  const result = spawnSync(process.execPath, [join(DB_DIST, script)], {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`e2e global setup: ${script} exited with ${String(result.status)}`);
  }
}

async function verifyDemoTeacher(): Promise<void> {
  const { identity, repos, close } = openDatabase({ DATABASE_URL: TEST_DATABASE_URL });
  try {
    let staff = await identity.getUserByEmail(E2E_STAFF_EMAIL);
    if (!staff) {
      const created = await identity.createStudent({
        email: E2E_STAFF_EMAIL,
        emailVerifiedAt: new Date(),
        name: 'E2E Staff',
      });
      staff = await identity.grantRole({ userId: created.id, role: 'staff', by: 'operator' });
    }
    await repos.teacherProfiles.setVerification(
      { teacherId: DEMO_TEACHER_ID },
      { status: 'verified', by: staff.id },
    );
  } finally {
    await close();
  }
}

export default async function globalSetup(): Promise<void> {
  assertLocalDatabaseUrl(TEST_DATABASE_URL);
  run('migrate.js');
  run('seed.js');
  await verifyDemoTeacher();
  await warmRoutes();
}
