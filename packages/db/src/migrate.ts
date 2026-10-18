import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client.js';

/** packages/db/migrations, from both src/ (tests) and dist/ (built). */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

/**
 * Applies every pending migration in MIGRATIONS_DIR (forward-only; already-applied ones are
 * skipped, tracked in drizzle.__drizzle_migrations), then closes the connection.
 */
export async function migrateDatabase(url: string): Promise<void> {
  const { db, close } = createDb({ DATABASE_URL: url });
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await close();
  }
}
