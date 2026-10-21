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
    expect(await repos.sessions.end(ONE_A, sid, 'Covered fractions; pick up at decimals next.')).toEqual({
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
    const tooLong = Array.from({ length: LIMITS.lastSummaryMaxWords + 1 }, (_, i) => `word${i}`).join(
      ' ',
    );
    expect(await kind(repos.sessions.end(ONE_A, sid, tooLong))).toBe('invalid');
    const row = await repos.sessions.get(ONE_A, sid);
    expect(row?.endedAt).toBeNull();
    expect(row?.summary).toBeNull();
    expect(await lastSummary()).toBe('[kept] summary before the oversized attempt');
  });
});
