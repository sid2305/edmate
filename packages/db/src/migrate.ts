import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { createDb } from './client.js';

/**
 * Session-level advisory lock key for `migrateDatabase()` (task 3.16c, 3.16b review deferral):
 * arbitrary, fixed, and not used anywhere else in this codebase (`grep -rn advisory` before
 * reusing it). Two overlapping `migrateDatabase()` calls (two app instances starting at once)
 * would otherwise race drizzle's migrations-table insert and the post-migrate index build/drop;
 * taking this lock on one dedicated connection around the whole migrate-then-post-migrate run
 * serializes them instead.
 */
export const MIGRATE_LOCK_KEY = 847_301_558_421n;

/** Poll interval for {@link acquireMigrateLock}, and its default give-up bound. */
const LOCK_POLL_MS = 50;
const LOCK_MAX_WAIT_MS = 10 * 60_000;

/**
 * Blocking `pg_advisory_lock` would itself hold an open snapshot on `client`'s connection for the
 * whole wait: `CREATE INDEX CONCURRENTLY` (the package-pin index, a post-migrate step) must wait
 * out every transaction with a snapshot older than the build, table or not, so the lock holder's
 * own `CREATE INDEX CONCURRENTLY` would wait forever on a second caller's still-blocked
 * `pg_advisory_lock` call: a self-deadlock. Polling `pg_try_advisory_lock` instead keeps each
 * statement short, so no snapshot is held between tries.
 */
export async function acquireMigrateLock(
  client: pg.Client,
  key: bigint,
  maxWaitMs = LOCK_MAX_WAIT_MS,
): Promise<void> {
  const deadline = Date.now() + maxWaitMs;
  for (;;) {
    const { rows } = await client.query<{ locked: boolean }>('select pg_try_advisory_lock($1) as locked', [
      key,
    ]);
    if (rows[0]?.locked) return;
    if (Date.now() >= deadline) {
      throw new Error(`migrateDatabase: timed out after ${maxWaitMs}ms waiting for the migration lock`);
    }
    await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
  }
}

/**
 * packages/db/migrations, from both src/ (tests) and dist/ (built). Built with path.join, not
 * `new URL('../migrations', import.meta.url)`: bundlers (Next's Turbopack, task 1.3) treat that
 * as an asset import and fail because it is a directory.
 */
export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/**
 * The migrator's pool: one connection, and no statement timeout, so a long migration (an HNSW
 * index build, task 5.3) is not cancelled by the app's 15 s default.
 */
export const MIGRATE_POOL_OPTIONS = { max: 1, statement_timeout: false } as const;

/**
 * A lock-heavy step that can't run inside drizzle's migration transaction (task 3.16b: drizzle
 * 0.45's migrator runs every pending migration file in one transaction, so a `VALIDATE CONSTRAINT`
 * or `CREATE INDEX CONCURRENTLY` written into a migration file is still taken under that
 * transaction's ACCESS EXCLUSIVE lock for the file's own `ALTER TABLE ... ADD CONSTRAINT`). Each
 * step runs as its own autocommit statement, after drizzle's migrate() has committed, so the
 * table is only briefly locked to add the constraint or index, not for the validation scan or the
 * index build.
 */
export type PostMigrateStep =
  | { readonly kind: 'validateConstraint'; readonly table: string; readonly constraint: string }
  | { readonly kind: 'concurrentIndex'; readonly indexName: string; readonly sql: string };

/**
 * Migration 0009 (task 3.16) adds `sessions_package_version_fk`, `sessions_package_pin_complete`
 * and `sessions_open_has_package` as `NOT VALID` and `sessions_package_id_package_version_idx` as
 * a schema-only index (task 3.16b); migration 0010 (task 3.16c) adds
 * `sessions_open_teacher_id_student_id_idx` the same schema-only way. This is what makes the
 * constraints valid and the indexes built, outside any transaction. Append here, don't edit past
 * entries: migrations are forward-only and this list is replayed, idempotently, on every
 * migrateDatabase() call.
 */
export const POST_MIGRATE_STEPS: readonly PostMigrateStep[] = [
  { kind: 'validateConstraint', table: 'sessions', constraint: 'sessions_package_version_fk' },
  { kind: 'validateConstraint', table: 'sessions', constraint: 'sessions_package_pin_complete' },
  { kind: 'validateConstraint', table: 'sessions', constraint: 'sessions_open_has_package' },
  {
    kind: 'concurrentIndex',
    indexName: 'sessions_package_id_package_version_idx',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "sessions_package_id_package_version_idx" ON "sessions" USING btree ("package_id","package_version")`,
  },
  {
    kind: 'concurrentIndex',
    indexName: 'sessions_open_teacher_id_student_id_idx',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "sessions_open_teacher_id_student_id_idx" ON "sessions" USING btree ("teacher_id","student_id") WHERE "sessions"."ended_at" is null`,
  },
];

