// @edmate/db: scoped repositories only. There is no raw database handle and no schema here, so app
// code has no unscoped path to the data; migrations, the seed and tests use `@edmate/db/internal`.
import { createDb, type DbEnv } from './client.js';
import { createRepositories, type Repositories } from './repositories/index.js';

export * from './repositories/index.js';
export { migrateDatabase, MIGRATIONS_DIR } from './migrate.js';
export type { DbEnv } from './client.js';

/** Repositories over a pool from env (see client.ts for the pool settings). */
export function openDatabase(env: DbEnv = process.env): {
  repos: Repositories;
  close: () => Promise<void>;
} {
  const { db, close } = createDb(env);
  return { repos: createRepositories(db), close };
}
