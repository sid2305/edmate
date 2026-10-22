// Task 7.4 Phase B on Postgres: teacherEvalCases.listForTeacher returns only the scope's own
// teacher_eval_cases rows, ordered (created_at, id), and throws rather than truncating past
// TEACHER_EVAL_CASES_MAX (a cut suite would be a silent gate pass). See test/pg.ts for how to
// start a database; skipped locally without one, fails in CI.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateDatabase } from '../src/migrate.js';
import { createDb, type DbHandle } from '../src/internal.js';
import {
  createRepositories,
  type Repositories,
  RepositoryError,
  TEACHER_EVAL_CASES_MAX,
  type TeacherEvalCaseRow,
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

const up = await postgresUp('teacher eval cases tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
let handle: DbHandle;
let repos: Repositories;
let raw: pg.Client;

const A = { teacherId: teacherId('A') };
const B = { teacherId: teacherId('B') };

async function failure(p: Promise<unknown>): Promise<RepositoryError> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(RepositoryError);
  return e as RepositoryError;
}

/** Inserts one row with an explicit created_at (parameterised). */
async function insertCase(
  row: { id: string; teacher: 'A' | 'B'; question: string; at: string },
  origin: 'teacher_answer' | 'correction' = 'teacher_answer',
) {
  await raw.query(
    `insert into teacher_eval_cases
       (id, teacher_id, module_id, origin, question, answer, chunk_id, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
    [
      row.id,
      teacherId(row.teacher),
      ids.module(row.teacher, 1),
      origin,
      row.question,
      `[${row.teacher}] answer to ${row.id}`,
      `chk_${row.id}`,
      row.at,
    ],
  );
}

describe.skipIf(!up)(`teacherEvalCases.listForTeacher on Postgres${up ? '' : ` (${SKIP_REASON})`}`, () => {
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

  it('a teacher with no rows gets an empty list', async () => {
    expect(await repos.teacherEvalCases.listForTeacher(A)).toEqual([]);
    expect(await repos.teacherEvalCases.listForTeacher({ teacherId: 'tch_nobody' })).toEqual([]);
  });

  it(
    "returns only the scope's own rows, ordered by (created_at, id); never another teacher's",
    async () => {
      // Same timestamp for tec_a2 / tec_a3 so the id tie-break is exercised; tec_a1 is newest.
      await insertCase({ id: 'tec_a1', teacher: 'A', question: '[A] q1', at: '2026-10-03T00:00:00Z' });
      await insertCase(
        { id: 'tec_a3', teacher: 'A', question: '[A] q3', at: '2026-10-01T00:00:00Z' },
        'correction',
      );
      await insertCase({ id: 'tec_a2', teacher: 'A', question: '[A] q2', at: '2026-10-01T00:00:00Z' });
      await insertCase({ id: 'tec_b1', teacher: 'B', question: '[B] q1', at: '2026-09-30T00:00:00Z' });

      const a = await repos.teacherEvalCases.listForTeacher(A);
      expect(a).toEqual<TeacherEvalCaseRow[]>([
        {
          id: 'tec_a2',
          moduleId: ids.module('A', 1),
          question: '[A] q2',
          answer: '[A] answer to tec_a2',
          origin: 'teacher_answer',
        },
        {
          id: 'tec_a3',
          moduleId: ids.module('A', 1),
          question: '[A] q3',
          answer: '[A] answer to tec_a3',
          origin: 'correction',
        },
        {
          id: 'tec_a1',
          moduleId: ids.module('A', 1),
          question: '[A] q1',
          answer: '[A] answer to tec_a1',
          origin: 'teacher_answer',
        },
      ]);
      // No teacher id or other column leaks into the row shape.
      expect(Object.keys(a[0]!).sort()).toEqual(['answer', 'id', 'moduleId', 'origin', 'question']);

      const b = await repos.teacherEvalCases.listForTeacher(B);
      expect(b.map((r) => r.id)).toEqual(['tec_b1']);
      expect(JSON.stringify(b)).not.toContain('[A]');
      expect(JSON.stringify(a)).not.toContain('[B]');

      // A well-formed id that matches nobody, and a SQL-looking one, see nothing.
      expect(await repos.teacherEvalCases.listForTeacher({ teacherId: 'tch_a_' })).toEqual([]);
      expect(await repos.teacherEvalCases.listForTeacher({ teacherId: 'tch_a-OR-1' })).toEqual([]);
    },
    15_000,
  );

  it('a missing or malformed scope is `scope`, before any SQL', async () => {
    for (const bad of [
      undefined,
      null,
      {},
      { teacherId: '' },
      { teacherId: "tch_a' or '1'='1" },
      { teacherId: 'tch_a', extra: 1 },
    ]) {
      const e = await failure(repos.teacherEvalCases.listForTeacher(bad as never));
      expect(e.kind, JSON.stringify(bad)).toBe('scope');
      expect(e.message).toBe('teacherEvalCases.listForTeacher: scope');
    }
  });

  it(
    'exactly TEACHER_EVAL_CASES_MAX rows are returned; one more is `invalid`, never a truncated list',
    async () => {
      expect(TEACHER_EVAL_CASES_MAX).toBe(10_000);
      // Teacher B already has one row (tec_b1); top up to exactly the cap in one statement.
      await raw.query(
        `insert into teacher_eval_cases
           (id, teacher_id, module_id, origin, question, answer, chunk_id)
         select 'tec_bulk_' || g, $1, $2, 'teacher_answer', '[B] bulk q', '[B] bulk a', 'chk_bulk_' || g
           from generate_series(1, $3::int - 1) as g`,
        [teacherId('B'), ids.module('B', 1), TEACHER_EVAL_CASES_MAX],
      );
      const atCap = await repos.teacherEvalCases.listForTeacher(B);
      expect(atCap).toHaveLength(TEACHER_EVAL_CASES_MAX);
      expect(atCap.every((r) => r.question.startsWith('[B]'))).toBe(true);

      await insertCase({ id: 'tec_b_over', teacher: 'B', question: '[B] over', at: '2026-10-05T00:00:00Z' });
      const e = await failure(repos.teacherEvalCases.listForTeacher(B));
      expect(e.kind).toBe('invalid');
      expect(e.message).toBe('teacherEvalCases.listForTeacher: invalid');

      // Teacher A is unaffected by B's volume.
      expect((await repos.teacherEvalCases.listForTeacher(A)).map((r) => r.id)).toEqual([
        'tec_a2',
        'tec_a3',
        'tec_a1',
      ]);
    },
    60_000,
  );
});
