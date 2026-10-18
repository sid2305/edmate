import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

export type Db = NodePgDatabase<typeof schema>;

export interface DbHandle {
  db: Db;
  pool: pg.Pool;
  /** Ends the pool; call once on shutdown. */
  close: () => Promise<void>;
}

/**
 * A Drizzle database over a node-postgres pool, from `env.DATABASE_URL`. The pool connects lazily,
 * on the first query. Throws if the URL is missing rather than falling back to libpq defaults.
 */
export function createDb(env: { DATABASE_URL?: string | undefined } = process.env): DbHandle {
  const url = env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const pool = new pg.Pool({ connectionString: url });
  const db = drizzle({ client: pool, schema });
  return { db, pool, close: () => pool.end() };
}
