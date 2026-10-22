// Task 11.3a: weekly teacher insights (build plan § 11.3, PRD "Weekly insights"). Four aggregate
// reads over one teacher's own rows and an upsert of the week's payload into `insights`.
//
// Privacy floor (lead answer, 22 Oct 2026): every aggregate needs at least INSIGHTS_MIN_STUDENTS
// **distinct students**, never rows. The floor is enforced here, in SQL (`having count(distinct
// student_id) >= 5`), so no caller can read a smaller group; `saveWeek`'s schema refuses a payload
// under the floor as a second line. No read selects or returns a student id: `student_id` appears
// only inside `count(distinct …)`.
import { and, asc, desc, eq, gte, sql, type SQL } from 'drizzle-orm';
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
import { translateWrite } from './errors.js';
import { checked, iso } from './map.js';
import { IdSchema, parseArg, teacherScope, type TeacherScope } from './scope.js';

/** The smallest number of distinct students any aggregate may describe. */
export const INSIGHTS_MIN_STUDENTS = 5;
/** Most groups or topics in each list. */
export const INSIGHTS_TOP_N = 5;
/** A group's sample question text is cut to this many characters. */
export const INSIGHTS_SAMPLE_MAX_LENGTH = 280;

const Since = z.iso.datetime({ offset: true });
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
    oldestAt: z.iso.datetime({ offset: true }),
    sample: z.string().max(INSIGHTS_SAMPLE_MAX_LENGTH),
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

export function insightsRepo(db: Db) {
  /**
   * The teacher's question groups (a row's `group_id`, or its own id when null — the grouping
   * `teacherQuestions.open` writes), each asked by at least INSIGHTS_MIN_STUDENTS distinct students;
   * most students first, then most questions, then oldest. `extra` narrows the rows.
   */
  async function questionGroups(teacherId: string, extra: SQL): Promise<InsightQuestionGroup[]> {
    const group = sql<string>`coalesce(${teacherQuestions.groupId}, ${teacherQuestions.id})`;
    const students = sql<number>`count(distinct ${teacherQuestions.studentId})::int`;
    const questions = sql<number>`count(*)::int`;
    const oldest = sql<Date>`min(${teacherQuestions.createdAt})`.mapWith(
      teacherQuestions.createdAt,
    );
    const rows = await db
      .select({
        groupId: group,
        students,
        questions,
        oldestAt: oldest,
        sample: sql<string>`left((array_agg(${teacherQuestions.text} order by ${teacherQuestions.createdAt}, ${teacherQuestions.id}))[1], ${INSIGHTS_SAMPLE_MAX_LENGTH})`,
      })
      .from(teacherQuestions)
      .where(and(eq(teacherQuestions.teacherId, teacherId), extra))
      .groupBy(group)
      .having(atLeastFloor(students))
      .orderBy(desc(students), desc(questions), asc(oldest), asc(group))
      .limit(INSIGHTS_TOP_N);
    return rows.map((r) => ({ ...r, oldestAt: iso(r.oldestAt) }));
  }

  return {
    /** Question groups opened since `since` (any status): what students asked most this week. */
    async weeklyTopQuestions(scope: TeacherScope, since: string): Promise<InsightQuestionGroup[]> {
      const method = 'insights.weeklyTopQuestions';
      const { teacherId } = teacherScope(scope, method);
      const from = new Date(parseArg(Since, since, method));
      return questionGroups(teacherId, gte(teacherQuestions.createdAt, from));
    },

    /** Question groups still open now (the teacher hasn't answered), at any age. */
    async openQuestionGroups(scope: TeacherScope): Promise<InsightQuestionGroup[]> {
      const method = 'insights.openQuestionGroups';
      const { teacherId } = teacherScope(scope, method);
      return questionGroups(teacherId, eq(teacherQuestions.status, 'open'));
    },

    /**
     * Topics that at least INSIGHTS_MIN_STUDENTS distinct students got wrong since `since`
     * (`evidence_events.correct = false`, by event time `ts`); most students first.
     */
    async stickingTopics(scope: TeacherScope, since: string): Promise<StickingTopic[]> {
      const method = 'insights.stickingTopics';
      const { teacherId } = teacherScope(scope, method);
      const from = new Date(parseArg(Since, since, method));
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
            eq(evidenceEvents.correct, false),
            gte(evidenceEvents.ts, from),
          ),
        )
        .groupBy(evidenceEvents.topicId, topics.title)
        .having(atLeastFloor(students))
        .orderBy(desc(students), desc(misses), asc(evidenceEvents.topicId))
        .limit(INSIGHTS_TOP_N);
    },

    /**
     * Turns since `since` that the agent couldn't answer well: the `ask_teacher` move, or a
     * `grounding` guard entry with `ok: false` (plan decision 3; there is no rating feature yet).
     * Null, never a smaller number, when fewer than INSIGHTS_MIN_STUDENTS distinct students had one.
     */
    async unhelpfulAnswerCount(scope: TeacherScope, since: string): Promise<number | null> {
      const method = 'insights.unhelpfulAnswerCount';
      const { teacherId } = teacherScope(scope, method);
      const from = new Date(parseArg(Since, since, method));
      const students = sql<number>`count(distinct ${sessions.studentId})::int`;
      const [row] = await db
        .select({ turns: sql<number>`count(*)::int` })
        .from(turnTraces)
        .innerJoin(sessions, eq(sessions.id, turnTraces.sessionId))
        .where(
          and(
            eq(sessions.teacherId, teacherId),
            gte(turnTraces.createdAt, from),
            sql`(${turnTraces.move} = 'ask_teacher' or exists (
              select 1 from jsonb_array_elements(${turnTraces.guards}) as g
              where g->>'name' = 'grounding' and g->'ok' = 'false'::jsonb))`,
          ),
        )
        .having(atLeastFloor(students));
      return row ? row.turns : null;
    },

    /** Stores the week's payload, replacing any earlier one for that teacher and week. */
    async saveWeek(
      scope: TeacherScope,
      weekStart: string,
      payload: WeeklyInsightsPayload,
    ): Promise<InsightsWeek> {
      const method = 'insights.saveWeek';
      const { teacherId } = teacherScope(scope, method);
      const week = parseArg(WeekStart, weekStart, method);
      const p = parseArg(WeeklyInsightsPayloadSchema, payload, method);
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
    },

    /** The teacher's stored payload for that week, or null. */
    async getWeek(scope: TeacherScope, weekStart: string): Promise<InsightsWeek | null> {
      const method = 'insights.getWeek';
      const { teacherId } = teacherScope(scope, method);
      const week = parseArg(WeekStart, weekStart, method);
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
