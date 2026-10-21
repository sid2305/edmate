// Task 5.10 Phase B on Postgres: correctionStoreFor / chunks.addTeacherNote writes one
// documents + chunk + teacher_eval_cases row and bumps the material revision, all in one
// transaction; another teacher's module and bad text write nothing; the note is found by full
// text only, under an allowed scope. See test/pg.ts for how to start one.
import { LIMITS } from '@edmate/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateDatabase } from '../src/migrate.js';
import { createDb, type DbHandle } from '../src/internal.js';
import {
  correctionStoreFor,
  createRepositories,
  type Repositories,
  RepositoryError,
  retrievalIndexFor,
} from '../src/index.js';
import { ids, seed, teacherId } from './isolation-seed.js';
import {
  createDatabase,
  dropDatabase,
  postgresUp,
  SKIP_REASON,
  throwawayName,
  urlFor,
} from './pg.js';

const up = await postgresUp('correction store tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
let handle: DbHandle;
let repos: Repositories;
let raw: pg.Client;

const own = { teacherId: teacherId('A') };
const moduleId = ids.module('A', 1);
const otherModuleId = ids.module('B', 1);

async function kind(p: Promise<unknown>): Promise<string> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(RepositoryError);
  return (e as RepositoryError).kind;
}

async function counts() {
  const [docs, chunks, cases] = await Promise.all([
    raw.query<{ n: string }>(`select count(*)::text as n from documents`),
    raw.query<{ n: string }>(`select count(*)::text as n from chunks`),
    raw.query<{ n: string }>(`select count(*)::text as n from teacher_eval_cases`),
  ]);
  return {
    documents: Number(docs.rows[0]?.n),
    chunks: Number(chunks.rows[0]?.n),
    cases: Number(cases.rows[0]?.n),
  };
}

async function revision(teacher: string): Promise<number> {
  const r = await raw.query<{ revision: string }>(
    `select revision::text as revision from teacher_material_revisions where teacher_id = $1`,
    [teacher],
  );
  return Number(r.rows[0]?.revision ?? 0);
}

describe.skipIf(!up)(`correctionStoreFor on Postgres${up ? '' : ` (${SKIP_REASON})`}`, () => {
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
    'writes one teacher_note document, chunk and eval case, and bumps the revision, in one transaction',
    async () => {
      const store = correctionStoreFor(repos, own);
      const before = await counts();
      const beforeRevision = await revision(own.teacherId);

      const res = await store.addTeacherNote({
        teacherId: own.teacherId,
        moduleId,
        question: 'CORRECTION-STORE-CANARY: why does the denominator matter?',
        answer: 'Because it tells you how many equal parts the whole is split into.',
        origin: 'teacher_answer',
      });

      expect(res.chunkId).toBeTruthy();
      expect(res.evalCaseId).toBeTruthy();

      const after = await counts();
      expect(after.documents).toBe(before.documents + 1);
      expect(after.chunks).toBe(before.chunks + 1);
      expect(after.cases).toBe(before.cases + 1);
      expect(await revision(own.teacherId)).toBe(beforeRevision + 1);

      const chunk = await raw.query<{
        teacher_id: string;
        module_id: string;
        kind: string;
        text: string;
        source_title: string;
      }>(
        `select teacher_id, module_id, kind, text, source_title from chunks where id = $1`,
        [res.chunkId],
      );
      expect(chunk.rows[0]).toMatchObject({
        teacher_id: own.teacherId,
        module_id: moduleId,
        kind: 'teacher_note',
        text:
          'Question: CORRECTION-STORE-CANARY: why does the denominator matter?\n' +
          'Answer: Because it tells you how many equal parts the whole is split into.',
        source_title: "Teacher's answer",
      });

      const evalCase = await raw.query<{
        teacher_id: string;
        module_id: string;
        origin: string;
        question: string;
        answer: string;
        chunk_id: string;
      }>(
        `select teacher_id, module_id, origin, question, answer, chunk_id
           from teacher_eval_cases where id = $1`,
        [res.evalCaseId],
      );
      expect(evalCase.rows[0]).toMatchObject({
        teacher_id: own.teacherId,
        module_id: moduleId,
        origin: 'teacher_answer',
        question: 'CORRECTION-STORE-CANARY: why does the denominator matter?',
        answer: 'Because it tells you how many equal parts the whole is split into.',
        chunk_id: res.chunkId,
      });
    },
    15_000,
  );

  it(
    'another teacher’s module is not_found and writes nothing',
    async () => {
      const store = correctionStoreFor(repos, own);
      const before = await counts();
      const beforeRevision = await revision(own.teacherId);
      expect(
        await kind(
          store.addTeacherNote({
            teacherId: own.teacherId,
            moduleId: otherModuleId,
            question: 'q',
            answer: 'a',
            origin: 'teacher_answer',
          }),
        ),
      ).toBe('not_found');
      expect(await counts()).toEqual(before);
      expect(await revision(own.teacherId)).toBe(beforeRevision);
    },
    15_000,
  );

  it(
    'a payload teacherId other than the bound one is scope, before any write',
    async () => {
      const store = correctionStoreFor(repos, own);
      const before = await counts();
      expect(
        await kind(
          store.addTeacherNote({
            teacherId: teacherId('B'),
            moduleId: otherModuleId,
            question: 'q',
            answer: 'a',
            origin: 'teacher_answer',
          }),
        ),
      ).toBe('scope');
      expect(await counts()).toEqual(before);
    },
    15_000,
  );

  it(
    'empty or over-cap text is invalid and writes nothing',
    async () => {
      const store = correctionStoreFor(repos, own);
      const before = await counts();
      expect(
        await kind(
          store.addTeacherNote({
            teacherId: own.teacherId,
            moduleId,
            question: '   ',
            answer: 'a',
            origin: 'teacher_answer',
          }),
        ),
      ).toBe('invalid');
      expect(
        await kind(
          store.addTeacherNote({
            teacherId: own.teacherId,
            moduleId,
            question: 'q',
            answer: 'x'.repeat(LIMITS.turnTextMaxLength + 1),
            origin: 'teacher_answer',
          }),
        ),
      ).toBe('invalid');
      expect(await counts()).toEqual(before);
    },
    15_000,
  );

  it(
    'the note is found by full text first, only under a scope that allows its module',
    async () => {
      const store = correctionStoreFor(repos, own);
      const res = await store.addTeacherNote({
        teacherId: own.teacherId,
        moduleId,
        question: 'RETRIEVAL-NOTE-CANARY: why is the sky blue at noon?',
        answer: 'Because shorter wavelengths scatter more.',
        origin: 'teacher_answer',
      });

      const index = retrievalIndexFor(repos);
      const allowed = await index.search(
        'RETRIEVAL-NOTE-CANARY why is the sky blue',
        { teacherId: own.teacherId, allowedModuleIds: [moduleId] },
        10,
      );
      expect(allowed[0]?.id).toBe(res.chunkId);
      expect(allowed[0]?.kind).toBe('teacher_note');

      const outside = await index.search(
        'RETRIEVAL-NOTE-CANARY why is the sky blue',
        { teacherId: own.teacherId, allowedModuleIds: [ids.module('A', 2)] },
        10,
      );
      expect(outside.map((c) => c.id)).not.toContain(res.chunkId);
    },
    15_000,
  );
});
