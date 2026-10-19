// Task 3.17 on Postgres: teacherQuestionStoreFor's `open` is idempotent for identical (student,
// teacher, agent, text) — including two concurrent opens (the 3.7/3.17 race) — `findSimilar`'s
// scoping, and scope isolation on `open`'s payload. See test/pg.ts for how to start one.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateDatabase } from '../src/migrate.js';
import { createDb, type DbHandle } from '../src/internal.js';
import {
  createRepositories,
  type Repositories,
  RepositoryError,
  teacherQuestionStoreFor,
} from '../src/index.js';
import { agentConfig, seed, studentId, teacherId } from './isolation-seed.js';
import {
  createDatabase,
  dropDatabase,
  postgresUp,
  SKIP_REASON,
  throwawayName,
  urlFor,
} from './pg.js';

const up = await postgresUp('teacher question store tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
let handle: DbHandle;
let repos: Repositories;
let raw: pg.Client;

const own = { studentId: studentId('1'), teacherId: teacherId('A') };
const agentId = agentConfig('A').id;

async function kind(p: Promise<unknown>): Promise<string> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(RepositoryError);
  return (e as RepositoryError).kind;
}

describe.skipIf(!up)(`teacherQuestionStoreFor on Postgres${up ? '' : ` (${SKIP_REASON})`}`, () => {
  beforeAll(async () => {
    await createDatabase(dbName);
    await migrateDatabase(TEST_URL);
    handle = createDb({ DATABASE_URL: TEST_URL });
    await seed(handle.db);
    repos = createRepositories(handle.db);
    raw = new pg.Client({ connectionString: TEST_URL });
    await raw.connect();
  }, 30_000);

  afterAll(async () => {
    await raw?.end();
    await handle?.close();
    await dropDatabase(dbName);
  }, 30_000);

  it(
    'findSimilar always returns [] today (no embeddings search yet); still scoped to the bound teacher',
    async () => {
      const store = teacherQuestionStoreFor(repos, own);
      expect(await store.findSimilar(own.teacherId, 'Why?')).toEqual([]);
      expect(await kind(store.findSimilar('tch_other', 'Why?'))).toBe('scope');
    },
    15_000,
  );

  it(
    'open is idempotent for identical (student, teacher, agent, text): a second call returns the first row',
    async () => {
      const store = teacherQuestionStoreFor(repos, own);
      const text = 'TQSTORE-DEDUP-CANARY: why does the denominator matter?';
      const a = await store.open({
        teacherId: own.teacherId,
        agentId,
        studentId: own.studentId,
        text,
        similarIds: [],
      });
      const b = await store.open({
        teacherId: own.teacherId,
        agentId,
        studentId: own.studentId,
        text,
        similarIds: [],
      });
      expect(b.id).toBe(a.id);
      const n = await raw.query<{ n: string }>(
        `select count(*)::text as n from teacher_questions where text = $1 and status = 'open'`,
        [text],
      );
      expect(n.rows[0]?.n).toBe('1');
    },
    15_000,
  );

  it(
    'two concurrent opens of the same question converge on one row (the live attempt / commit fallback race)',
    async () => {
      const store = teacherQuestionStoreFor(repos, own);
      const text = 'TQSTORE-RACE-CANARY: why does this work?';
      const input = { teacherId: own.teacherId, agentId, studentId: own.studentId, text, similarIds: [] };
      const [a, b] = await Promise.all([store.open(input), store.open(input)]);
      expect(a.id).toBe(b.id);
      const n = await raw.query<{ n: string }>(
        `select count(*)::text as n from teacher_questions where text = $1`,
        [text],
      );
      expect(n.rows[0]?.n).toBe('1');
    },
    15_000,
  );

  it(
    'a different student, teacher, agent or text is not the same open question',
    async () => {
      const store = teacherQuestionStoreFor(repos, own);
      const other = { studentId: studentId('2'), teacherId: teacherId('A') };
      const base = { teacherId: own.teacherId, agentId, studentId: own.studentId, similarIds: [] };
      const q1 = await store.open({ ...base, text: 'TQSTORE-VARY-A' });
      const q2 = await store.open({ ...base, text: 'TQSTORE-VARY-B' });
      expect(q2.id).not.toBe(q1.id);
      const q3 = await teacherQuestionStoreFor(repos, other).open({
        ...base,
        studentId: other.studentId,
        text: 'TQSTORE-VARY-A',
      });
      expect(q3.id).not.toBe(q1.id);
    },
    15_000,
  );

  it(
    'open carries moduleHint through when given',
    async () => {
      const store = teacherQuestionStoreFor(repos, own);
      const q = await store.open({
        teacherId: own.teacherId,
        agentId,
        studentId: own.studentId,
        text: 'TQSTORE-MODULE-HINT-CANARY',
        moduleHint: 'mod_a1',
        similarIds: [],
      });
      expect(q.moduleHint).toBe('mod_a1');
    },
    15_000,
  );

  it(
    'open rejects a payload naming another pair, or an agent that is not the bound teacher’s',
    async () => {
      const store = teacherQuestionStoreFor(repos, own);
      const base = { teacherId: own.teacherId, agentId, studentId: own.studentId, similarIds: [] };
      expect(
        await kind(store.open({ ...base, teacherId: 'tch_other', text: 'x' })),
      ).toBe('scope');
      expect(
        await kind(store.open({ ...base, studentId: 'stu_other', text: 'x' })),
      ).toBe('scope');
      expect(
        await kind(store.open({ ...base, agentId: agentConfig('B').id, text: 'x' })),
      ).toBe('not_found');
    },
    15_000,
  );
});
