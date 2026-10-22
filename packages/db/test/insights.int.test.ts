// Task 11.3a on a real Postgres 16 + pgvector (see test/pg.ts): the weekly insights repository.
// Every aggregate needs at least INSIGHTS_MIN_STUDENTS distinct students (lead answer, 22 Oct
// 2026: the floor counts students, never rows), no read returns a student id, and teacher B's rows
// never reach teacher A. Cross-scope isolation of every method also runs in
// repositories.int.test.ts (the CASES grid).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { migrateDatabase } from '../src/migrate.js';
import { createDb, type DbHandle } from '../src/internal.js';
import {
  createRepositories,
  INSIGHTS_MIN_STUDENTS,
  INSIGHTS_SAMPLE_MAX_LENGTH,
  INSIGHTS_TOP_N,
  RepositoryError,
  type Repositories,
  type WeeklyInsightsPayload,
} from '../src/index.js';
import { ids, seed, teacherId, type Teacher } from './isolation-seed.js';
import {
  createDatabase,
  dropDatabase,
  postgresUp,
  SKIP_REASON,
  throwawayName,
  urlFor,
} from './pg.js';

const up = await postgresUp('weekly insights integration tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
let handle: DbHandle;
let repos: Repositories;
let raw: pg.Client;

const A = { teacherId: teacherId('A') };
const B = { teacherId: teacherId('B') };
const SINCE = '2026-10-12T07:00:00.000Z';
const IN = '2026-10-14T10:00:00.000Z';
const OLD = '2026-10-01T10:00:00.000Z';
const MONDAY = '2026-10-19';

/** Extra students (stu_x1 … stu_x9), each with a session with both teachers. */
const X = Array.from({ length: 9 }, (_, i) => `stu_x${i + 1}`);
const first = (n: number) => X.slice(0, n);
const sessionOf = (t: Teacher, student: string) => `ses_${student}_${t.toLowerCase()}`;
const topicOf = (t: Teacher, n: number) => `top_${t.toLowerCase()}_${n}`;

let qn = 0;
async function question(
  t: Teacher,
  student: string,
  group: string,
  o: { status?: 'open' | 'answered' | 'dismissed'; at?: string; text?: string } = {},
): Promise<string> {
  const id = `tq_x${++qn}`;
  await raw.query(
    `insert into teacher_questions (id, teacher_id, agent_id, student_id, text, group_id, status, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      teacherId(t),
      ids.agent(t),
      student,
      o.text ?? `question about ${group}`,
      group,
      o.status ?? 'open',
      o.at ?? IN,
    ],
  );
  return id;
}

async function miss(
  t: Teacher,
  student: string,
  topic: string,
  o: { correct?: boolean; at?: string } = {},
): Promise<void> {
  await raw.query(
    `insert into evidence_events (id, student_id, teacher_id, topic_id, correct, source, ts)
     values (gen_random_uuid()::text, $1, $2, $3, $4, 'check', $5)`,
    [student, teacherId(t), topic, o.correct ?? false, o.at ?? IN],
  );
}

let tn = 0;
async function trace(
  t: Teacher,
  student: string,
  o: { move?: string; guards?: unknown[]; at?: string } = {},
): Promise<void> {
  await raw.query(
    `insert into turn_traces (id, session_id, steps, model, input_tokens, output_tokens,
       cost_micro_usd, turn_id, agent_version, package_version, intent, move, guards, usage, created_at)
     values ($1, $2, '[]', '', 0, 0, 0, $1, 1, 1, 'on_task', $3, $4, '[]', $5)`,
    [
      `tt_x${++tn}`,
      sessionOf(t, student),
      o.move ?? 'explain',
      JSON.stringify(o.guards ?? []),
      o.at ?? IN,
    ],
  );
}

const GROUNDING_FAILED = [{ name: 'grounding', ok: false, action: 'replace' }];

async function expectKind(run: () => Promise<unknown>, kind: string): Promise<void> {
  const err = await run().then(
    () => new Error('call succeeded'),
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(RepositoryError);
  expect((err as RepositoryError).kind).toBe(kind);
}

function emptyPayload(): WeeklyInsightsPayload {
  return { topQuestions: [], stickingTopics: [], unhelpfulAnswers: null, openTeacherQuestions: [] };
}

describe.skipIf(!up)(
  `weekly insights on Postgres 16 + pgvector${up ? '' : ` (${SKIP_REASON})`}`,
  () => {
    beforeAll(async () => {
      await createDatabase(dbName);
      await migrateDatabase(TEST_URL);
      handle = createDb({ DATABASE_URL: TEST_URL });
      await seed(handle.db);
      repos = createRepositories(handle.db);
      raw = new pg.Client({ connectionString: TEST_URL });
      await raw.connect();
      for (const st of X) {
        await raw.query(
          `insert into users (id, name, locale, market, role) values ($1, $1, 'en', 'test', 'student')`,
          [st],
        );
        for (const t of ['A', 'B'] as const) {
          await raw.query(
            `insert into sessions (id, student_id, teacher_id, agent_id, agent_version, package_id, package_version)
             values ($1, $2, $3, $4, 1, $5, 1)`,
            [sessionOf(t, st), st, teacherId(t), ids.agent(t), ids.pkg(t)],
          );
        }
      }
      for (const t of ['A', 'B'] as const) {
        for (let n = 1; n <= 7; n++) {
          await raw.query(
            `insert into topics (id, teacher_id, module_id, title, "order") values ($1, $2, $3, $4, $5)`,
            [topicOf(t, n), teacherId(t), ids.module(t, 1), `${t} topic ${n}`, n],
          );
        }
      }
    });

    beforeEach(async () => {
      await raw.query(
        'delete from notifications; delete from teacher_questions; delete from evidence_events; delete from turn_traces; delete from insights',
      );
    });

    afterAll(async () => {
      await raw?.end();
      await handle?.close();
      await dropDatabase(dbName);
    });

    it('exports a floor of 5 distinct students and a top 5', () => {
      expect(INSIGHTS_MIN_STUDENTS).toBe(5);
      expect(INSIGHTS_TOP_N).toBe(5);
    });

    describe('weeklyTopQuestions', () => {
      it('keeps a group asked by 5 distinct students and drops one asked by 4', async () => {
        for (const st of first(5)) await question('A', st, 'g_five');
        for (const st of first(4)) await question('A', st, 'g_four');
        const groups = await repos.insights.weeklyTopQuestions(A, SINCE);
        expect(groups).toEqual([
          {
            groupId: 'g_five',
            students: 5,
            questions: 5,
            oldestAt: IN,
            sample: 'question about g_five',
          },
        ]);
      });

      it('drops many questions from fewer than 5 students', async () => {
        for (const st of first(4)) {
          for (let i = 0; i < 5; i++) await question('A', st, 'g_rows', { text: `q ${st} ${i}` });
        }
        expect(await repos.insights.weeklyTopQuestions(A, SINCE)).toEqual([]);
      });

      it('counts only questions opened since the window start, in any status', async () => {
        for (const st of first(4)) await question('A', st, 'g_win', { status: 'answered' });
        await question('A', X[4]!, 'g_win', { at: OLD });
        expect(await repos.insights.weeklyTopQuestions(A, SINCE)).toEqual([]);
        await question('A', X[5]!, 'g_win', { status: 'dismissed' });
        const [g] = await repos.insights.weeklyTopQuestions(A, SINCE);
        expect(g).toMatchObject({ groupId: 'g_win', students: 5, questions: 5 });
      });

      it('groups an ungrouped question under its own id and returns the oldest text as the sample', async () => {
        const made: string[] = [];
        for (const [i, st] of first(5).entries()) {
          made[i] = await question('A', st, 'g_s', {
            at: `2026-10-1${3 + (i % 3)}T10:00:00.000Z`,
            text: i === 2 ? 'x'.repeat(INSIGHTS_SAMPLE_MAX_LENGTH + 50) : `t${i}`,
          });
        }
        await raw.query(
          `update teacher_questions set created_at = '2026-10-12T08:00:00Z' where text = 't4'`,
        );
        await raw.query(`update teacher_questions set group_id = null where id = $1`, [made[0]]);
        const [g] = await repos.insights.weeklyTopQuestions(A, SINCE);
        // The first question left the group (its own id is now its group): 4 students remain.
        expect(g).toBeUndefined();
        await raw.query(`update teacher_questions set group_id = 'g_s' where id = $1`, [made[0]]);
        const [g2] = await repos.insights.weeklyTopQuestions(A, SINCE);
        expect(g2!.sample).toBe('t4');
        expect(g2!.oldestAt).toBe('2026-10-12T08:00:00.000Z');
        await raw.query(
          `update teacher_questions set created_at = '2026-10-12T07:30:00Z' where text like 'xxx%'`,
        );
        const [g3] = await repos.insights.weeklyTopQuestions(A, SINCE);
        expect(g3!.sample).toHaveLength(INSIGHTS_SAMPLE_MAX_LENGTH);
      });

      it('returns at most 5 groups, most students first', async () => {
        for (let g = 0; g < 7; g++) {
          for (const st of first(5 + (g % 3))) await question('A', st, `g_top${g}`);
        }
        const groups = await repos.insights.weeklyTopQuestions(A, SINCE);
        expect(groups).toHaveLength(INSIGHTS_TOP_N);
        expect(groups.map((x) => x.students)).toEqual([7, 7, 6, 6, 5]);
        expect(groups.map((x) => x.groupId)).toEqual([
          'g_top2',
          'g_top5',
          'g_top1',
          'g_top4',
          'g_top0',
        ]);
      });
    });

    describe('openQuestionGroups', () => {
      it('counts only open questions, at any age, with the same 4 vs 5 student floor', async () => {
        for (const st of first(5)) await question('A', st, 'g_open', { at: OLD });
        for (const st of first(5)) await question('A', st, 'g_done', { status: 'answered' });
        for (const st of first(4)) await question('A', st, 'g_open4');
        await question('A', X[4]!, 'g_open4', { status: 'dismissed' });
        const groups = await repos.insights.openQuestionGroups(A);
        expect(groups.map((g) => [g.groupId, g.students])).toEqual([['g_open', 5]]);
      });

      it('drops many open questions from fewer than 5 students', async () => {
        for (const st of first(2)) {
          for (let i = 0; i < 6; i++) await question('A', st, 'g_two', { text: `o ${st} ${i}` });
        }
        expect(await repos.insights.openQuestionGroups(A)).toEqual([]);
      });
    });

    describe('stickingTopics', () => {
      it('keeps a topic 5 distinct students got wrong and drops one 4 got wrong', async () => {
        for (const st of first(5)) await miss('A', st, topicOf('A', 1));
        for (const st of first(4)) await miss('A', st, topicOf('A', 2));
        expect(await repos.insights.stickingTopics(A, SINCE)).toEqual([
          { topicId: topicOf('A', 1), title: 'A topic 1', students: 5, misses: 5 },
        ]);
      });

      it('ignores correct answers, old misses and repeat misses from fewer than 5 students', async () => {
        for (const st of first(4)) {
          for (let i = 0; i < 4; i++) await miss('A', st, topicOf('A', 1));
        }
        await miss('A', X[4]!, topicOf('A', 1), { correct: true });
        await miss('A', X[5]!, topicOf('A', 1), { at: OLD });
        expect(await repos.insights.stickingTopics(A, SINCE)).toEqual([]);
      });

      it('returns at most 5 topics, most struggling students first', async () => {
        for (let n = 1; n <= 7; n++) {
          for (const st of first(n <= 2 ? 4 + n : 5)) await miss('A', st, topicOf('A', n));
        }
        const topics = await repos.insights.stickingTopics(A, SINCE);
        expect(topics).toHaveLength(INSIGHTS_TOP_N);
        expect(topics.slice(0, 2).map((x) => [x.topicId, x.students])).toEqual([
          [topicOf('A', 2), 6],
          [topicOf('A', 1), 5],
        ]);
      });
    });

    describe('unhelpfulAnswerCount', () => {
      it('is null below 5 distinct students, however many turns', async () => {
        for (const st of first(4)) {
          for (let i = 0; i < 5; i++) await trace('A', st, { move: 'ask_teacher' });
        }
        expect(await repos.insights.unhelpfulAnswerCount(A, SINCE)).toBeNull();
      });

      it('counts ask_teacher turns and failed grounding turns once 5 students have one', async () => {
        for (const st of first(3)) await trace('A', st, { move: 'ask_teacher' });
        await trace('A', X[3]!, { guards: GROUNDING_FAILED });
        await trace('A', X[3]!, { move: 'ask_teacher', guards: GROUNDING_FAILED });
        // Not unhelpful: an ok grounding check, another guard failing, an old turn.
        await trace('A', X[4]!, { guards: [{ name: 'grounding', ok: true }] });
        await trace('A', X[4]!, { guards: [{ name: 'adviceGuard', ok: false }] });
        await trace('A', X[4]!, { move: 'ask_teacher', at: OLD });
        expect(await repos.insights.unhelpfulAnswerCount(A, SINCE)).toBeNull();
        await trace('A', X[4]!, {
          guards: [{ name: 'piiGuard', ok: true }, ...GROUNDING_FAILED],
        });
        expect(await repos.insights.unhelpfulAnswerCount(A, SINCE)).toBe(6);
      });
    });

    describe('teacher isolation', () => {
      it("never counts or shows another teacher's rows, even toward the floor", async () => {
        for (const st of first(4)) {
          await question('A', st, 'g_iso');
          await miss('A', st, topicOf('A', 1));
          await trace('A', st, { move: 'ask_teacher' });
        }
        for (const st of first(9)) {
          await question('B', st, 'g_iso_b');
          await miss('B', st, topicOf('B', 1));
          await trace('B', st, { move: 'ask_teacher' });
        }
        // The fifth student only asked teacher B: A still has 4.
        await question('B', X[4]!, 'g_iso');
        expect(await repos.insights.weeklyTopQuestions(A, SINCE)).toEqual([]);
        expect(await repos.insights.openQuestionGroups(A)).toEqual([]);
        expect(await repos.insights.stickingTopics(A, SINCE)).toEqual([]);
        expect(await repos.insights.unhelpfulAnswerCount(A, SINCE)).toBeNull();
        expect((await repos.insights.weeklyTopQuestions(B, SINCE)).map((g) => g.groupId)).toEqual([
          'g_iso_b',
        ]);
        expect((await repos.insights.stickingTopics(B, SINCE))[0]!.students).toBe(9);
        expect(await repos.insights.unhelpfulAnswerCount(B, SINCE)).toBe(9);

        await repos.insights.saveWeek(B, MONDAY, emptyPayload());
        expect(await repos.insights.getWeek(A, MONDAY)).toBeNull();
      });
    });

    it('never puts a student id in any payload field', async () => {
      for (const st of first(9)) {
        await question('A', st, 'g_pay', { text: 'how do fractions work' });
        await miss('A', st, topicOf('A', 3));
        await trace('A', st, { move: 'ask_teacher' });
      }
      const payload: WeeklyInsightsPayload = {
        topQuestions: await repos.insights.weeklyTopQuestions(A, SINCE),
        stickingTopics: await repos.insights.stickingTopics(A, SINCE),
        unhelpfulAnswers: await repos.insights.unhelpfulAnswerCount(A, SINCE),
        openTeacherQuestions: await repos.insights.openQuestionGroups(A),
      };
      expect(payload.topQuestions).toHaveLength(1);
      expect(Object.keys(payload.topQuestions[0]!).sort()).toEqual(
        ['groupId', 'oldestAt', 'questions', 'sample', 'students'].sort(),
      );
      expect(Object.keys(payload.stickingTopics[0]!).sort()).toEqual(
        ['misses', 'students', 'title', 'topicId'].sort(),
      );
      const saved = await repos.insights.saveWeek(A, MONDAY, payload);
      const text = JSON.stringify([payload, saved, await repos.insights.getWeek(A, MONDAY)]);
      expect(text).not.toMatch(/stu_/);
      expect(text).not.toMatch(/studentId|student_id/);
    });

    describe('saveWeek and getWeek', () => {
      const group = {
        groupId: 'g1',
        students: 5,
        questions: 7,
        oldestAt: IN,
        sample: 'what is a ratio',
      };

      it('upserts one row per teacher and week; a second save replaces the payload', async () => {
        const first = await repos.insights.saveWeek(A, MONDAY, emptyPayload());
        expect(first).toMatchObject({ week: MONDAY, payload: emptyPayload() });
        const next = { ...emptyPayload(), topQuestions: [group], unhelpfulAnswers: 12 };
        await repos.insights.saveWeek(A, MONDAY, next);
        await repos.insights.saveWeek(A, '2026-10-12', emptyPayload());
        expect((await repos.insights.getWeek(A, MONDAY))?.payload).toEqual(next);
        expect((await repos.insights.getWeek(A, '2026-10-12'))?.payload).toEqual(emptyPayload());
        const rows = await raw.query(
          'select count(*)::int as n from insights where teacher_id = $1',
          [teacherId('A')],
        );
        expect(rows.rows[0].n).toBe(2);
        expect(await repos.insights.getWeek(A, '2026-10-05')).toBeNull();
      });

      it('refuses a payload under the floor, with extra fields, or over the top-N', async () => {
        const bad: unknown[] = [
          { ...emptyPayload(), topQuestions: [{ ...group, students: 4 }] },
          { ...emptyPayload(), openTeacherQuestions: [{ ...group, studentId: 'stu_x1' }] },
          {
            ...emptyPayload(),
            stickingTopics: [{ topicId: 't', title: 'x', students: 4, misses: 9 }],
          },
          { ...emptyPayload(), unhelpfulAnswers: 4 },
          { ...emptyPayload(), topQuestions: Array.from({ length: 6 }, () => group) },
          { ...emptyPayload(), topQuestions: [{ ...group, questions: 4 }] },
          {
            ...emptyPayload(),
            topQuestions: [{ ...group, sample: 'x'.repeat(INSIGHTS_SAMPLE_MAX_LENGTH + 1) }],
          },
          { ...emptyPayload(), extra: 1 },
          null,
        ];
        for (const p of bad) {
          await expectKind(() => repos.insights.saveWeek(A, MONDAY, p as never), 'invalid');
        }
        const n = await raw.query('select count(*)::int as n from insights');
        expect(n.rows[0].n).toBe(0);
      });

      it('refuses a week that is not a Monday date', async () => {
        for (const w of ['2026-10-20', '2026-10-19T00:00:00Z', 'monday', '']) {
          await expectKind(() => repos.insights.saveWeek(A, w, emptyPayload()), 'invalid');
          await expectKind(() => repos.insights.getWeek(A, w), 'invalid');
        }
      });

      it('throws integrity for a stored payload that no longer parses', async () => {
        await raw.query(
          `insert into insights (id, teacher_id, week, payload) values ('ins_bad', $1, $2, '{"topQuestions": 1}')`,
          [teacherId('A'), MONDAY],
        );
        await expectKind(() => repos.insights.getWeek(A, MONDAY), 'integrity');
      });

      it('is not_found for a teacher id with no user row', async () => {
        await expectKind(
          () => repos.insights.saveWeek({ teacherId: 'tch_ghost' }, MONDAY, emptyPayload()),
          'not_found',
        );
      });
    });

    it('rejects a bad scope or window start before any SQL', async () => {
      const calls = [
        (s: never) => repos.insights.weeklyTopQuestions(s, SINCE),
        (s: never) => repos.insights.openQuestionGroups(s),
        (s: never) => repos.insights.stickingTopics(s, SINCE),
        (s: never) => repos.insights.unhelpfulAnswerCount(s, SINCE),
        (s: never) => repos.insights.saveWeek(s, MONDAY, emptyPayload()),
        (s: never) => repos.insights.getWeek(s, MONDAY),
      ];
      for (const call of calls) {
        await expectKind(() => call({} as never), 'scope');
        await expectKind(() => call({ teacherId: 'bad id' } as never), 'scope');
      }
      for (const since of ['yesterday', '2026-10-12', '']) {
        await expectKind(() => repos.insights.weeklyTopQuestions(A, since), 'invalid');
        await expectKind(() => repos.insights.stickingTopics(A, since), 'invalid');
        await expectKind(() => repos.insights.unhelpfulAnswerCount(A, since), 'invalid');
      }
    });
  },
);
