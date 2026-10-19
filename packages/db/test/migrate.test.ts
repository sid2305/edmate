// Unit tests for runPostMigrateSteps (task 3.16b): the branches that don't need a real
// Postgres (a missing constraint row, an already-validated constraint, a step that runs, and an
// INVALID leftover index that must be dropped and rebuilt). Integration coverage against real
// Postgres is in migrate.int.test.ts.
import { describe, expect, it, vi } from 'vitest';
import {
  acquireMigrateLock,
  POST_MIGRATE_STEPS,
  runPostMigrateSteps,
  type PostMigrateStep,
} from '../src/migrate.js';

interface FakeClient {
  query: ReturnType<typeof vi.fn>;
}

/**
 * A fake `pg.Pool` whose lookup queries (`pg_constraint`, `pg_index`) answer from a fixed,
 * in-order queue, one answer per lookup call; every other statement (VALIDATE, DROP, CREATE) just
 * resolves with no rows.
 */
function fakeClient(answers: (boolean | undefined)[]): FakeClient {
  const query = vi.fn();
  let call = 0;
  query.mockImplementation((sql: string) => {
    if (sql.includes('pg_constraint')) {
      const value = answers[call++];
      return Promise.resolve({ rows: value === undefined ? [] : [{ convalidated: value }] });
    }
    if (sql.includes('pg_index')) {
      const value = answers[call++];
      return Promise.resolve({ rows: value === undefined ? [] : [{ indisvalid: value }] });
    }
    return Promise.resolve({ rows: [] });
  });
  return { query };
}

describe('runPostMigrateSteps', () => {
  it('skips VALIDATE CONSTRAINT when pg_constraint already reports it valid', async () => {
    const client = fakeClient([true]);
    const steps: PostMigrateStep[] = [
      { kind: 'validateConstraint', table: 'sessions', constraint: 'sessions_open_has_package' },
    ];
    await runPostMigrateSteps(client as never, steps);
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.query.mock.calls[0]?.[0]).toMatch(/pg_constraint/);
  });

  it('runs VALIDATE CONSTRAINT when pg_constraint reports it not yet valid', async () => {
    const client = fakeClient([false]);
    const steps: PostMigrateStep[] = [
      { kind: 'validateConstraint', table: 'sessions', constraint: 'sessions_open_has_package' },
    ];
    await runPostMigrateSteps(client as never, steps);
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(client.query.mock.calls[1]?.[0]).toBe(
      'ALTER TABLE "sessions" VALIDATE CONSTRAINT "sessions_open_has_package"',
    );
  });

  it('treats a missing constraint row as nothing to validate', async () => {
    const client = fakeClient([undefined]);
    const steps: PostMigrateStep[] = [
      { kind: 'validateConstraint', table: 'sessions', constraint: 'sessions_open_has_package' },
    ];
    await runPostMigrateSteps(client as never, steps);
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it('runs a concurrent-index step as its own statement when no index exists yet', async () => {
    const client = fakeClient([undefined]);
    const steps: PostMigrateStep[] = [
      { kind: 'concurrentIndex', indexName: 'an_idx', sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "an_idx" ON "t" ("c")' },
    ];
    await runPostMigrateSteps(client as never, steps);
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(client.query.mock.calls[0]?.[0]).toMatch(/pg_index/);
    expect(client.query.mock.calls[1]?.[0]).toBe(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "an_idx" ON "t" ("c")',
    );
  });

  it('skips the drop when the index already exists and is valid', async () => {
    const client = fakeClient([true]);
    const steps: PostMigrateStep[] = [
      { kind: 'concurrentIndex', indexName: 'an_idx', sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "an_idx" ON "t" ("c")' },
    ];
    await runPostMigrateSteps(client as never, steps);
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(client.query.mock.calls.some((c) => String(c[0]).includes('DROP INDEX'))).toBe(false);
  });

  it('qualifies the index lookup to the public schema with to_regclass, not a bare relname match', async () => {
    const client = fakeClient([true]);
    const steps: PostMigrateStep[] = [
      { kind: 'concurrentIndex', indexName: 'an_idx', sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "an_idx" ON "t" ("c")' },
    ];
    await runPostMigrateSteps(client as never, steps);
    const lookup = String(client.query.mock.calls[0]?.[0]);
    expect(lookup).toMatch(/to_regclass\('public\.' \|\| \$1\)/);
    expect(client.query.mock.calls[0]?.[1]).toEqual(['an_idx']);
  });

  it('drops and rebuilds an INVALID leftover index (a failed or killed earlier build)', async () => {
    const client = fakeClient([false]);
    const steps: PostMigrateStep[] = [
      { kind: 'concurrentIndex', indexName: 'an_idx', sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "an_idx" ON "t" ("c")' },
    ];
    await runPostMigrateSteps(client as never, steps);
    expect(client.query).toHaveBeenCalledTimes(3);
    expect(client.query.mock.calls[0]?.[0]).toMatch(/pg_index/);
    expect(client.query.mock.calls[1]?.[0]).toBe('DROP INDEX CONCURRENTLY IF EXISTS "an_idx"');
    expect(client.query.mock.calls[2]?.[0]).toBe(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "an_idx" ON "t" ("c")',
    );
  });

  it('the default step list runs the three 0009 VALIDATEs and the package-pin and open-session indexes', () => {
    expect(POST_MIGRATE_STEPS.filter((s) => s.kind === 'validateConstraint')).toHaveLength(3);
    expect(POST_MIGRATE_STEPS.filter((s) => s.kind === 'concurrentIndex')).toEqual([
      {
        kind: 'concurrentIndex',
        indexName: 'sessions_package_id_package_version_idx',
        sql: expect.stringContaining('CREATE INDEX CONCURRENTLY IF NOT EXISTS'),
      },
      {
        kind: 'concurrentIndex',
        indexName: 'sessions_open_teacher_id_student_id_idx',
        sql: expect.stringMatching(
          /CREATE INDEX CONCURRENTLY IF NOT EXISTS.*WHERE.*"ended_at" is null/,
        ),
      },
    ]);
  });
});

describe('acquireMigrateLock', () => {
  it('returns immediately when pg_try_advisory_lock reports true on the first poll', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ locked: true }] });
    await acquireMigrateLock({ query } as never, 1n);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toMatch(/pg_try_advisory_lock/);
    expect(query.mock.calls[0]?.[1]).toEqual([1n]);
  });

  it('polls until pg_try_advisory_lock reports true', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ locked: false }] })
      .mockResolvedValueOnce({ rows: [{ locked: false }] })
      .mockResolvedValueOnce({ rows: [{ locked: true }] });
    await acquireMigrateLock({ query } as never, 1n, 10_000);
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('gives up and throws once maxWaitMs elapses with the lock still held elsewhere', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ locked: false }] });
    await expect(acquireMigrateLock({ query } as never, 1n, 0)).rejects.toThrow(
      /timed out after 0ms waiting for the migration lock/,
    );
  });
});
