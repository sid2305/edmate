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
    const { rows } = await client.query<{ locked: boolean }>(
      'select pg_try_advisory_lock($1) as locked',
      [key],
    );
    if (rows[0]?.locked) return;
    if (Date.now() >= deadline) {
      throw new Error(
        `migrateDatabase: timed out after ${maxWaitMs}ms waiting for the migration lock`,
      );
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

/** Options for {@link migrateDatabase}. */
export interface MigrateOptions {
  /**
   * ms bound for each post-migrate step's `statement_timeout` (task 3.16d, 3.16c review
   * deferral). Falls back to env `EDMATE_MIGRATE_STEP_TIMEOUT_MS`, then {@link
   * DEFAULT_STEP_TIMEOUT_MS}.
   */
  stepTimeoutMs?: number;
}

/** Default {@link MigrateOptions.stepTimeoutMs}: 15 minutes. */
export const DEFAULT_STEP_TIMEOUT_MS = 15 * 60_000;

/**
 * Resolves the post-migrate step timeout: `options.stepTimeoutMs`, else env
 * `EDMATE_MIGRATE_STEP_TIMEOUT_MS`, else {@link DEFAULT_STEP_TIMEOUT_MS}. Throws on a set but
 * non-positive or non-numeric env value rather than silently falling back.
 */
export function stepTimeoutMs(options: MigrateOptions = {}): number {
  if (options.stepTimeoutMs !== undefined) return options.stepTimeoutMs;
  const raw = process.env.EDMATE_MIGRATE_STEP_TIMEOUT_MS;
  if (raw === undefined || raw === '') return DEFAULT_STEP_TIMEOUT_MS;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new Error('EDMATE_MIGRATE_STEP_TIMEOUT_MS must be a positive whole number of ms');
  }
  return n;
}

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
 * `sessions_open_teacher_id_student_id_idx` the same schema-only way. Migration 0023 (task 12.4a)
 * adds `agents_regulated_approved_by_users_id_fk`, `agents_regulated_subject_check` and
 * `agents_regulated_approval_check` as `NOT VALID` the same way (and migration 0024, task 11.4a,
 * `documents_live_class_id_live_classes_id_fk`), so the validation scan of the
 * existing `agents` rows runs outside drizzle's migration transaction. This is what makes the
 * constraints valid and the indexes built, outside any transaction. Migration 0028 (task 5.10d)
 * adds `sessions_open_teacher_student_agent_key` the same schema-only way, after first ending any
 * existing duplicate open sessions in its own migration-file UPDATE (so the index build below
 * never sees a duplicate). Migration 0032 (task 13.4a, 13.4 review deferral) adds
 * `chunks_transcript_created_at_idx`, `sessions_created_at_idx` and `turn_traces_created_at_idx`
 * the same schema-only way. Append here, don't edit past entries: migrations are forward-only and
 * this list is replayed, idempotently, on every migrateDatabase() call.
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
  {
    kind: 'validateConstraint',
    table: 'agents',
    constraint: 'agents_regulated_approved_by_users_id_fk',
  },
  { kind: 'validateConstraint', table: 'agents', constraint: 'agents_regulated_subject_check' },
  { kind: 'validateConstraint', table: 'agents', constraint: 'agents_regulated_approval_check' },
  // Migration 0024 (task 11.4a): documents.live_class_id's FK, added NOT VALID the same way.
  {
    kind: 'validateConstraint',
    table: 'documents',
    constraint: 'documents_live_class_id_live_classes_id_fk',
  },
  // Migration 0028 (task 5.10d): at most one open session per (teacher_id, student_id, agent_id);
  // sessions.create relies on this for its ON CONFLICT ... WHERE ended_at is null reuse.
  {
    kind: 'concurrentIndex',
    indexName: 'sessions_open_teacher_student_agent_key',
    sql: `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "sessions_open_teacher_student_agent_key" ON "sessions" USING btree ("teacher_id","student_id","agent_id") WHERE "sessions"."ended_at" is null`,
  },
  // Migration 0032 (task 13.4a, 13.4 review deferral): retentionRepo's cutoff scans.
  {
    kind: 'concurrentIndex',
    indexName: 'chunks_transcript_created_at_idx',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "chunks_transcript_created_at_idx" ON "chunks" USING btree ("kind","created_at") WHERE "chunks"."kind" = 'transcript'`,
  },
  {
    kind: 'concurrentIndex',
    indexName: 'sessions_created_at_idx',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "sessions_created_at_idx" ON "sessions" USING btree ("created_at")`,
  },
  {
    kind: 'concurrentIndex',
    indexName: 'turn_traces_created_at_idx',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "turn_traces_created_at_idx" ON "turn_traces" USING btree ("created_at")`,
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
 * Schema-qualified with `to_regclass(format('%I.%I', 'public', $1))` (task 3.16c/3.16d, 3.16b
 * review deferral): a bare `relname` match would also find a same-named index in another schema
 * (a stray test schema, `drizzle`, or a future multi-schema setup), and could drop or skip the
 * wrong one. `format('%I.%I', ...)` (not string concatenation with `'public.' || $1`) quotes each
 * identifier, so a mixed-case or otherwise-needs-quoting index name still resolves to itself
 * rather than silently matching nothing (or, with an unlucky name, a different, lowercased
 * relation).
 */
async function isIndexInvalid(client: pg.Pool, indexName: string): Promise<boolean> {
  const { rows } = await client.query<{ indisvalid: boolean }>(
    `select indisvalid from pg_index where indexrelid = to_regclass(format('%I.%I', 'public', $1::text))`,
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
 *
 * Caller's caveat (task 3.16d, 3.16c review deferral): `CREATE`/`DROP INDEX CONCURRENTLY` must
 * wait out every transaction holding a snapshot that predates it, not just ones that touch the
 * indexed table — a wholly unrelated connection left idle-in-transaction (a forgotten `BEGIN`, a
 * leaked app connection) can block a step indefinitely. `migrateDatabase` bounds this with a
 * `statement_timeout` on the connection these steps run on, so such a step times out instead of
 * hanging the whole migration run; a timed-out `CREATE INDEX CONCURRENTLY` just leaves the index
 * INVALID, which `isIndexInvalid` already detects and the next run drops and rebuilds.
 */
export async function runPostMigrateSteps(
  client: pg.Pool,
  steps: readonly PostMigrateStep[] = POST_MIGRATE_STEPS,
): Promise<void> {
  for (const step of steps) {
    if (step.kind === 'validateConstraint') {
      if (await isConstraintValidated(client, step.table, step.constraint)) continue;
      await client.query(`ALTER TABLE "${step.table}" VALIDATE CONSTRAINT "${step.constraint}"`);
    } else {
      if (await isIndexInvalid(client, step.indexName)) {
        await client.query(`DROP INDEX CONCURRENTLY IF EXISTS "${step.indexName}"`);
      }
      await client.query(step.sql);
    }
  }
}

/**
 * Runs `fn` while holding the session-level advisory lock `key` on `lockClient`, releasing it in
 * `finally` — but only when `acquireMigrateLock` actually reported success (task 3.16d, 3.16c
 * review deferral). A `pg_advisory_unlock` call after a failed acquire (the poll timed out, or
 * `lockClient`'s connection died mid-poll) would release a lock this process never took — at best
 * a no-op, at worst a confusing extra error — and either way must not replace or swallow the
 * acquire failure itself, which is the one that matters to the caller.
 */
export async function withMigrateLock<T>(
  lockClient: Pick<pg.Client, 'query'>,
  key: bigint,
  fn: () => Promise<T>,
  maxWaitMs = LOCK_MAX_WAIT_MS,
): Promise<T> {
  let locked = false;
  try {
    await acquireMigrateLock(lockClient as pg.Client, key, maxWaitMs);
    locked = true;
    return await fn();
  } finally {
    if (locked) {
      await lockClient.query('select pg_advisory_unlock($1)', [key]);
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
 * lock and the migration shared it), and released in `finally` only when it was actually acquired
 * (see {@link withMigrateLock}) even on error or a killed process (Postgres also clears a session
 * lock when its connection ends). A second overlapping call waits here until the first finishes,
 * then finds the migrations table up to date, the constraints validated and the index valid, and
 * skips the drop.
 *
 * Task 3.16d: the post-migrate steps' connection gets a bounded `statement_timeout`
 * ({@link stepTimeoutMs}) via `set_config` (session-level, not `SET`, so it can be parameterized)
 * before `runPostMigrateSteps` runs — see that function's caveat about a stray idle-in-transaction
 * session elsewhere hanging `CREATE`/`DROP INDEX CONCURRENTLY`. drizzle's own `migrate()` keeps
 * the pool's original unbounded timeout (`MIGRATE_POOL_OPTIONS`), so a long index build inside a
 * migration file itself (task 5.3) is unaffected.
 */
export async function migrateDatabase(url: string, options: MigrateOptions = {}): Promise<void> {
  const lockClient = new pg.Client({ connectionString: url });
  await lockClient.connect();
  try {
    await withMigrateLock(lockClient, MIGRATE_LOCK_KEY, async () => {
      const { db, pool, close } = createDb({ DATABASE_URL: url }, MIGRATE_POOL_OPTIONS);
      try {
        await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
        await pool.query(`select set_config('statement_timeout', $1, false)`, [
          String(stepTimeoutMs(options)),
        ]);
        await runPostMigrateSteps(pool);
      } finally {
        await close();
      }
    });
  } finally {
    await lockClient.end();
  }
}
