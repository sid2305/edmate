// Task 8.5 Phase A on Postgres: `corrections.record` writes one `corrections` row and one teacher
// note (documents + chunk + `teacher_eval_cases` with origin 'correction') in one transaction, and
// the note is what the next similar question finds first. Also the teacher-side reads the test
// chat needs: `agentVersions.latest` and `packageVersions.listForAgent`. See test/pg.ts for how
// to start a Postgres.
import { LIMITS } from '@edmate/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateDatabase } from '../src/migrate.js';
import { createDb, type DbHandle } from '../src/internal.js';
import {
  createRepositories,
  type Repositories,
  RepositoryError,
  retrievalIndexFor,
} from '../src/index.js';
import * as s from '../src/schema/index.js';
import { agentConfig, ids, packageConfig, seed, teacherId } from './isolation-seed.js';
import {
  createDatabase,
  dropDatabase,
  postgresUp,
  SKIP_REASON,
  throwawayName,
  urlFor,
} from './pg.js';

const up = await postgresUp('corrections tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
let handle: DbHandle;
let repos: Repositories;
let raw: pg.Client;

const own = { teacherId: teacherId('A') };
const moduleId = ids.module('A', 1);
const otherModuleId = ids.module('B', 1);

const valid = {
  moduleId,
  question: 'CORRECTION-CANARY: how many halves make a whole?',
  badAnswer: 'Three halves make a whole.',
  correctedAnswer: 'Two halves make a whole: each half is one of two equal parts.',
};

async function kind(p: Promise<unknown>): Promise<string> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(RepositoryError);
  return (e as RepositoryError).kind;
}

const TABLES = ['corrections', 'documents', 'chunks', 'teacher_eval_cases'] as const;

async function counts(): Promise<Record<(typeof TABLES)[number], number>> {
  const out = {} as Record<(typeof TABLES)[number], number>;
  for (const t of TABLES) {
    const r = await raw.query<{ n: string }>(`select count(*)::text as n from ${t}`);
    out[t] = Number(r.rows[0]?.n);
  }
  return out;
}

