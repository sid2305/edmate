// Task 6.4 on Postgres: sessionsRepo.end ends a session normally (the opposite direction of
// endOnPackageChange, 3.16) and, only when this call is the one that ends it, upserts the
// summary onto learner_profiles.last_summary for the same (student, teacher) pair, in one
// transaction. A retried call on an already-ended session is a no-op; another student's or
// teacher's session is not_found; an over-length summary is invalid and nothing is written. See
// test/pg.ts for how to start Postgres.
import { LIMITS } from '@edmate/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateDatabase } from '../src/migrate.js';
import { createDb, type DbHandle } from '../src/internal.js';
import {
  createRepositories,
  type Repositories,
  RepositoryError,
  type StudentScope,
} from '../src/index.js';
import { ids, seed, studentId, teacherId } from './isolation-seed.js';
import {
  createDatabase,
  dropDatabase,
  postgresUp,
  SKIP_REASON,
  throwawayName,
  urlFor,
} from './pg.js';

const up = await postgresUp('sessions.end tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
let handle: DbHandle;
let repos: Repositories;
let raw: pg.Client;

const ONE_A: StudentScope = { studentId: studentId('1'), teacherId: teacherId('A') };

async function newSession(): Promise<string> {
  const { id } = await repos.sessions.create(ONE_A, {
    agentId: ids.agent('A'),
    agentVersion: 1,
    packageId: ids.pkg('A'),
    packageVersion: 1,
  });
  return id;
}

async function lastSummary(scope: StudentScope = ONE_A): Promise<string | null | undefined> {
  const r = await raw.query<{ s: string | null }>(
    'select last_summary as s from learner_profiles where student_id = $1 and teacher_id = $2',
    [scope.studentId, scope.teacherId],
  );
  return r.rows[0]?.s;
}

async function setLastSummary(scope: StudentScope, text: string | null): Promise<void> {
  await raw.query(
    'update learner_profiles set last_summary = $1 where student_id = $2 and teacher_id = $3',
    [text, scope.studentId, scope.teacherId],
  );
}

async function kind(p: Promise<unknown>): Promise<string> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(RepositoryError);
  return (e as RepositoryError).kind;
}

