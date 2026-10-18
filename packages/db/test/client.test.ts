import { describe, expect, it } from 'vitest';
import { createDb } from '../src/client.js';
import { runMigrateCli } from '../src/cli.js';
import { MIGRATIONS_DIR } from '../src/migrate.js';

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

describe('MIGRATIONS_DIR', () => {
  it('points at the package migrations folder', () => {
    expect(MIGRATIONS_DIR).toMatch(/packages[/\\]db[/\\]migrations$/);
  });
});
