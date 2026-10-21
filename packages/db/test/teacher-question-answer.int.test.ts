// Task 5.10 Phase C on Postgres: grouping inside `teacherQuestions.open`, `listGroupsForTeacher`,
// `answer` (one transaction: note, status, thread messages, notifications), and the
// `notifications` repo. See test/pg.ts for how to start one. Synthetic text only.
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
import { agentConfig, ids, seed, studentId, teacherId } from './isolation-seed.js';
import {
  createDatabase,
  dropDatabase,
  postgresUp,
  SKIP_REASON,
  throwawayName,
  urlFor,
} from './pg.js';

const up = await postgresUp('teacher question answer tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
let handle: DbHandle;
let repos: Repositories;
let raw: pg.Client;

const tA = teacherId('A');
const agentA = agentConfig('A').id;
const moduleA = ids.module('A', 1);
const stu1 = studentId('1');
const stu2 = studentId('2');

async function kind(p: Promise<unknown>): Promise<string> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(RepositoryError);
  return (e as RepositoryError).kind;
}

async function groupOf(questionId: string): Promise<string | null> {
  const res = await raw.query<{ group_id: string | null }>(
    'select group_id from teacher_questions where id = $1',
    [questionId],
  );
  return res.rows[0]?.group_id ?? null;
}

async function statusOf(questionId: string): Promise<string> {
  const res = await raw.query<{ status: string }>(
    'select status from teacher_questions where id = $1',
    [questionId],
  );
  return res.rows[0]!.status;
}

let counter = 0;
const uid = (prefix: string) => `${prefix}_${(counter += 1)}`;

