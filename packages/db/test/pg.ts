// Shared Postgres helpers for the integration tests (task 1.1's logic, moved here in 1.2).
//
// Locally: docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml up -d postgres
// (the override publishes the compose Postgres on 127.0.0.1:55432 only). CI sets TEST_DATABASE_URL to
// the job's Postgres service. With no database reachable the suites skip locally and fail in CI.
//
// Each suite creates its own throwaway database and drops it afterwards; it never touches the
// database named in the URL beyond CREATE/DROP DATABASE.
import { randomBytes } from 'node:crypto';
import pg from 'pg';

export const ADMIN_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://edmate:edmate-dev@127.0.0.1:55432/edmate';

export async function reachable(url: string): Promise<boolean> {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 2_000 });
  try {
    await client.connect();
    await client.query('select 1');
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

export const SKIP_REASON =
  'SKIPPED: no Postgres at TEST_DATABASE_URL (default 127.0.0.1:55432). Start one with: ' +
  'docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml up -d postgres';

/** True when Postgres is reachable. Throws in CI when it is not; logs the skip reason locally. */
export async function postgresUp(suite: string): Promise<boolean> {
  const up = await reachable(ADMIN_URL);
  if (!up && process.env.CI === 'true') {
    throw new Error(
      'CI=true but no Postgres is reachable at TEST_DATABASE_URL; the db job needs it',
    );
  }
  if (!up) process.stderr.write(`[@edmate/db] ${suite} ${SKIP_REASON}\n`);
  return up;
}

export function urlFor(name: string): string {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${name}`;
  return u.toString();
}

export function throwawayName(): string {
  return `edmate_test_${randomBytes(6).toString('hex')}`;
}

export async function admin<T>(fn: (c: pg.Client) => Promise<T>, url = ADMIN_URL): Promise<T> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

export async function createDatabase(name: string): Promise<void> {
  await admin((c) => c.query(`create database "${name}"`));
}

export async function dropDatabase(name: string): Promise<void> {
  await admin((c) => c.query(`drop database if exists "${name}" with (force)`));
}
