// Task 9.4 Phase D: migrates and seeds the demo teacher once before the whole suite, the same
// rows task 1.5's `db:migrate` / `db:seed` CLIs write (built @edmate/db, not its internals -- apps
// never import `@edmate/db/internal`, so this spawns the CLI the same way a human would). Runs
// against TEST_DATABASE_URL, the same compose port override the other @edmate/db tests use.
// Idempotent (`ON CONFLICT (id) DO NOTHING`): safe to re-run against a dev database that already
// has these rows.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(dirname(dirname(HERE)));
const DB_DIST = join(REPO_ROOT, 'packages', 'db', 'dist', 'bin');

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://edmate:edmate-dev@127.0.0.1:55432/edmate';

function run(script: string): void {
  const result = spawnSync(process.execPath, [join(DB_DIST, script)], {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`e2e global setup: ${script} exited with ${String(result.status)}`);
  }
}

export default function globalSetup(): void {
  run('migrate.js');
  run('seed.js');
}
