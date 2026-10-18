// @edmate/db/internal: the raw Drizzle handle and schema, for migrations, the seed (1.5) and tests
// only. They bypass the repositories' scopes, so app code (apps/**) must not import this; a lint
// rule enforces that once an app imports the package (1.3).
export * from './schema/index.js';
export { createDb, poolOptions, type Db, type DbEnv, type DbHandle } from './client.js';
