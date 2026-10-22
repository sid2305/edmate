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
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '@edmate/db';

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
  run('migrate.js');
  run('seed.js');
  await verifyDemoTeacher();
}