describe.skipIf(!up)(`sessionsRepo.end on Postgres${up ? '' : ` (${SKIP_REASON})`}`, () => {
  beforeAll(async () => {
    await createDatabase(dbName);
    await migrateDatabase(TEST_URL);
    handle = createDb({ DATABASE_URL: TEST_URL });
    await seed(handle.db);
    repos = createRepositories(handle.db);
    raw = new pg.Client({ connectionString: TEST_URL });
    await raw.connect();
  }, 60_000);

  afterAll(async () => {
    await raw?.end();
    await handle?.close();
    await dropDatabase(dbName);
  }, 60_000);

  it('a summary writes sessions.summary and upserts learner_profiles.last_summary, in one transaction', async () => {
    const sid = await newSession();
    await setLastSummary(ONE_A, '[before] old summary');
    expect(
      await repos.sessions.end(ONE_A, sid, 'Covered fractions; pick up at decimals next.'),
    ).toEqual({
      ended: true,
    });
    const row = await repos.sessions.get(ONE_A, sid);
    expect(row?.endedAt).not.toBeNull();
    expect(row?.summary).toBe('Covered fractions; pick up at decimals next.');
    expect(await lastSummary()).toBe('Covered fractions; pick up at decimals next.');
  });

  it('a first-ever profile row (no prior learner_profiles row) still gets a readable lastSummary', async () => {
    const other: StudentScope = { studentId: studentId('2'), teacherId: teacherId('A') };
    const { id } = await repos.sessions.create(other, {
      agentId: ids.agent('A'),
      agentVersion: 1,
      packageId: ids.pkg('A'),
      packageVersion: 1,
    });
    expect(await repos.learnerProfiles.get(other)).not.toBeNull(); // seeded by isolation-seed
    await setLastSummary(other, null);
    expect(await repos.sessions.end(other, id, 'First session recap.')).toEqual({ ended: true });
    expect(await lastSummary(other)).toBe('First session recap.');
  });

  it('undefined writes sessions.summary = NULL and leaves an existing lastSummary untouched', async () => {
    const sid = await newSession();
    await setLastSummary(ONE_A, '[kept] earlier summary');
    expect(await repos.sessions.end(ONE_A, sid, undefined)).toEqual({ ended: true });
    const row = await repos.sessions.get(ONE_A, sid);
    expect(row?.endedAt).not.toBeNull();
    expect(row?.summary).toBeNull();
    expect(await lastSummary()).toBe('[kept] earlier summary');
  });

  it('a second end call on an already-ended session is a no-op, nothing rewritten', async () => {
    const sid = await newSession();
    await setLastSummary(ONE_A, '[kept] first summary');
    expect(await repos.sessions.end(ONE_A, sid, 'First end.')).toEqual({ ended: true });
    expect(await repos.sessions.end(ONE_A, sid, 'Second end, must be ignored.')).toEqual({
      ended: false,
    });
    const row = await repos.sessions.get(ONE_A, sid);
    expect(row?.summary).toBe('First end.');
    expect(await lastSummary()).toBe('First end.');
  });

  it('a stale call can never clobber a newer session’s summary (ended by another call since)', async () => {
    const sid = await newSession();
    // Simulate a concurrent endOnPackageChange-style end: close the row directly.
    await raw.query('update sessions set ended_at = now() where id = $1', [sid]);
    await setLastSummary(ONE_A, '[newer] summary set by a session since');
    expect(await repos.sessions.end(ONE_A, sid, 'Stale retry, must be ignored.')).toEqual({
      ended: false,
    });
    expect(await lastSummary()).toBe('[newer] summary set by a session since');
  });

  it('another student’s or teacher’s session is not_found and nothing is written', async () => {
    const sid = await newSession();
    const otherStudent: StudentScope = { studentId: studentId('2'), teacherId: teacherId('A') };
    const otherTeacher: StudentScope = { studentId: studentId('1'), teacherId: teacherId('B') };
    expect(await kind(repos.sessions.end(otherStudent, sid, 'nope'))).toBe('not_found');
    expect(await kind(repos.sessions.end(otherTeacher, sid, 'nope'))).toBe('not_found');
    expect(await kind(repos.sessions.end(ONE_A, 'ses_nowhere', 'nope'))).toBe('not_found');
    const row = await repos.sessions.get(ONE_A, sid);
    expect(row?.endedAt).toBeNull();
  });

  it('a summary over LIMITS.lastSummaryMaxWords is invalid, nothing written', async () => {
    const sid = await newSession();
    await setLastSummary(ONE_A, '[kept] summary before the oversized attempt');
    const tooLong = Array.from(
      { length: LIMITS.lastSummaryMaxWords + 1 },
      (_, i) => `word${i}`,
    ).join(' ');
    expect(await kind(repos.sessions.end(ONE_A, sid, tooLong))).toBe('invalid');
    const row = await repos.sessions.get(ONE_A, sid);
    expect(row?.endedAt).toBeNull();
    expect(row?.summary).toBeNull();
    expect(await lastSummary()).toBe('[kept] summary before the oversized attempt');
  });

  describe('attachSummary (task 6.4b)', () => {
    async function endedNoSummary(): Promise<string> {
      const sid = await newSession();
      expect(await repos.sessions.end(ONE_A, sid, undefined)).toEqual({ ended: true });
      return sid;
    }

    it('attaches once on an already-ended, summary-less session (profile upsert happens)', async () => {
      const sid = await endedNoSummary();
      await setLastSummary(ONE_A, '[before] old summary');
      expect(
        await repos.sessions.attachSummary(
          ONE_A,
          sid,
          'Covered fractions; pick up at decimals next.',
        ),
      ).toEqual({ attached: true });
      const row = await repos.sessions.get(ONE_A, sid);
      expect(row?.summary).toBe('Covered fractions; pick up at decimals next.');
      expect(await lastSummary()).toBe('Covered fractions; pick up at decimals next.');
    });

    it('a first-ever profile row (no prior learner_profiles row) still gets a readable lastSummary', async () => {
      const other: StudentScope = { studentId: studentId('2'), teacherId: teacherId('A') };
      const { id } = await repos.sessions.create(other, {
        agentId: ids.agent('A'),
        agentVersion: 1,
        packageId: ids.pkg('A'),
        packageVersion: 1,
      });
      expect(await repos.sessions.end(other, id, undefined)).toEqual({ ended: true });
      await setLastSummary(other, null);
      expect(await repos.sessions.attachSummary(other, id, 'First session recap.')).toEqual({
        attached: true,
      });
      expect(await lastSummary(other)).toBe('First session recap.');
    });

    it('a second call is a no-op: {attached:false}, stored summary unchanged', async () => {
      const sid = await endedNoSummary();
      await setLastSummary(ONE_A, '[kept] first summary');
      expect(await repos.sessions.attachSummary(ONE_A, sid, 'First attach.')).toEqual({
        attached: true,
      });
      expect(
        await repos.sessions.attachSummary(ONE_A, sid, 'Second attach, must be ignored.'),
      ).toEqual({ attached: false });
      const row = await repos.sessions.get(ONE_A, sid);
      expect(row?.summary).toBe('First attach.');
      expect(await lastSummary()).toBe('First attach.');
    });

    it('wrong scope or a missing session is not_found, nothing written', async () => {
      const sid = await endedNoSummary();
      const otherStudent: StudentScope = { studentId: studentId('2'), teacherId: teacherId('A') };
      const otherTeacher: StudentScope = { studentId: studentId('1'), teacherId: teacherId('B') };
      expect(await kind(repos.sessions.attachSummary(otherStudent, sid, 'nope'))).toBe('not_found');
      expect(await kind(repos.sessions.attachSummary(otherTeacher, sid, 'nope'))).toBe('not_found');
      expect(await kind(repos.sessions.attachSummary(ONE_A, 'ses_nowhere', 'nope'))).toBe(
        'not_found',
      );
      const row = await repos.sessions.get(ONE_A, sid);
      expect(row?.summary).toBeNull();
    });

    it('over LIMITS.lastSummaryMaxWords is invalid, nothing written', async () => {
      const sid = await endedNoSummary();
      const tooLong = Array.from(
        { length: LIMITS.lastSummaryMaxWords + 1 },
        (_, i) => `word${i}`,
      ).join(' ');
      expect(await kind(repos.sessions.attachSummary(ONE_A, sid, tooLong))).toBe('invalid');
      const row = await repos.sessions.get(ONE_A, sid);
      expect(row?.summary).toBeNull();
    });

    it('called on a session that is not ended yet is a no-op, {attached:false}', async () => {
      const sid = await newSession();
      expect(await repos.sessions.attachSummary(ONE_A, sid, 'too early')).toEqual({
        attached: false,
      });
      const row = await repos.sessions.get(ONE_A, sid);
      expect(row?.endedAt).toBeNull();
      expect(row?.summary).toBeNull();
    });
  });

  // Task 5.10d: at most one open session per (teacher, student, agent) — create() reuses an
  // existing open session for the triple instead of inserting a second one.
  describe('create() reuse on the open (teacher, student, agent) triple', () => {
    const input = {
      agentId: ids.agent('A'),
      agentVersion: 1,
      packageId: ids.pkg('A'),
      packageVersion: 1,
    };

    async function openRowsFor(scope: StudentScope, agentId = input.agentId): Promise<number> {
      const r = await raw.query(
        'select count(*) as n from sessions where teacher_id = $1 and student_id = $2 and agent_id = $3 and ended_at is null',
        [scope.teacherId, scope.studentId, agentId],
      );
      return Number(r.rows[0].n);
    }

    it('two concurrent create() calls for the same triple both resolve to the same session id and leave one open row', async () => {
      const scope: StudentScope = { studentId: studentId('1'), teacherId: teacherId('A') };
      const [a, b] = await Promise.all([
        repos.sessions.create(scope, input),
        repos.sessions.create(scope, input),
      ]);
      expect(a.id).toBe(b.id);
      expect(await openRowsFor(scope)).toBe(1);
    });

    it('a second, sequential create() call for the same triple returns the first id and leaves one open row', async () => {
      const scope: StudentScope = { studentId: studentId('2'), teacherId: teacherId('A') };
      const first = await repos.sessions.create(scope, input);
      const second = await repos.sessions.create(scope, input);
      expect(second.id).toBe(first.id);
      expect(await openRowsFor(scope)).toBe(1);
    });

    it('a bad agent/package/version combo is still not_found, not swallowed by the reuse fallback', async () => {
      const scope: StudentScope = { studentId: studentId('2'), teacherId: teacherId('B') };
      expect(
        await kind(
          repos.sessions.create(scope, {
            ...input,
            agentId: 'agt_nowhere',
          }),
        ),
      ).toBe('not_found');
      expect(await openRowsFor(scope)).toBe(0);
    });

    it('a bad agentVersion is not_found even while a real open session exists for the triple (not reused)', async () => {
      // The conflict target is (teacher, student, agent) only, not version-specific, so an
      // unrelated already-open session on the same triple must never make this call look like a
      // lost race.
      const scope: StudentScope = { studentId: studentId('1'), teacherId: teacherId('B') };
      const existing = await repos.sessions.create(scope, {
        agentId: ids.agent('B'),
        agentVersion: 1,
        packageId: ids.pkg('B'),
        packageVersion: 1,
      });
      expect(
        await kind(
          repos.sessions.create(scope, {
            agentId: ids.agent('B'),
            agentVersion: 99,
            packageId: ids.pkg('B'),
            packageVersion: 1,
          }),
        ),
      ).toBe('not_found');
      expect(await openRowsFor(scope, ids.agent('B'))).toBe(1);
      const row = await repos.sessions.get(scope, existing.id);
      expect(row?.endedAt).toBeNull();
    });
  });
});
