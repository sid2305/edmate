// @edmate/db: scoped repositories and the identity store only. There is no raw database handle and
// no schema here, so app code has no unscoped path to the data; migrations, the seed and tests use
// `@edmate/db/internal`.
import { createDb, type DbEnv } from './client.js';
import {
  createIdentityStore,
  type IdentityStore,
  type IdentityStoreOptions,
} from './identity/index.js';
import {
  createRepositories,
  retentionRepo,
  regateRepo,
  ingestSweepRepo,
  type RetentionRepo,
  type RegateRepo,
  type IngestSweepRepo,
  type Repositories,
} from './repositories/index.js';

export * from './repositories/index.js';
// Task 8.2o: the one name for the kinds an uploaded file can have (apps/web's upload table reuses it).
export type { FileChunkKind } from './repositories/chunks.js';
export * from './identity/index.js';
export { migrateDatabase, MIGRATIONS_DIR } from './migrate.js';
export type { DbEnv } from './client.js';
export {
  applyBkt,
  BKT_DEFAULTS,
  foldMastery,
  type BktParams,
  type MasteryEntry,
} from './mastery.js';

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
  /** Task 13.4 (Phase A): the scheduled retention jobs (apps/worker's Phase B calls these). */
  retention: RetentionRepo;
  /** Task 13.regate: the regate sweep's candidate list (apps/worker's Phase B calls this). */
  regate: RegateRepo;
  /** Task 8.2i (Phase B): the stuck-`processing` sweep's candidate list (apps/worker calls this). */
  ingestSweep: IngestSweepRepo;
  close: () => Promise<void>;
} {
  const { db, close } = createDb(env);
  return {
    repos: createRepositories(db),
    identity: createIdentityStore(db, options.identity),
    retention: retentionRepo(db),
    regate: regateRepo(db),
    ingestSweep: ingestSweepRepo(db),
    close,
  };
}