describe.skipIf(!up)(`corrections repository on Postgres${up ? '' : ` (${SKIP_REASON})`}`, () => {
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

  describe('corrections.record', () => {
    it('writes a corrections row, a correction eval case and a teacher note the next similar question finds first', async () => {
      const before = await counts();
      const res = await repos.corrections.record(own, valid);
      expect(res.correctionId).toBeTruthy();
      expect(res.chunkId).toBeTruthy();
      expect(res.evalCaseId).toBeTruthy();

      const after = await counts();
      expect(after).toEqual({
        corrections: before.corrections + 1,
        documents: before.documents + 1,
        chunks: before.chunks + 1,
        teacher_eval_cases: before.teacher_eval_cases + 1,
      });

      // (1) the corrections row keeps the bad answer.
      const row = await raw.query(
        `select teacher_id, module_id, question, bad_answer, corrected_answer
             from corrections where id = $1`,
        [res.correctionId],
      );
      expect(row.rows[0]).toEqual({
        teacher_id: own.teacherId,
        module_id: moduleId,
        question: valid.question,
        bad_answer: valid.badAnswer,
        corrected_answer: valid.correctedAnswer,
      });

      // (2) the eval case is a 'correction' with the corrected answer.
      const evalCase = await raw.query(
        `select teacher_id, module_id, origin, question, answer, chunk_id
             from teacher_eval_cases where id = $1`,
        [res.evalCaseId],
      );
      expect(evalCase.rows[0]).toEqual({
        teacher_id: own.teacherId,
        module_id: moduleId,
        origin: 'correction',
        question: valid.question,
        answer: valid.correctedAnswer,
        chunk_id: res.chunkId,
      });

      // (3) a close variant of the question returns the new note, ranked first.
      const found = await retrievalIndexFor(repos).search(
        'CORRECTION-CANARY how many halves make one whole',
        { teacherId: own.teacherId, allowedModuleIds: [moduleId] },
        10,
      );
      expect(found[0]?.id).toBe(res.chunkId);
      expect(found[0]?.kind).toBe('teacher_note');
      expect(found[0]?.text).toContain(valid.correctedAnswer);
      expect(found[0]?.text).not.toContain(valid.badAnswer);
    }, 15_000);

    it('trims the stored text the same way the teacher note does', async () => {
      const res = await repos.corrections.record(own, {
        moduleId,
        question: '  TRIM-CANARY: q  ',
        badAnswer: '  bad  ',
        correctedAnswer: '  good  ',
      });
      const row = await raw.query(
        `select question, bad_answer, corrected_answer from corrections where id = $1`,
        [res.correctionId],
      );
      expect(row.rows[0]).toEqual({
        question: 'TRIM-CANARY: q',
        bad_answer: 'bad',
        corrected_answer: 'good',
      });
    }, 15_000);

    it('a missing module and another teacher’s module are not_found and write nothing', async () => {
      const before = await counts();
      expect(await kind(repos.corrections.record(own, { ...valid, moduleId: 'mod_ghost' }))).toBe(
        'not_found',
      );
      expect(await kind(repos.corrections.record(own, { ...valid, moduleId: otherModuleId }))).toBe(
        'not_found',
      );
      expect(await counts()).toEqual(before);
    }, 15_000);

    it('a bad scope is scope, before any write', async () => {
      const before = await counts();
      expect(await kind(repos.corrections.record({ teacherId: '' } as never, valid))).toBe('scope');
      expect(
        await kind(
          repos.corrections.record({ teacherId: own.teacherId, extra: 1 } as never, valid),
        ),
      ).toBe('scope');
      expect(await counts()).toEqual(before);
    }, 15_000);

    it('empty or over-cap text, or an unknown field, is invalid and writes nothing', async () => {
      const before = await counts();
      const over = 'x'.repeat(LIMITS.turnTextMaxLength + 1);
      for (const bad of [
        { ...valid, question: '   ' },
        { ...valid, badAnswer: '' },
        { ...valid, badAnswer: ' \n ' },
        { ...valid, correctedAnswer: '   ' },
        { ...valid, question: over },
        { ...valid, badAnswer: over },
        { ...valid, correctedAnswer: over },
        { ...valid, origin: 'teacher_answer' },
        { ...valid, badAnswer: 42 },
      ]) {
        expect(
          await kind(repos.corrections.record(own, bad as never)),
          JSON.stringify(bad).slice(0, 80),
        ).toBe('invalid');
      }
      // Exactly at the cap is fine (code points, the teacher-note rule).
      const res = await repos.corrections.record(own, {
        ...valid,
        badAnswer: '😀'.repeat(LIMITS.turnTextMaxLength),
      });
      expect(res.correctionId).toBeTruthy();
      const after = await counts();
      expect(after.corrections).toBe(before.corrections + 1);
    }, 15_000);
  });

  describe('agentVersions.latest', () => {
    it('returns the newest version of the scope’s own agent, any status', async () => {
      const tid = own.teacherId;
      await handle.db.insert(s.agents).values({ id: 'agt_draft', teacherId: tid, status: 'draft' });
      expect(await repos.agentVersions.latest(own, 'agt_draft')).toBeNull();
      for (const version of [1, 3, 2]) {
        await handle.db.insert(s.agentVersions).values({
          id: `av_draft_${version}`,
          teacherId: tid,
          agentId: 'agt_draft',
          version,
          config: { ...agentConfig('A'), id: 'agt_draft', version },
        });
      }
      const got = await repos.agentVersions.latest(own, 'agt_draft');
      expect(got?.version).toBe(3);
      expect(got?.config.id).toBe('agt_draft');
      expect(got?.config.version).toBe(3);
      expect(got?.config.teacherId).toBe(tid);
    }, 15_000);

    it('another teacher’s or a missing agent is null; a bad scope or id is rejected before SQL', async () => {
      expect(await repos.agentVersions.latest(own, ids.agent('B'))).toBeNull();
      expect(await repos.agentVersions.latest(own, 'agt_ghost')).toBeNull();
      expect(
        await kind(repos.agentVersions.latest({ teacherId: '' } as never, ids.agent('A'))),
      ).toBe('scope');
      expect(await kind(repos.agentVersions.latest(own, '' as never))).toBe('invalid');
    }, 15_000);
  });

  describe('packageVersions.listForAgent', () => {
    it('lists the scope’s own packages for the agent that have a version, newest first', async () => {
      const tid = own.teacherId;
      const agentId = ids.agent('A');
      // A package with no version yet is not previewable: left out.
      await handle.db
        .insert(s.packages)
        .values({ id: 'pkg_a_empty', teacherId: tid, agentId, name: '[A] empty' });
      await handle.db.insert(s.packages).values({
        id: 'pkg_a_new',
        teacherId: tid,
        agentId,
        name: '[A] newer',
        createdAt: new Date(Date.now() + 60_000),
      });
      for (const version of [1, 2]) {
        await handle.db.insert(s.packageVersions).values({
          id: `pv_a_new_${version}`,
          teacherId: tid,
          packageId: 'pkg_a_new',
          version,
          config: { ...packageConfig('A'), id: 'pkg_a_new', version },
        });
      }
      const got = await repos.packageVersions.listForAgent(own, agentId);
      expect(got).toEqual([
        { packageId: 'pkg_a_new', name: '[A] newer' },
        { packageId: ids.pkg('A'), name: '[A] package' },
      ]);
    }, 15_000);

    it('another teacher’s or a missing agent is []; a bad scope or id is rejected before SQL', async () => {
      expect(await repos.packageVersions.listForAgent(own, ids.agent('B'))).toEqual([]);
      expect(await repos.packageVersions.listForAgent(own, 'agt_ghost')).toEqual([]);
      expect(
        await kind(repos.packageVersions.listForAgent({ teacherId: '' } as never, ids.agent('A'))),
      ).toBe('scope');
      expect(await kind(repos.packageVersions.listForAgent(own, '' as never))).toBe('invalid');
    }, 15_000);
  });
});
