// Task 11.3a on a real Postgres 16 + pgvector (see test/pg.ts): the weekly insights repository.
// Every aggregate needs at least INSIGHTS_MIN_STUDENTS distinct students (lead answer, 22 Oct
// 2026: the floor counts students, never rows), the teacher's own preview rows never count, the
// windowed reads see only [weekStart, +7 days), no read returns a student id or question text, and
// teacher B's rows never reach teacher A. Cross-scope isolation of every method also runs in
// repositories.int.test.ts (the CASES grid).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { migrateDatabase } from '../src/migrate.js';
import { createDb, type DbHandle } from '../src/internal.js';
import {
  createRepositories,
  INSIGHTS_MIN_STUDENTS,
  INSIGHTS_TOP_N,
  RepositoryError,
  type Repositories,
  WeeklyInsightsPayloadSchema,
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
/**
 * The week under test: [2026-10-05 00:00 UTC, 2026-10-12 00:00 UTC). Both weeks are closed: since
 * 11.3c the repository refuses a week that has not ended (its end is after now), so fixtures stay
 * in the past instead of pinning a clock.
 */
const WEEK = '2026-10-05';
const NEXT_WEEK = '2026-10-12';
const IN = '2026-10-07T10:00:00.000Z';
const OLD = '2026-09-24T10:00:00.000Z';
/** The last instant before the window, and the window's (excluded) end. */
const JUST_BEFORE = '2026-10-04T23:59:59.999Z';
const AT_END = '2026-10-12T00:00:00.000Z';
/** The teacher's own 8.5 test chat runs with student id = teacher id. */
const PREVIEW = teacherId('A');

/** Extra students (stu_x1 … stu_x9), each with a session with both teachers. */
const X = Array.from({ length: 9 }, (_, i) => `stu_x${i + 1}`);
const first = (n: number) => X.slice(0, n);
const sessionOf = (t: Teacher, student: string) =>
  student === PREVIEW ? 'ses_preview_a' : `ses_${student}_${t.toLowerCase()}`;
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
      // Teacher A's own preview session (8.5 test chat: student id = teacher id).
      await raw.query(
        `insert into sessions (id, student_id, teacher_id, agent_id, agent_version, package_id, package_version)
         values ('ses_preview_a', $1, $1, $2, 1, $3, 1)`,
        [PREVIEW, ids.agent('A'), ids.pkg('A')],
      );
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
        expect(await repos.insights.weeklyTopQuestions(A, WEEK)).toEqual([
          { groupId: 'g_five', students: 5, questions: 5 },
        ]);
      });

      it('drops many questions from fewer than 5 students', async () => {
        for (const st of first(4)) {
          for (let i = 0; i < 5; i++) await question('A', st, 'g_rows', { text: `q ${st} ${i}` });
        }
        expect(await repos.insights.weeklyTopQuestions(A, WEEK)).toEqual([]);
      });

      it("never counts the teacher's own preview question toward the floor", async () => {
        for (const st of first(4)) await question('A', st, 'g_prev');
        await question('A', PREVIEW, 'g_prev');
        expect(await repos.insights.weeklyTopQuestions(A, WEEK)).toEqual([]);
        await question('A', X[4]!, 'g_prev');
        expect(await repos.insights.weeklyTopQuestions(A, WEEK)).toEqual([
          { groupId: 'g_prev', students: 5, questions: 5 },
        ]);
      });

      it('counts only questions inside [weekStart, +7 days), in any status', async () => {
        for (const st of first(4)) await question('A', st, 'g_win', { status: 'answered' });
        await question('A', X[4]!, 'g_win', { at: OLD });
        await question('A', X[5]!, 'g_win', { at: JUST_BEFORE });
        await question('A', X[6]!, 'g_win', { at: AT_END });
        expect(await repos.insights.weeklyTopQuestions(A, WEEK)).toEqual([]);
        await question('A', X[7]!, 'g_win', { status: 'dismissed', at: '2026-10-05T00:00:00Z' });
        const [g] = await repos.insights.weeklyTopQuestions(A, WEEK);
        expect(g).toEqual({ groupId: 'g_win', students: 5, questions: 5 });
        // The next week sees only the row at its own start.
        expect(await repos.insights.weeklyTopQuestions(A, NEXT_WEEK)).toEqual([]);
      });

      it('groups an ungrouped question under its own id', async () => {
        const made: string[] = [];
        for (const st of first(5)) made.push(await question('A', st, 'g_s'));
        await raw.query(`update teacher_questions set group_id = null where id = $1`, [made[0]]);
        expect(await repos.insights.weeklyTopQuestions(A, WEEK)).toEqual([]);
        await raw.query(`update teacher_questions set group_id = 'g_s' where id = $1`, [made[0]]);
        expect(await repos.insights.weeklyTopQuestions(A, WEEK)).toHaveLength(1);
      });

      it('returns at most 5 groups, most students first', async () => {
        for (let g = 0; g < 7; g++) {
          for (const st of first(5 + (g % 3))) await question('A', st, `g_top${g}`);
        }
        const groups = await repos.insights.weeklyTopQuestions(A, WEEK);
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
        expect(groups).toEqual([{ groupId: 'g_open', students: 5, questions: 5 }]);
      });

      it('drops many open questions from fewer than 5 students', async () => {
        for (const st of first(2)) {
          for (let i = 0; i < 6; i++) await question('A', st, 'g_two', { text: `o ${st} ${i}` });
        }
        expect(await repos.insights.openQuestionGroups(A)).toEqual([]);
      });

      it("never counts the teacher's own preview question toward the floor", async () => {
        for (const st of first(4)) await question('A', st, 'g_oprev');
        await question('A', PREVIEW, 'g_oprev');
        expect(await repos.insights.openQuestionGroups(A)).toEqual([]);
      });
    });

    describe('stickingTopics', () => {
      it('keeps a topic 5 distinct students got wrong and drops one 4 got wrong', async () => {
        for (const st of first(5)) await miss('A', st, topicOf('A', 1));
        for (const st of first(4)) await miss('A', st, topicOf('A', 2));
        expect(await repos.insights.stickingTopics(A, WEEK)).toEqual([
          { topicId: topicOf('A', 1), title: 'A topic 1', students: 5, misses: 5 },
        ]);
      });

      it('ignores correct answers, misses outside the week and repeats from fewer than 5 students', async () => {
        for (const st of first(4)) {
          for (let i = 0; i < 4; i++) await miss('A', st, topicOf('A', 1));
        }
        await miss('A', X[4]!, topicOf('A', 1), { correct: true });
        await miss('A', X[5]!, topicOf('A', 1), { at: OLD });
        await miss('A', X[6]!, topicOf('A', 1), { at: JUST_BEFORE });
        await miss('A', X[7]!, topicOf('A', 1), { at: AT_END });
        expect(await repos.insights.stickingTopics(A, WEEK)).toEqual([]);
      });

      it("never counts the teacher's own preview miss toward the floor", async () => {
        for (const st of first(4)) await miss('A', st, topicOf('A', 1));
        await miss('A', PREVIEW, topicOf('A', 1));
        expect(await repos.insights.stickingTopics(A, WEEK)).toEqual([]);
      });

      it('returns at most 5 topics, most struggling students first', async () => {
        for (let n = 1; n <= 7; n++) {
          for (const st of first(n <= 2 ? 4 + n : 5)) await miss('A', st, topicOf('A', n));
        }
        const topics = await repos.insights.stickingTopics(A, WEEK);
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
        expect(await repos.insights.unhelpfulAnswerCount(A, WEEK)).toBeNull();
      });

      it("is null when the fifth student is the teacher's own preview", async () => {
        for (const st of first(4)) await trace('A', st, { move: 'ask_teacher' });
        await trace('A', PREVIEW, { move: 'ask_teacher' });
        await trace('A', PREVIEW, { guards: GROUNDING_FAILED });
        expect(await repos.insights.unhelpfulAnswerCount(A, WEEK)).toBeNull();
        await trace('A', X[4]!, { move: 'ask_teacher' });
        // Preview turns don't add to the count either.
        expect(await repos.insights.unhelpfulAnswerCount(A, WEEK)).toBe(5);
      });

      it('counts ask_teacher turns and failed grounding turns once 5 students have one', async () => {
        for (const st of first(3)) await trace('A', st, { move: 'ask_teacher' });
        await trace('A', X[3]!, { guards: GROUNDING_FAILED });
        await trace('A', X[3]!, { move: 'ask_teacher', guards: GROUNDING_FAILED });
        // Not unhelpful: an ok grounding check, another guard failing, turns outside the week.
        await trace('A', X[4]!, { guards: [{ name: 'grounding', ok: true }] });
        await trace('A', X[4]!, { guards: [{ name: 'adviceGuard', ok: false }] });
        await trace('A', X[4]!, { move: 'ask_teacher', at: OLD });
        await trace('A', X[4]!, { move: 'ask_teacher', at: JUST_BEFORE });
        await trace('A', X[4]!, { move: 'ask_teacher', at: AT_END });
        expect(await repos.insights.unhelpfulAnswerCount(A, WEEK)).toBeNull();
        await trace('A', X[4]!, {
          guards: [{ name: 'piiGuard', ok: true }, ...GROUNDING_FAILED],
        });
        expect(await repos.insights.unhelpfulAnswerCount(A, WEEK)).toBe(6);
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
        expect(await repos.insights.weeklyTopQuestions(A, WEEK)).toEqual([]);
        expect(await repos.insights.openQuestionGroups(A)).toEqual([]);
        expect(await repos.insights.stickingTopics(A, WEEK)).toEqual([]);
        expect(await repos.insights.unhelpfulAnswerCount(A, WEEK)).toBeNull();
        expect((await repos.insights.weeklyTopQuestions(B, WEEK)).map((g) => g.groupId)).toEqual([
          'g_iso_b',
        ]);
        expect((await repos.insights.stickingTopics(B, WEEK))[0]!.students).toBe(9);
        expect(await repos.insights.unhelpfulAnswerCount(B, WEEK)).toBe(9);

        await repos.insights.computeAndSaveWeek(B, WEEK);
        expect(await repos.insights.getWeek(A, WEEK)).toBeNull();
        expect((await repos.insights.getWeek(B, WEEK))!.payload.unhelpfulAnswers).toBe(9);
      });
    });

    describe('computeAndSaveWeek and getWeek', () => {
      it('saves the four reads for the week, with no student id or question text', async () => {
        for (const st of first(9)) {
          await question('A', st, 'g_pay', { text: 'how do fractions work' });
          await miss('A', st, topicOf('A', 3));
          await trace('A', st, { move: 'ask_teacher' });
          // Next week's rows stay out of this week's payload.
          await question('A', st, 'g_later', { at: '2026-10-13T10:00:00Z', status: 'answered' });
        }
        const saved = await repos.insights.computeAndSaveWeek(A, WEEK);
        const expected: WeeklyInsightsPayload = {
          topQuestions: [{ groupId: 'g_pay', students: 9, questions: 9 }],
          stickingTopics: [
            { topicId: topicOf('A', 3), title: 'A topic 3', students: 9, misses: 9 },
          ],
          unhelpfulAnswers: 9,
          openTeacherQuestions: [{ groupId: 'g_pay', students: 9, questions: 9 }],
        };
        expect(saved).toMatchObject({ week: WEEK, payload: expected });
        const read = await repos.insights.getWeek(A, WEEK);
        expect(read?.payload).toEqual(expected);
        const text = JSON.stringify([saved, read]);
        expect(text).not.toMatch(/stu_/);
        expect(text).not.toMatch(/studentId|student_id|fractions|sample|oldestAt/);
      });

      it('upserts one row per teacher and week; a re-run replaces the payload', async () => {
        const firstRun = await repos.insights.computeAndSaveWeek(A, WEEK);
        expect(firstRun).toMatchObject({ week: WEEK, payload: emptyPayload() });
        for (const st of first(5)) await trace('A', st, { move: 'ask_teacher' });
        await repos.insights.computeAndSaveWeek(A, WEEK);
        await repos.insights.computeAndSaveWeek(A, NEXT_WEEK);
        expect((await repos.insights.getWeek(A, WEEK))?.payload.unhelpfulAnswers).toBe(5);
        expect((await repos.insights.getWeek(A, NEXT_WEEK))?.payload).toEqual(emptyPayload());
        const rows = await raw.query(
          'select count(*)::int as n from insights where teacher_id = $1',
          [teacherId('A')],
        );
        expect(rows.rows[0].n).toBe(2);
        expect(await repos.insights.getWeek(A, '2026-09-28')).toBeNull();
      });

      it('has no public write that takes a payload', () => {
        expect(Object.keys(repos.insights).sort()).toEqual([
          'computeAndSaveWeek',
          'getWeek',
          'openQuestionGroups',
          'stickingTopics',
          'unhelpfulAnswerCount',
          'weeklyTopQuestions',
        ]);
      });

      it('the payload schema refuses anything under the floor, extra fields or over the top-N', () => {
        const group = { groupId: 'g1', students: 5, questions: 7 };
        expect(
          WeeklyInsightsPayloadSchema.safeParse({ ...emptyPayload(), topQuestions: [group] })
            .success,
        ).toBe(true);
        const bad: unknown[] = [
          { ...emptyPayload(), topQuestions: [{ ...group, students: 4 }] },
          { ...emptyPayload(), openTeacherQuestions: [{ ...group, studentId: 'stu_x1' }] },
          { ...emptyPayload(), topQuestions: [{ ...group, sample: 'what is a ratio' }] },
          { ...emptyPayload(), topQuestions: [{ ...group, oldestAt: IN }] },
          {
            ...emptyPayload(),
            stickingTopics: [{ topicId: 't', title: 'x', students: 4, misses: 9 }],
          },
          { ...emptyPayload(), unhelpfulAnswers: 4 },
          { ...emptyPayload(), topQuestions: Array.from({ length: 6 }, () => group) },
          { ...emptyPayload(), topQuestions: [{ ...group, questions: 4 }] },
          { ...emptyPayload(), extra: 1 },
          null,
        ];
        for (const p of bad) expect(WeeklyInsightsPayloadSchema.safeParse(p).success).toBe(false);
      });

      it('refuses a week that is not a Monday date', async () => {
        for (const w of ['2026-10-06', '2026-10-05T00:00:00Z', 'monday', '']) {
          await expectKind(() => repos.insights.computeAndSaveWeek(A, w), 'invalid');
          await expectKind(() => repos.insights.getWeek(A, w), 'invalid');
          await expectKind(() => repos.insights.weeklyTopQuestions(A, w), 'invalid');
          await expectKind(() => repos.insights.stickingTopics(A, w), 'invalid');
          await expectKind(() => repos.insights.unhelpfulAnswerCount(A, w), 'invalid');
        }
        const n = await raw.query('select count(*)::int as n from insights');
        expect(n.rows[0].n).toBe(0);
      });

      // Task 11.3c (11.3a security review, deferred MEDIUM): a week that has not ended is
      // refused, so nobody can read "this week" before and after one student's activity and
      // difference that student out of the floor.
      describe('refuses a week that has not ended', () => {
        /** The Monday (YYYY-MM-DD) of the ISO week containing `d`, in UTC. */
        const mondayOf = (d: Date): string => {
          const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
          const monday = new Date(day - ((d.getUTCDay() + 6) % 7) * 24 * 60 * 60 * 1000);
          return monday.toISOString().slice(0, 10);
        };
        const DAY_MS = 24 * 60 * 60 * 1000;
        const thisWeek = mondayOf(new Date());
        const futureWeek = mondayOf(new Date(Date.now() + 7 * DAY_MS));
        const farFuture = mondayOf(new Date(Date.now() + 365 * DAY_MS));
        const lastWeek = mondayOf(new Date(Date.now() - 7 * DAY_MS));

        it('is invalid for the current week and any future week, on every read and the write', async () => {
          for (const st of first(5)) await trace('A', st, { move: 'ask_teacher', at: new Date().toISOString() });
          for (const w of [thisWeek, futureWeek, farFuture]) {
            await expectKind(() => repos.insights.weeklyTopQuestions(A, w), 'invalid');
            await expectKind(() => repos.insights.stickingTopics(A, w), 'invalid');
            await expectKind(() => repos.insights.unhelpfulAnswerCount(A, w), 'invalid');
            await expectKind(() => repos.insights.getWeek(A, w), 'invalid');
            await expectKind(() => repos.insights.computeAndSaveWeek(A, w), 'invalid');
          }
          const n = await raw.query('select count(*)::int as n from insights');
          expect(n.rows[0].n).toBe(0);
        });

        it('still serves a closed week (last week and the fixture weeks)', async () => {
          for (const w of new Set([lastWeek, WEEK, NEXT_WEEK])) {
            expect(await repos.insights.weeklyTopQuestions(A, w)).toEqual([]);
            expect(await repos.insights.stickingTopics(A, w)).toEqual([]);
            expect(await repos.insights.unhelpfulAnswerCount(A, w)).toBeNull();
            expect(await repos.insights.getWeek(A, w)).toBeNull();
            expect(await repos.insights.computeAndSaveWeek(A, w)).toMatchObject({ week: w });
            expect((await repos.insights.getWeek(A, w))?.payload).toEqual(emptyPayload());
          }
        });
      });

      it('throws integrity for a stored payload that no longer parses', async () => {
        await raw.query(
          `insert into insights (id, teacher_id, week, payload) values ('ins_bad', $1, $2, '{"topQuestions": 1}')`,
          [teacherId('A'), WEEK],
        );
        await expectKind(() => repos.insights.getWeek(A, WEEK), 'integrity');
      });

      it('is not_found for a teacher id with no user row', async () => {
        await expectKind(
          () => repos.insights.computeAndSaveWeek({ teacherId: 'tch_ghost' }, WEEK),
          'not_found',
        );
      });
    });

    it('rejects a bad scope before any SQL', async () => {
      const calls = [
        (s: never) => repos.insights.weeklyTopQuestions(s, WEEK),
        (s: never) => repos.insights.openQuestionGroups(s),
        (s: never) => repos.insights.stickingTopics(s, WEEK),
        (s: never) => repos.insights.unhelpfulAnswerCount(s, WEEK),
        (s: never) => repos.insights.computeAndSaveWeek(s, WEEK),
        (s: never) => repos.insights.getWeek(s, WEEK),
      ];
      for (const call of calls) {
        await expectKind(() => call({} as never), 'scope');
        await expectKind(() => call({ teacherId: 'bad id' } as never), 'scope');
      }
    });
  },
);
