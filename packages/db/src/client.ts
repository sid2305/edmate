import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { redact } from './redact.js';
import * as schema from './schema/index.js';

export type Db = NodePgDatabase<typeof schema>;

export interface DbHandle {
  db: Db;
  pool: pg.Pool;
  /** Ends the pool; call once on shutdown. */
  close: () => Promise<void>;
}

export interface DbEnv {
  DATABASE_URL?: string | undefined;
  DATABASE_POOL_MAX?: string | undefined;
  DATABASE_IDLE_TIMEOUT_MS?: string | undefined;
  DATABASE_CONNECT_TIMEOUT_MS?: string | undefined;
  DATABASE_STATEMENT_TIMEOUT_MS?: string | undefined;
}

/** Optional pool settings: env name, default, inclusive range. */
const SETTINGS = {
  DATABASE_POOL_MAX: { fallback: 10, min: 1, max: 100 },
  DATABASE_IDLE_TIMEOUT_MS: { fallback: 30_000, min: 1_000, max: 600_000 },
  DATABASE_CONNECT_TIMEOUT_MS: { fallback: 5_000, min: 500, max: 60_000 },
  DATABASE_STATEMENT_TIMEOUT_MS: { fallback: 15_000, min: 100, max: 600_000 },
} as const;

/** A whole number in range, or the default when unset or empty. Anything else throws. */
function setting(env: DbEnv, name: keyof typeof SETTINGS): number {
  const { fallback, min, max } = SETTINGS[name];
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be a whole number from ${min} to ${max}`);
  }
  return n;
}

/**
 * Pool options from env (1.1 review deferral (c)): bounded pool size, idle, connect and statement
 * timeouts, a fixed idle-in-transaction timeout and application name. `overrides` wins.
 */
export function poolOptions(env: DbEnv, overrides: Partial<pg.PoolConfig> = {}): pg.PoolConfig {
  const url = env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return {
    connectionString: url,
    max: setting(env, 'DATABASE_POOL_MAX'),
    idleTimeoutMillis: setting(env, 'DATABASE_IDLE_TIMEOUT_MS'),
    connectionTimeoutMillis: setting(env, 'DATABASE_CONNECT_TIMEOUT_MS'),
    statement_timeout: setting(env, 'DATABASE_STATEMENT_TIMEOUT_MS'),
    idle_in_transaction_session_timeout: 30_000,
    application_name: 'edmate',
    ...overrides,
  };
}

/**
 * A Drizzle database over a node-postgres pool, from `env.DATABASE_URL`. The pool connects lazily,
 * on the first query. Throws if the URL is missing rather than falling back to libpq defaults, and
 * on an invalid pool setting rather than silently defaulting.
 *
 * Internal: app code gets repositories from `openDatabase` instead (`@edmate/db`), never this
 * handle (`@edmate/db/internal` is for migrations, seed and tests).
 */
export function createDb(
  env: DbEnv = process.env,
  overrides: Partial<pg.PoolConfig> = {},
): DbHandle {
  const pool = new pg.Pool(poolOptions(env, overrides));
  // An idle client losing its connection must not crash the process; the pool replaces it.
  pool.on('error', (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[@edmate/db] idle client error: ${redact(message)}\n`);
  });
  const db = drizzle({ client: pool, schema });
  return { db, pool, close: () => pool.end() };
}
