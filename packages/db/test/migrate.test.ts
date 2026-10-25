// Unit tests for runPostMigrateSteps (task 3.16b): the branches that don't need a real
// Postgres (a missing constraint row, an already-validated constraint, a step that runs, and an
// INVALID leftover index that must be dropped and rebuilt). Integration coverage against real
// Postgres is in migrate.int.test.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  acquireMigrateLock,
  DEFAULT_STEP_TIMEOUT_MS,
  POST_MIGRATE_STEPS,
  runPostMigrateSteps,
  stepTimeoutMs,
  withMigrateLock,
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

  it('qualifies the index lookup to the public schema with to_regclass(format(...)), not string concatenation', async () => {
    const client = fakeClient([true]);
    const steps: PostMigrateStep[] = [
      { kind: 'concurrentIndex', indexName: 'an_idx', sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "an_idx" ON "t" ("c")' },
    ];
    await runPostMigrateSteps(client as never, steps);
    const lookup = String(client.query.mock.calls[0]?.[0]);
    expect(lookup).toMatch(/to_regclass\(format\('%I\.%I', 'public', \$1::text\)\)/);
    expect(client.query.mock.calls[0]?.[1]).toEqual(['an_idx']);
  });

  it('passes a mixed-case index name through as a plain parameter, for format(%I) to quote', async () => {
    const client = fakeClient([true]);
    const steps: PostMigrateStep[] = [
      {
        kind: 'concurrentIndex',
        indexName: 'MixedCaseIdx',
        sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "MixedCaseIdx" ON "t" ("c")',
      },
    ];
    await runPostMigrateSteps(client as never, steps);
    expect(client.query.mock.calls[0]?.[1]).toEqual(['MixedCaseIdx']);
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

  it('the default step list runs the three 0009 VALIDATEs, the three 0023 VALIDATEs, the 0024 VALIDATE and the package-pin and open-session indexes', () => {
    expect(POST_MIGRATE_STEPS.filter((s) => s.kind === 'validateConstraint')).toHaveLength(7);
    expect(
      POST_MIGRATE_STEPS.filter((s) => s.kind === 'validateConstraint' && s.table === 'documents'),
    ).toEqual([
      {
        kind: 'validateConstraint',
        table: 'documents',
        constraint: 'documents_live_class_id_live_classes_id_fk',
      },
    ]);
    expect(
      POST_MIGRATE_STEPS.filter((s) => s.kind === 'validateConstraint' && s.table === 'agents'),
    ).toEqual([
      {
        kind: 'validateConstraint',
        table: 'agents',
        constraint: 'agents_regulated_approved_by_users_id_fk',
      },
      { kind: 'validateConstraint', table: 'agents', constraint: 'agents_regulated_subject_check' },
      {
        kind: 'validateConstraint',
        table: 'agents',
        constraint: 'agents_regulated_approval_check',
      },
    ]);
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
      {
        kind: 'concurrentIndex',
        indexName: 'sessions_open_teacher_student_agent_key',
        sql: expect.stringMatching(
          /CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS.*WHERE.*"ended_at" is null/,
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

describe('withMigrateLock', () => {
  it('acquires, runs fn, and unlocks on success', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ locked: true }] });
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withMigrateLock({ query } as never, 1n, fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[0]).toMatch(/pg_try_advisory_lock/);
    expect(query.mock.calls[1]?.[0]).toMatch(/pg_advisory_unlock/);
    expect(query.mock.calls[1]?.[1]).toEqual([1n]);
  });

  it('unlocks even when fn throws, and still propagates fn\'s error', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ locked: true }] });
    const fn = vi.fn().mockRejectedValue(new Error('fn failed'));
    await expect(withMigrateLock({ query } as never, 1n, fn)).rejects.toThrow('fn failed');
    expect(query.mock.calls.some((c) => String(c[0]).includes('pg_advisory_unlock'))).toBe(true);
  });

  it('does not call pg_advisory_unlock when acquiring the lock itself failed (task 3.16d review deferral)', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ locked: false }] });
    const fn = vi.fn();
    await expect(withMigrateLock({ query } as never, 1n, fn, 0)).rejects.toThrow(
      /timed out after 0ms waiting for the migration lock/,
    );
    expect(fn).not.toHaveBeenCalled();
    expect(query.mock.calls.some((c) => String(c[0]).includes('pg_advisory_unlock'))).toBe(false);
  });

  it('does not mask the acquire failure with an unlock call, even when the connection is already dead', async () => {
    const query = vi.fn().mockRejectedValue(new Error('connection terminated'));
    const fn = vi.fn();
    await expect(withMigrateLock({ query } as never, 1n, fn)).rejects.toThrow(
      'connection terminated',
    );
    expect(fn).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe('stepTimeoutMs', () => {
  const ENV_KEY = 'EDMATE_MIGRATE_STEP_TIMEOUT_MS';
  const original = process.env[ENV_KEY];

  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
  });

  it('defaults to 15 minutes when nothing is set', () => {
    delete process.env[ENV_KEY];
    expect(stepTimeoutMs()).toBe(DEFAULT_STEP_TIMEOUT_MS);
    expect(DEFAULT_STEP_TIMEOUT_MS).toBe(15 * 60_000);
  });

  it('options.stepTimeoutMs wins over the env var', () => {
    process.env[ENV_KEY] = '1000';
    expect(stepTimeoutMs({ stepTimeoutMs: 42 })).toBe(42);
  });

  it('falls back to the env var when options is empty', () => {
    process.env[ENV_KEY] = '1234';
    expect(stepTimeoutMs({})).toBe(1234);
  });

  it('treats an empty env var as unset', () => {
    process.env[ENV_KEY] = '';
    expect(stepTimeoutMs({})).toBe(DEFAULT_STEP_TIMEOUT_MS);
  });

  it('throws on a non-numeric env var', () => {
    process.env[ENV_KEY] = 'not-a-number';
    expect(() => stepTimeoutMs({})).toThrow(/positive whole number/);
  });

  it('throws on a zero or negative env var', () => {
    process.env[ENV_KEY] = '0';
    expect(() => stepTimeoutMs({})).toThrow(/positive whole number/);
    process.env[ENV_KEY] = '-5';
    expect(() => stepTimeoutMs({})).toThrow(/positive whole number/);
  });
});
