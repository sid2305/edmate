// Task 11.3a: weekly teacher insights (build plan § 11.3, PRD "Weekly insights"). Four aggregate
// reads over one teacher's own rows, and `computeAndSaveWeek`, which runs them and upserts the
// week's payload into `insights`.
//
// Privacy floor (lead answer, 22 Oct 2026): every aggregate needs at least INSIGHTS_MIN_STUDENTS
// **distinct students**, never rows, enforced here in SQL (`having count(distinct student_id) >=
// 5`). The teacher's own preview turns (8.5 test chat runs with student id = teacher id) never
// count. No read selects or returns a student id: `student_id` appears only inside
// `count(distinct …)` and the preview filter.
//
// What this guarantees: every group, topic or count a read returns describes at least 5 real
// students within its window. The three windowed reads take a `weekStart` Monday and read only the
// fixed window [Monday 00:00 UTC, +7 days), so a caller can't choose nested or open-ended windows
// and difference two results down to one student; the weekly windows are disjoint. It does not
// stop week-over-week comparison of `openQuestionGroups`, which has no window ("currently open"),
// so its counts are cumulative (accepted: the teacher already sees each question in the 8.8
// inbox). The payload holds ids, counts and topic titles only: no question text, no timestamp.
// The only write is `computeAndSaveWeek`, which builds the payload from these reads; `saveWeek`
// is internal, so no caller can store a forged payload.
//
// Closed weeks only (task 11.3c, 11.3a security review): every read and `computeAndSaveWeek`
// refuse (`invalid`) a week whose end (Monday + 7 days) is after the server clock. Otherwise a
// caller could read the current week before and after one student's activity and difference
// that student out of the floor. The worker only ever asks for the last finished week.
import { and, asc, desc, eq, gte, lt, ne, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client.js';
import {
  evidenceEvents,
  insights,
  sessions,
  teacherQuestions,
  topics,
  turnTraces,
} from '../schema/index.js';
import { RepositoryError, translateWrite } from './errors.js';
import { checked, iso } from './map.js';
import { IdSchema, parseArg, teacherScope, type TeacherScope } from './scope.js';

/** The smallest number of distinct students any aggregate may describe. */
export const INSIGHTS_MIN_STUDENTS = 5;
/** Most groups or topics in each list. */
export const INSIGHTS_TOP_N = 5;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** The Monday (`YYYY-MM-DD`) that starts an ISO week. */
const WeekStart = z.iso
  .date()
  .refine((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 1, 'a Monday');

const Students = z.int().min(INSIGHTS_MIN_STUDENTS);

const QuestionGroupSchema = z
  .strictObject({
    groupId: IdSchema,
    students: Students,
    questions: z.int().min(INSIGHTS_MIN_STUDENTS),
  })
  .refine((g) => g.questions >= g.students, 'questions >= students');

const StickingTopicSchema = z
  .strictObject({
    topicId: IdSchema,
    title: z.string(),
    students: Students,
    misses: z.int().min(INSIGHTS_MIN_STUDENTS),
  })
  .refine((t) => t.misses >= t.students, 'misses >= students');

/** The stored weekly payload. Local to @edmate/db: no UI reads it yet (plan decision 1). */
export const WeeklyInsightsPayloadSchema = z.strictObject({
  topQuestions: z.array(QuestionGroupSchema).max(INSIGHTS_TOP_N),
  stickingTopics: z.array(StickingTopicSchema).max(INSIGHTS_TOP_N),
  /** Turns that fell back to asking the teacher or failed grounding; null under the floor. */
  unhelpfulAnswers: Students.nullable(),
  openTeacherQuestions: z.array(QuestionGroupSchema).max(INSIGHTS_TOP_N),
});

export type InsightQuestionGroup = z.infer<typeof QuestionGroupSchema>;
export type StickingTopic = z.infer<typeof StickingTopicSchema>;
export type WeeklyInsightsPayload = z.infer<typeof WeeklyInsightsPayloadSchema>;

/** One stored week. */
export interface InsightsWeek {
  week: string;
  payload: WeeklyInsightsPayload;
  updatedAt: string;
}

const atLeastFloor = (distinct: SQL) => sql`${distinct} >= ${INSIGHTS_MIN_STUDENTS}`;

/**
 * A validated Monday and its fixed window [00:00 UTC, +7 days). The week must have ended: a
 * window whose end is after now (the server clock, `Date.now()`) is `invalid`, so no read or
 * write ever sees a week that can still change.
 */
function weekWindow(weekStart: string, method: string): { week: string; start: Date; end: Date } {
  const week = parseArg(WeekStart, weekStart, method);
  const start = new Date(`${week}T00:00:00.000Z`);
  const end = new Date(start.getTime() + WEEK_MS);
  if (end.getTime() > Date.now()) throw new RepositoryError('invalid', method);
  return { week, start, end };
}

export function insightsRepo(db: Db) {
  /**
   * The teacher's question groups (a row's `group_id`, or its own id when null — the grouping
   * `teacherQuestions.open` writes), each asked by at least INSIGHTS_MIN_STUDENTS distinct students;
   * most students first, then most questions. Preview rows (student = teacher) never count.
   * `extra` narrows the rows.
   */
  async function questionGroups(teacherId: string, extra: SQL): Promise<InsightQuestionGroup[]> {
    const group = sql<string>`coalesce(${teacherQuestions.groupId}, ${teacherQuestions.id})`;
    const students = sql<number>`count(distinct ${teacherQuestions.studentId})::int`;
    const questions = sql<number>`count(*)::int`;
    return db
      .select({ groupId: group, students, questions })
      .from(teacherQuestions)
      .where(
        and(
          eq(teacherQuestions.teacherId, teacherId),
          ne(teacherQuestions.studentId, teacherQuestions.teacherId),
          extra,
        ),
      )
      .groupBy(group)
      .having(atLeastFloor(students))
      .orderBy(desc(students), desc(questions), asc(group))
      .limit(INSIGHTS_TOP_N);
  }

  /** Question groups opened in the week (any status): what students asked most that week. */
  async function weeklyTopQuestions(
    scope: TeacherScope,
    weekStart: string,
  ): Promise<InsightQuestionGroup[]> {
    const method = 'insights.weeklyTopQuestions';
    const { teacherId } = teacherScope(scope, method);
    const { start, end } = weekWindow(weekStart, method);
    return questionGroups(
      teacherId,
      and(gte(teacherQuestions.createdAt, start), lt(teacherQuestions.createdAt, end))!,
    );
  }

  /** Question groups still open now (the teacher hasn't answered), at any age. */
  async function openQuestionGroups(scope: TeacherScope): Promise<InsightQuestionGroup[]> {
    const method = 'insights.openQuestionGroups';
    const { teacherId } = teacherScope(scope, method);
    return questionGroups(teacherId, eq(teacherQuestions.status, 'open'));
  }

  /**
   * Topics that at least INSIGHTS_MIN_STUDENTS distinct students got wrong in the week
   * (`evidence_events.correct = false`, by event time `ts`); most students first.
   */
  async function stickingTopics(scope: TeacherScope, weekStart: string): Promise<StickingTopic[]> {
    const method = 'insights.stickingTopics';
    const { teacherId } = teacherScope(scope, method);
    const { start, end } = weekWindow(weekStart, method);
    const students = sql<number>`count(distinct ${evidenceEvents.studentId})::int`;
    const misses = sql<number>`count(*)::int`;
    return db
      .select({ topicId: evidenceEvents.topicId, title: topics.title, students, misses })
      .from(evidenceEvents)
      .innerJoin(
        topics,
        and(eq(topics.id, evidenceEvents.topicId), eq(topics.teacherId, teacherId)),
      )
      .where(
        and(
          eq(evidenceEvents.teacherId, teacherId),
          ne(evidenceEvents.studentId, evidenceEvents.teacherId),
          eq(evidenceEvents.correct, false),
          gte(evidenceEvents.ts, start),
          lt(evidenceEvents.ts, end),
        ),
      )
      .groupBy(evidenceEvents.topicId, topics.title)
      .having(atLeastFloor(students))
      .orderBy(desc(students), desc(misses), asc(evidenceEvents.topicId))
      .limit(INSIGHTS_TOP_N);
  }

  /**
   * Turns in the week that the agent couldn't answer well: the `ask_teacher` move, or a
   * `grounding` guard entry with `ok: false` (plan decision 3; there is no rating feature yet).
   * Null, never a smaller number, when fewer than INSIGHTS_MIN_STUDENTS distinct students had one.
   */
  async function unhelpfulAnswerCount(
    scope: TeacherScope,
    weekStart: string,
  ): Promise<number | null> {
    const method = 'insights.unhelpfulAnswerCount';
    const { teacherId } = teacherScope(scope, method);
    const { start, end } = weekWindow(weekStart, method);
    const students = sql<number>`count(distinct ${sessions.studentId})::int`;
    const [row] = await db
      .select({ turns: sql<number>`count(*)::int` })
      .from(turnTraces)
      .innerJoin(sessions, eq(sessions.id, turnTraces.sessionId))
      .where(
        and(
          eq(sessions.teacherId, teacherId),
          ne(sessions.studentId, sessions.teacherId),
          gte(turnTraces.createdAt, start),
          lt(turnTraces.createdAt, end),
          sql`(${turnTraces.move} = 'ask_teacher' or exists (
            select 1 from jsonb_array_elements(${turnTraces.guards}) as g
            where g->>'name' = 'grounding' and g->'ok' = 'false'::jsonb))`,
        ),
      )
      .having(atLeastFloor(students));
    return row ? row.turns : null;
  }

  /** Upserts the week's payload. Internal: only computeAndSaveWeek calls it. */
  async function saveWeek(
    teacherId: string,
    week: string,
    payload: WeeklyInsightsPayload,
    method: string,
  ): Promise<InsightsWeek> {
    // Second line behind the SQL floor: a payload under the floor never reaches the table.
    const p = checked(WeeklyInsightsPayloadSchema, payload, method);
    const [row] = await translateWrite(method, () =>
      db
        .insert(insights)
        .values({ teacherId, week, payload: p })
        .onConflictDoUpdate({
          target: [insights.teacherId, insights.week],
          set: { payload: p, updatedAt: sql`now()` },
        })
        .returning({ week: insights.week, updatedAt: insights.updatedAt }),
    );
    return { week: row!.week, payload: p, updatedAt: iso(row!.updatedAt) };
  }

  return {
    weeklyTopQuestions,
    openQuestionGroups,
    stickingTopics,
    unhelpfulAnswerCount,

    /**
     * Runs the four reads for the week starting `weekStart` (a Monday) and upserts the payload,
     * replacing any earlier one for that teacher and week. The only write to `insights`.
     */
    async computeAndSaveWeek(scope: TeacherScope, weekStart: string): Promise<InsightsWeek> {
      const method = 'insights.computeAndSaveWeek';
      const { teacherId } = teacherScope(scope, method);
      const { week } = weekWindow(weekStart, method);
      const [topQuestions, sticking, unhelpfulAnswers, openTeacherQuestions] = await Promise.all([
        weeklyTopQuestions(scope, week),
        stickingTopics(scope, week),
        unhelpfulAnswerCount(scope, week),
        openQuestionGroups(scope),
      ]);
      return saveWeek(
        teacherId,
        week,
        { topQuestions, stickingTopics: sticking, unhelpfulAnswers, openTeacherQuestions },
        method,
      );
    },

    /** The teacher's stored payload for that week, or null. */
    async getWeek(scope: TeacherScope, weekStart: string): Promise<InsightsWeek | null> {
      const method = 'insights.getWeek';
      const { teacherId } = teacherScope(scope, method);
      const { week } = weekWindow(weekStart, method);
      const [row] = await db
        .select({ week: insights.week, payload: insights.payload, updatedAt: insights.updatedAt })
        .from(insights)
        .where(and(eq(insights.teacherId, teacherId), eq(insights.week, week)));
      if (!row) return null;
      return {
        week: row.week,
        payload: checked(WeeklyInsightsPayloadSchema, row.payload, method),
        updatedAt: iso(row.updatedAt),
      };
    },
  };
}