/** True once `ALTER TABLE ... VALIDATE CONSTRAINT` has already succeeded for this constraint. */
async function isConstraintValidated(
  client: pg.Pool,
  table: string,
  constraint: string,
): Promise<boolean> {
  const { rows } = await client.query<{ convalidated: boolean }>(
    `select convalidated from pg_constraint where conname = $1 and conrelid = $2::regclass`,
    [constraint, table],
  );
  // No row: the constraint doesn't exist (an older database, or a migration not yet applied).
  // Treated as "nothing to validate" rather than an error, so a partial/old database doesn't
  // fail; VALIDATE CONSTRAINT would fail on a missing constraint anyway.
  return rows[0]?.convalidated ?? true;
}

/**
 * True when an index with this name already exists but is INVALID (a `CREATE INDEX
 * CONCURRENTLY` that failed or was killed partway leaves exactly this behind: the index exists,
 * so a later `IF NOT EXISTS` silently keeps it, forever unused and never revalidated). No row
 * (the index doesn't exist, or exists and is valid) is "nothing to fix".
 *
 * Schema-qualified with `to_regclass('public.' || $1)` (task 3.16c, 3.16b review deferral): a
 * bare `relname` match would also find a same-named index in another schema (a stray test schema,
 * `drizzle`, or a future multi-schema setup), and could drop or skip the wrong one.
 */
async function isIndexInvalid(client: pg.Pool, indexName: string): Promise<boolean> {
  const { rows } = await client.query<{ indisvalid: boolean }>(
    `select indisvalid from pg_index where indexrelid = to_regclass('public.' || $1)`,
    [indexName],
  );
  return rows[0]?.indisvalid === false;
}

/**
 * Runs every `PostMigrateStep` once drizzle's migrate() has committed. Each step is its own
 * statement with no surrounding transaction (node-postgres autocommits a bare `.query()`), and
 * every step is idempotent: a `VALIDATE CONSTRAINT` already satisfied is skipped; an index left
 * INVALID by an earlier failed or killed `CREATE INDEX CONCURRENTLY` is dropped and rebuilt (both
 * steps still autocommit, outside any transaction); otherwise `CREATE INDEX CONCURRENTLY IF NOT
 * EXISTS` is a no-op on a second run.
 */
export async function runPostMigrateSteps(
  client: pg.Pool,
  steps: readonly PostMigrateStep[] = POST_MIGRATE_STEPS,
): Promise<void> {
  for (const step of steps) {
    if (step.kind === 'validateConstraint') {
      if (await isConstraintValidated(client, step.table, step.constraint)) continue;
      await client.query(
        `ALTER TABLE "${step.table}" VALIDATE CONSTRAINT "${step.constraint}"`,
      );
    } else {
      if (await isIndexInvalid(client, step.indexName)) {
        await client.query(`DROP INDEX CONCURRENTLY IF EXISTS "${step.indexName}"`);
      }
      await client.query(step.sql);
    }
  }
}

/**
 * Applies every pending migration in MIGRATIONS_DIR (forward-only; already-applied ones are
 * skipped, tracked in drizzle.__drizzle_migrations), then runs the post-migrate steps (task
 * 3.16b), then closes the connection.
 *
 * Task 3.16c: the whole run is wrapped in a session-level advisory lock (`MIGRATE_LOCK_KEY`),
 * taken by polling `pg_try_advisory_lock` (see {@link acquireMigrateLock}) on its own dedicated
 * connection (not the migrator's pool: that pool's `max: 1` would deadlock against itself if the
 * lock and the migration shared it), and released in `finally` even on error or a killed process
 * (Postgres clears a session lock when its connection ends). A second overlapping call waits here
 * until the first finishes, then finds the migrations table up to date, the constraints validated
 * and the index valid, and skips the drop.
 */
export async function migrateDatabase(url: string): Promise<void> {
  const lockClient = new pg.Client({ connectionString: url });
  await lockClient.connect();
  try {
    await acquireMigrateLock(lockClient, MIGRATE_LOCK_KEY);
    const { db, pool, close } = createDb({ DATABASE_URL: url }, MIGRATE_POOL_OPTIONS);
    try {
      await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
      await runPostMigrateSteps(pool);
    } finally {
      await close();
    }
  } finally {
    try {
      await lockClient.query('select pg_advisory_unlock($1)', [MIGRATE_LOCK_KEY]);
    } finally {
      await lockClient.end();
    }
  }
}
