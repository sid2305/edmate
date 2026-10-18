import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client.js';

/** packages/db/migrations, from both src/ (tests) and dist/ (built). */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

/**
 * The migrator's pool: one connection, and no statement timeout, so a long migration (an HNSW
 * index build, task 5.3) is not cancelled by the app's 15 s default.
 */
export const MIGRATE_POOL_OPTIONS = { max: 1, statement_timeout: false } as const;

/**
 * Applies every pending migration in MIGRATIONS_DIR (forward-only; already-applied ones are
 * skipped, tracked in drizzle.__drizzle_migrations), then closes the connection.
 */
export async function migrateDatabase(url: string): Promise<void> {
  const { db, close } = createDb({ DATABASE_URL: url }, MIGRATE_POOL_OPTIONS);
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await close();
  }
}
