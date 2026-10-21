// @edmate/db: scoped repositories and the identity store only. There is no raw database handle and
// no schema here, so app code has no unscoped path to the data; migrations, the seed and tests use
// `@edmate/db/internal`.
import { createDb, type DbEnv } from './client.js';
import {
  createIdentityStore,
  type IdentityStore,
  type IdentityStoreOptions,
} from './identity/index.js';
import { createRepositories, type Repositories } from './repositories/index.js';

export * from './repositories/index.js';
export * from './identity/index.js';
export { migrateDatabase, MIGRATIONS_DIR } from './migrate.js';
export type { DbEnv } from './client.js';
export { applyBkt, BKT_DEFAULTS, foldMastery, type BktParams, type MasteryEntry } from './mastery.js';

export interface OpenDatabaseOptions {
  /** The identity store's age rule and notice versions (1.7; the web wires them from content). */
  identity?: Pick<IdentityStoreOptions, 'agePolicy' | 'noticeVersion'>;
}

/** Repositories and the sign-in identity store over one pool from env (see client.ts). */
export function openDatabase(
  env: DbEnv = process.env,
  options: OpenDatabaseOptions = {},
): {
  repos: Repositories;
  identity: IdentityStore;
  close: () => Promise<void>;
} {
  const { db, close } = createDb(env);
  return {
    repos: createRepositories(db),
    identity: createIdentityStore(db, options.identity),
    close,
  };
}
