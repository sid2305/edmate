import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';
import { createDb } from './client.js';

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
 * a schema-only index (task 3.16b); this is what makes them valid and built, outside any
 * transaction. Append here, don't edit past entries: migrations are forward-only and this list is
 * replayed, idempotently, on every migrateDatabase() call.
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
 */
async function isIndexInvalid(client: pg.Pool, indexName: string): Promise<boolean> {
  const { rows } = await client.query<{ indisvalid: boolean }>(
    `select i.indisvalid from pg_class c
       join pg_index i on i.indexrelid = c.oid
       where c.relname = $1`,
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
 */
export async function migrateDatabase(url: string): Promise<void> {
  const { db, pool, close } = createDb({ DATABASE_URL: url }, MIGRATE_POOL_OPTIONS);
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    await runPostMigrateSteps(pool);
  } finally {
    await close();
  }
}
