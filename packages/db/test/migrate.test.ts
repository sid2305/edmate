// Unit tests for runPostMigrateSteps (task 3.16b): the branches that don't need a real
// Postgres (a missing constraint row, an already-validated constraint, and a step that runs).
// Integration coverage against real Postgres is in migrate.int.test.ts.
import { describe, expect, it, vi } from 'vitest';
import { POST_MIGRATE_STEPS, runPostMigrateSteps, type PostMigrateStep } from '../src/migrate.js';

interface FakeClient {
  query: ReturnType<typeof vi.fn>;
}

function fakeClient(convalidated: (boolean | undefined)[]): FakeClient {
  const query = vi.fn();
  let call = 0;
  query.mockImplementation((sql: string) => {
    if (sql.includes('pg_constraint')) {
      const value = convalidated[call++];
      return Promise.resolve({ rows: value === undefined ? [] : [{ convalidated: value }] });
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

  it('runs a concurrent-index step as its own statement', async () => {
    const client = fakeClient([]);
    const steps: PostMigrateStep[] = [
      { kind: 'concurrentIndex', indexName: 'an_idx', sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "an_idx" ON "t" ("c")' },
    ];
    await runPostMigrateSteps(client as never, steps);
    expect(client.query).toHaveBeenCalledWith(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "an_idx" ON "t" ("c")',
    );
  });

  it('the default step list runs the three 0009 VALIDATEs and the package-pin index', () => {
    expect(POST_MIGRATE_STEPS.filter((s) => s.kind === 'validateConstraint')).toHaveLength(3);
    expect(POST_MIGRATE_STEPS.filter((s) => s.kind === 'concurrentIndex')).toEqual([
      {
        kind: 'concurrentIndex',
        indexName: 'sessions_package_id_package_version_idx',
        sql: expect.stringContaining('CREATE INDEX CONCURRENTLY IF NOT EXISTS'),
      },
    ]);
  });
});