describe.skipIf(!up)(`teacherQuestions grouping and answer on Postgres${up ? '' : ` (${SKIP_REASON})`}`, () => {
  beforeAll(async () => {
    await createDatabase(dbName);
    await migrateDatabase(TEST_URL);
    handle = createDb({ DATABASE_URL: TEST_URL });
    await seed(handle.db);
    repos = createRepositories(handle.db);
    raw = new pg.Client({ connectionString: TEST_URL });
    await raw.connect();
    // A second agent of teacher A, for the "never groups across agents" case.
    await raw.query(`insert into agents (id, teacher_id) values ('agt_a2', $1)`, [tA]);
  }, 30_000);

  afterAll(async () => {
    await raw?.end();
    await handle?.close();
    await dropDatabase(dbName);
  }, 30_000);

  it(
    'two students asking similarly worded questions of the same teacher and agent land in one group',
    async () => {
      const store1 = teacherQuestionStoreFor(repos, { studentId: stu1, teacherId: tA });
      const store2 = teacherQuestionStoreFor(repos, { studentId: stu2, teacherId: tA });
      const q1 = await store1.open({
        teacherId: tA,
        agentId: agentA,
        studentId: stu1,
        text: 'GROUP-CANARY-A: why does the denominator flip when dividing fractions?',
        similarIds: [],
      });
      const q2 = await store2.open({
        teacherId: tA,
        agentId: agentA,
        studentId: stu2,
        text: 'GROUP-CANARY-A: why does the denominator flip when you divide a fraction?',
        similarIds: [],
      });
      const [g1, g2] = await Promise.all([groupOf(q1.id), groupOf(q2.id)]);
      expect(g1).not.toBeNull();
      expect(g1).toBe(g2);
    },
    15_000,
  );

  it('a differently worded question from the same pair does not join that group', async () => {
    const store1 = teacherQuestionStoreFor(repos, { studentId: stu1, teacherId: tA });
    const q1 = await store1.open({
      teacherId: tA,
      agentId: agentA,
      studentId: stu1,
      text: 'GROUP-CANARY-B: why does the denominator flip when dividing fractions in general?',
      similarIds: [],
    });
    const q3 = await store1.open({
      teacherId: tA,
      agentId: agentA,
      studentId: stu1,
      text: 'GROUP-CANARY-B: what time does class start on Tuesdays?',
      similarIds: [],
    });
    const [g1, g3] = await Promise.all([groupOf(q1.id), groupOf(q3.id)]);
    expect(g3).not.toBe(g1);
  });

  it('another teacher never groups with this one, even with identical wording', async () => {
    const storeA = teacherQuestionStoreFor(repos, { studentId: stu1, teacherId: tA });
    const storeB = teacherQuestionStoreFor(repos, { studentId: stu1, teacherId: teacherId('B') });
    const text = 'GROUP-CANARY-C: why is my code throwing a null pointer error here?';
    const qa = await storeA.open({
      teacherId: tA,
      agentId: agentA,
      studentId: stu1,
      text,
      similarIds: [],
    });
    const qb = await storeB.open({
      teacherId: teacherId('B'),
      agentId: agentConfig('B').id,
      studentId: stu1,
      text,
      similarIds: [],
    });
    const [ga, gb] = await Promise.all([groupOf(qa.id), groupOf(qb.id)]);
    expect(ga).not.toBe(gb);
  });

  it("another of this teacher's agents never groups with this one, even with identical wording", async () => {
    const store1 = teacherQuestionStoreFor(repos, { studentId: stu1, teacherId: tA });
    const text = 'GROUP-CANARY-D: how does photosynthesis work in a leaf?';
    const q1 = await store1.open({
      teacherId: tA,
      agentId: agentA,
      studentId: stu1,
      text,
      similarIds: [],
    });
    const q2 = await store1.open({
      teacherId: tA,
      agentId: 'agt_a2',
      studentId: stu1,
      text,
      similarIds: [],
    });
    const [g1, g2] = await Promise.all([groupOf(q1.id), groupOf(q2.id)]);
    expect(g1).not.toBe(g2);
  });

  it('two concurrent similar opens converge on one group (not a race)', async () => {
    const store1 = teacherQuestionStoreFor(repos, { studentId: stu1, teacherId: tA });
    const store2 = teacherQuestionStoreFor(repos, { studentId: stu2, teacherId: tA });
    const [q1, q2] = await Promise.all([
      store1.open({
        teacherId: tA,
        agentId: agentA,
        studentId: stu1,
        text: 'GROUP-CANARY-E: can you explain how Newton third law of motion works?',
        similarIds: [],
      }),
      store2.open({
        teacherId: tA,
        agentId: agentA,
        studentId: stu2,
        text: "GROUP-CANARY-E: please explain Newton's third law of motion",
        similarIds: [],
      }),
    ]);
    const [g1, g2] = await Promise.all([groupOf(q1.id), groupOf(q2.id)]);
    expect(g1).not.toBeNull();
    expect(g1).toBe(g2);
  });

  it('the 0011 open-dedup index still converges an identical replay onto the first row', async () => {
    const store1 = teacherQuestionStoreFor(repos, { studentId: stu1, teacherId: tA });
    const text = 'GROUP-CANARY-F: why does this recursive function never terminate?';
    const a = await store1.open({
      teacherId: tA,
      agentId: agentA,
      studentId: stu1,
      text,
      similarIds: [],
    });
    const b = await store1.open({
      teacherId: tA,
      agentId: agentA,
      studentId: stu1,
      text,
      similarIds: [],
    });
    expect(b.id).toBe(a.id);
  });

  describe('answer', () => {
    it('answers every open member of a group, writes one message and one notification per distinct student, and no student id leaves', async () => {
      const store1 = teacherQuestionStoreFor(repos, { studentId: stu1, teacherId: tA });
      const store2 = teacherQuestionStoreFor(repos, { studentId: stu2, teacherId: tA });
      const q1 = await store1.open({
        teacherId: tA,
        agentId: agentA,
        studentId: stu1,
        text: 'ANSWER-CANARY-A: why is the sky blue at noon on a clear day?',
        similarIds: [],
      });
      const q2 = await store2.open({
        teacherId: tA,
        agentId: agentA,
        studentId: stu2,
        text: 'ANSWER-CANARY-A: why does the sky look so blue at noon?',
        similarIds: [],
      });
      // stu1 ('1A') has an open seeded session; stu2 ('2A') has no open session for this teacher.
      await raw.query(`update sessions set ended_at = now() where id = $1`, [ids.session('2A')]);

      const before = await raw.query<{ n: string }>('select count(*)::text as n from messages');
      const result = await repos.teacherQuestions.answer(
        { teacherId: tA },
        {
          questionId: q1.id,
          moduleId: moduleA,
          answer: 'ANSWER-CANARY-A: the sky scatters blue light more than red light.',
        },
      );
      expect(Object.keys(result).sort()).toEqual(
        ['answered', 'evalCaseId', 'noteChunkId', 'students', 'threadMessages'].sort(),
      );
      expect(JSON.stringify(result)).not.toMatch(/stu_/);
      expect(result.answered).toBe(2);
      expect(result.students).toBe(2);
      expect(result.threadMessages).toBe(1); // only stu1 has an open session
      expect(await statusOf(q1.id)).toBe('answered');
      expect(await statusOf(q2.id)).toBe('answered');

      const after = await raw.query<{ n: string }>('select count(*)::text as n from messages');
      expect(Number(after.rows[0]!.n) - Number(before.rows[0]!.n)).toBe(1);

      const notes1 = await repos.notifications.listForStudent(
        { studentId: stu1, teacherId: tA },
        { unreadOnly: false, limit: 50 },
      );
      const notes2 = await repos.notifications.listForStudent(
        { studentId: stu2, teacherId: tA },
        { unreadOnly: false, limit: 50 },
      );
      expect(notes1.some((n) => n.questionId === q1.id)).toBe(true);
      expect(notes2.some((n) => n.questionId === q2.id)).toBe(true);
      // stu2's notification is written even though no message was delivered.
      expect(notes2.find((n) => n.questionId === q2.id)?.answer).toMatch(/scatters blue light/);
    });

    it('a replay of an already-answered question is not_found and writes nothing new', async () => {
      const store1 = teacherQuestionStoreFor(repos, { studentId: stu1, teacherId: tA });
      const q = await store1.open({
        teacherId: tA,
        agentId: agentA,
        studentId: stu1,
        text: `ANSWER-CANARY-REPLAY-${uid('q')}: what is the boiling point of water at sea level?`,
        similarIds: [],
      });
      await repos.teacherQuestions.answer(
        { teacherId: tA },
        { questionId: q.id, moduleId: moduleA, answer: 'It is 100 degrees Celsius.' },
      );
      const before = await raw.query<{ n: string }>(
        'select count(*)::text as n from teacher_eval_cases',
      );
      expect(
        await kind(
          repos.teacherQuestions.answer(
            { teacherId: tA },
            { questionId: q.id, moduleId: moduleA, answer: 'again' },
          ),
        ),
      ).toBe('not_found');
      const after = await raw.query<{ n: string }>(
        'select count(*)::text as n from teacher_eval_cases',
      );
      expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
    });

    it("another teacher's question, or a dismissed one, is not_found", async () => {
      const storeB = teacherQuestionStoreFor(repos, { studentId: stu1, teacherId: teacherId('B') });
      const qb = await storeB.open({
        teacherId: teacherId('B'),
        agentId: agentConfig('B').id,
        studentId: stu1,
        text: `ANSWER-CANARY-OTHER-${uid('q')}: why does ice float on water?`,
        similarIds: [],
      });
      expect(
        await kind(
          repos.teacherQuestions.answer(
            { teacherId: tA },
            { questionId: qb.id, moduleId: moduleA, answer: 'x' },
          ),
        ),
      ).toBe('not_found');

      const store1 = teacherQuestionStoreFor(repos, { studentId: stu1, teacherId: tA });
      const qd = await store1.open({
        teacherId: tA,
        agentId: agentA,
        studentId: stu1,
        text: `ANSWER-CANARY-DISMISSED-${uid('q')}: why does a metal spoon feel colder than a wooden one?`,
        similarIds: [],
      });
      await raw.query(`update teacher_questions set status = 'dismissed' where id = $1`, [qd.id]);
      expect(
        await kind(
          repos.teacherQuestions.answer(
            { teacherId: tA },
            { questionId: qd.id, moduleId: moduleA, answer: 'x' },
          ),
        ),
      ).toBe('not_found');
    });
  });

  describe('listGroupsForTeacher', () => {
    it('groups the biggest first, then oldest, and never selects a student id', async () => {
      const groups = await repos.teacherQuestions.listGroupsForTeacher(
        { teacherId: tA },
        { limit: 100 },
      );
      for (const g of groups) {
        expect(g).not.toHaveProperty('studentId');
        for (const q of g.questions) expect(q).not.toHaveProperty('studentId');
      }
      expect(JSON.stringify(groups)).not.toMatch(/stu_/);
      for (let i = 1; i < groups.length; i += 1) {
        expect(groups[i - 1]!.count).toBeGreaterThanOrEqual(groups[i]!.count);
      }
    });
  });

  describe('notifications', () => {
    it('markRead on another student scope is not_found; a missing id is not_found', async () => {
      const store1 = teacherQuestionStoreFor(repos, { studentId: stu1, teacherId: tA });
      const q = await store1.open({
        teacherId: tA,
        agentId: agentA,
        studentId: stu1,
        text: `NOTIF-CANARY-${uid('q')}: why do leaves change colour in autumn?`,
        similarIds: [],
      });
      await repos.teacherQuestions.answer(
        { teacherId: tA },
        { questionId: q.id, moduleId: moduleA, answer: 'Chlorophyll breaks down.' },
      );
      const mine = await repos.notifications.listForStudent(
        { studentId: stu1, teacherId: tA },
        { unreadOnly: true, limit: 50 },
      );
      const notif = mine.find((n) => n.questionId === q.id)!;
      expect(notif.readAt).toBeNull();
      expect(
        await kind(
          repos.notifications.markRead({ studentId: stu2, teacherId: tA }, notif.id),
        ),
      ).toBe('not_found');
      expect(await kind(repos.notifications.markRead({ studentId: stu1, teacherId: tA }, 'missing'))).toBe(
        'not_found',
      );
      await repos.notifications.markRead({ studentId: stu1, teacherId: tA }, notif.id);
      const afterRead = await repos.notifications.listForStudent(
        { studentId: stu1, teacherId: tA },
        { unreadOnly: true, limit: 50 },
      );
      expect(afterRead.some((n) => n.id === notif.id)).toBe(false);
    });
  });
});
