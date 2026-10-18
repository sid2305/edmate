import { describe, expect, it, vi } from 'vitest';
import { createDb, poolOptions } from '../src/client.js';
import { runMigrateCli } from '../src/cli.js';
import { MIGRATE_POOL_OPTIONS, MIGRATIONS_DIR } from '../src/migrate.js';

describe('createDb', () => {
  it('fails closed when no connection string is given', () => {
    expect(() => createDb({})).toThrow(/DATABASE_URL is not set/);
    expect(() => createDb({ DATABASE_URL: '' })).toThrow(/DATABASE_URL is not set/);
  });

  it('builds a lazy pool from DATABASE_URL without connecting', async () => {
    const handle = createDb({ DATABASE_URL: 'postgres://u:p@127.0.0.1:1/none' });
    expect(handle.db).toBeDefined();
    expect(handle.pool.totalCount).toBe(0);
    await handle.close();
  });
});

describe('pool options (1.1 review deferral (c))', () => {
  const URL_ = 'postgres://u:p@127.0.0.1:1/none';

  it('applies the defaults', () => {
    expect(poolOptions({ DATABASE_URL: URL_ })).toEqual({
      connectionString: URL_,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 15_000,
      idle_in_transaction_session_timeout: 30_000,
      application_name: 'edmate',
    });
  });

  it('honours each env variable', () => {
    expect(
      poolOptions({
        DATABASE_URL: URL_,
        DATABASE_POOL_MAX: '3',
        DATABASE_IDLE_TIMEOUT_MS: '1000',
        DATABASE_CONNECT_TIMEOUT_MS: '60000',
        DATABASE_STATEMENT_TIMEOUT_MS: '100',
      }),
    ).toMatchObject({
      max: 3,
      idleTimeoutMillis: 1_000,
      connectionTimeoutMillis: 60_000,
      statement_timeout: 100,
    });
  });

  it('treats an empty value as unset', () => {
    expect(poolOptions({ DATABASE_URL: URL_, DATABASE_POOL_MAX: '' }).max).toBe(10);
  });

  it.each([
    ['DATABASE_POOL_MAX', '0'],
    ['DATABASE_POOL_MAX', '101'],
    ['DATABASE_POOL_MAX', '2.5'],
    ['DATABASE_POOL_MAX', 'ten'],
    ['DATABASE_POOL_MAX', '-1'],
    ['DATABASE_POOL_MAX', '1e2'],
    ['DATABASE_IDLE_TIMEOUT_MS', '999'],
    ['DATABASE_IDLE_TIMEOUT_MS', '600001'],
    ['DATABASE_CONNECT_TIMEOUT_MS', '499'],
    ['DATABASE_CONNECT_TIMEOUT_MS', '60001'],
    ['DATABASE_STATEMENT_TIMEOUT_MS', '99'],
    ['DATABASE_STATEMENT_TIMEOUT_MS', '600001'],
  ])('throws on %s=%s instead of defaulting', (name, value) => {
    expect(() => poolOptions({ DATABASE_URL: URL_, [name]: value })).toThrow(name);
  });

  it('lets the caller override options (the migrator uses one connection, no statement timeout)', () => {
    expect(poolOptions({ DATABASE_URL: URL_ }, { max: 1, statement_timeout: false })).toMatchObject(
      { max: 1, statement_timeout: false },
    );
  });

  it('builds the pool with those options', async () => {
    const handle = createDb({ DATABASE_URL: URL_, DATABASE_POOL_MAX: '4' });
    expect(handle.pool.options.max).toBe(4);
    expect(handle.pool.options.statement_timeout).toBe(15_000);
    await handle.close();
  });

  it('logs an idle client error without crashing and without the connection string', async () => {
    const handle = createDb({ DATABASE_URL: URL_ });
    expect(handle.pool.listenerCount('error')).toBe(1);
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      handle.pool.emit(
        'error',
        new Error('lost postgres://someone:not-a-real-password@127.0.0.1:1/none'),
      );
      const out = write.mock.calls.map((c) => String(c[0])).join('');
      expect(out).toMatch(/idle client error/);
      expect(out).not.toContain('not-a-real-password');
      handle.pool.emit('error', 'not an error object');
      expect(write).toHaveBeenCalledTimes(2);
    } finally {
      write.mockRestore();
      await handle.close();
    }
  });
});

describe('runMigrateCli', () => {
  it('exits 1 with a clear message when DATABASE_URL is missing', async () => {
    const lines: string[] = [];
    const code = await runMigrateCli({}, (l) => lines.push(l));
    expect(code).toBe(1);
    expect(lines.join('\n')).toMatch(/DATABASE_URL is not set/);
  });

  it('exits 1 and does not echo the connection string when the database is unreachable', async () => {
    const lines: string[] = [];
    const url = 'postgres://someone:not-a-real-password@127.0.0.1:1/none';
    const code = await runMigrateCli({ DATABASE_URL: url }, (l) => lines.push(l));
    expect(code).toBe(1);
    const out = lines.join('\n');
    expect(out).toMatch(/migration failed/);
    expect(out).not.toContain('not-a-real-password');
  });
});

describe('migrator pool', () => {
  it('uses one connection and no statement timeout (long migrations such as an HNSW index)', () => {
    expect(MIGRATE_POOL_OPTIONS).toEqual({ max: 1, statement_timeout: false });
  });
});

describe('MIGRATIONS_DIR', () => {
  it('points at the package migrations folder', () => {
    expect(MIGRATIONS_DIR).toMatch(/packages[/\\]db[/\\]migrations$/);
  });
});
