// @edmate/db: scoped repositories and the identity store only. There is no raw database handle and
// no schema here, so app code has no unscoped path to the data; migrations, the seed and tests use
// `@edmate/db/internal`.
import { createDb, type DbEnv } from './client.js';
import { createIdentityStore, type IdentityStore } from './identity/index.js';
import { createRepositories, type Repositories } from './repositories/index.js';

export * from './repositories/index.js';
export * from './identity/index.js';
export { migrateDatabase, MIGRATIONS_DIR } from './migrate.js';
export type { DbEnv } from './client.js';

/** Repositories and the sign-in identity store over one pool from env (see client.ts). */
export function openDatabase(env: DbEnv = process.env): {
  repos: Repositories;
  identity: IdentityStore;
  close: () => Promise<void>;
} {
  const { db, close } = createDb(env);
  return { repos: createRepositories(db), identity: createIdentityStore(db), close };
}
