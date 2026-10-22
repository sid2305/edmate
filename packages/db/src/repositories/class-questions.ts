// Task 11.2a (build plan § 11.2, Phase A): a student's pre-class question, fed into the
// teacher's own queue, grouped by topic the same lexical way 5.10 groups ask-the-teacher
// questions. `class_questions` and `live_classes` already exist (migration 0001); no schema
// change here (lead answer Q1-Q4, 22 Oct 2026).
import { randomUUID } from 'node:crypto';
import { LIMITS } from '@edmate/contracts';
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client.js';
import { classQuestions, liveClasses, packageVersions, subscriptions } from '../schema/index.js';
import { RepositoryError, translateWrite } from './errors.js';
import { iso } from './map.js';
import {
  clusterQuestions,
  type ClusterableQuestion,
} from './question-similarity.js';
import {
  IdSchema,
  parseArg,
  studentScope,
  teacherScope,
  type StudentScope,
  type TeacherScope,
} from './scope.js';

/** Subscription statuses that entitle a student to submit (same set 11.1a uses for reminders). */
const LIVE_SUBSCRIPTION_STATUSES = ['trial', 'active'] as const;

/** A hard cap on the open rows `listQueueForTeacher` reads before clustering them in memory
 * (same `GROUPING_SCAN_MAX`-style cap 5.10's `listGroupsForTeacher` uses). */
const QUEUE_SCAN_MAX = 200;

/** Most groups `listQueueForTeacher` returns. */
export const CLASS_QUESTION_GROUPS_MAX = 100;

const SubmitInputSchema = z.strictObject({
  liveClassId: IdSchema,
  text: z
    .string()
    .max(LIMITS.turnTextMaxLength)
    .refine((t) => t.trim().length > 0, 'not empty'),
});
export type SubmitClassQuestionInput = z.infer<typeof SubmitInputSchema>;

const QueueOptionsSchema = z.strictObject({
  limit: z.int().min(1).max(CLASS_QUESTION_GROUPS_MAX).optional(),
});
export interface ListQueueOptions {
  limit?: number;
}

/** One topic cluster of a teacher's own students' pre-class questions, biggest first, then
 * oldest. A cluster may span more than one of the teacher's classes (lead answer Q3). The table
 * carries no student id, so there is none to leak here. */
export interface TopicQuestionGroup {
  groupId: string;
  count: number;
  oldestAt: string;
  sample: string;
  liveClassIds: string[];
}

export function classQuestionsRepo(db: Db) {
  return {
    /**
     * Submits one question for one of the scope's own upcoming, entitled live classes: the
     * class's teacher must be the scope's own, the scope's student must hold a live
     * (`trial`/`active`) subscription to one of the class's packages, and the class must not
     * have started yet (`startsAt > now`) — the same entitlement/window
     * `liveClasses.listUpcomingForStudent` already checks (lead answer Q4). Anything else is
     * `not_found`, nothing written. Writes one `class_questions` row. Returns `{ id }`.
     */
    async submit(scope: StudentScope, input: SubmitClassQuestionInput): Promise<{ id: string }> {
      const method = 'classQuestions.submit';
      const { studentId, teacherId } = studentScope(scope, method);
      const i = parseArg(SubmitInputSchema, input, method);
      const id = randomUUID();

      return translateWrite(method, () =>
        db.transaction(async (tx) => {
          const now = new Date();
          const rows = await tx
            .select({ id: liveClasses.id })
            .from(liveClasses)
            .innerJoin(
              subscriptions,
              and(
                eq(subscriptions.teacherId, liveClasses.teacherId),
                eq(subscriptions.studentId, studentId),
              ),
            )
            .innerJoin(packageVersions, eq(packageVersions.id, subscriptions.packageVersionId))
            .where(
              and(
                eq(liveClasses.id, i.liveClassId),
                eq(liveClasses.teacherId, teacherId),
                gt(liveClasses.startsAt, now),
                inArray(subscriptions.status, [...LIVE_SUBSCRIPTION_STATUSES]),
                sql`${packageVersions.packageId} = any(${liveClasses.packageIds})`,
              ),
            )
            // Key-share locks the matched subscriptions row so a concurrent cancel/downgrade
            // (which takes FOR NO KEY UPDATE) must wait until this insert commits, closing the
            // entitlement-check-to-insert TOCTOU window.
            .for('key share');
          if (rows.length === 0) throw new RepositoryError('not_found', method);

          await tx.insert(classQuestions).values({
            id,
            liveClassId: i.liveClassId,
            text: i.text.trim(),
          });
          return { id };
        }),
      );
    },

    /**
     * The teacher's own classes' pending (`startsAt > now`) pre-class questions, clustered by
     * topic the same lexical way 5.10 groups ask-the-teacher questions, biggest group first then
     * oldest. Another teacher's classes never appear. The result carries no student id — the
     * table has none.
     */
    async listQueueForTeacher(
      scope: TeacherScope,
      options?: ListQueueOptions,
    ): Promise<TopicQuestionGroup[]> {
      const method = 'classQuestions.listQueueForTeacher';
      const { teacherId } = teacherScope(scope, method);
      const { limit } = parseArg(QueueOptionsSchema, options ?? {}, method);
      const now = new Date();

      const rows = await db
        .select({
          id: classQuestions.id,
          text: classQuestions.text,
          createdAt: classQuestions.createdAt,
          liveClassId: classQuestions.liveClassId,
        })
        .from(classQuestions)
        .innerJoin(liveClasses, eq(liveClasses.id, classQuestions.liveClassId))
        .where(and(eq(liveClasses.teacherId, teacherId), gt(liveClasses.startsAt, now)))
        // Scan oldest-first so the cap keeps the longest-waiting questions when a teacher has
        // more than QUEUE_SCAN_MAX pending: a DESC scan would drop the oldest ones instead
        // (review finding, 11.2a fix round 1).
        .orderBy(asc(classQuestions.createdAt), asc(classQuestions.id))
        .limit(QUEUE_SCAN_MAX);

      const byId = new Map(rows.map((r) => [r.id, r]));
      const clusterable: ClusterableQuestion[] = rows.map((r) => ({
        id: r.id,
        text: r.text,
        createdAt: r.createdAt,
      }));
      const clusters = clusterQuestions(clusterable);

      // `clusterQuestions` already sorts its input oldest-first (tie-broken by id) before
      // clustering, so each cluster's own `ids` come out in that same order; its first id is
      // always this group's oldest member, with no need to re-sort here.
      const groups: TopicQuestionGroup[] = clusters.map((c) => {
        const members = c.ids.map((id) => byId.get(id)!);
        const oldest = members[0]!;
        return {
          groupId: c.groupId,
          count: members.length,
          oldestAt: iso(oldest.createdAt),
          sample: oldest.text,
          liveClassIds: [...new Set(members.map((m) => m.liveClassId))].sort(),
        };
      });

      return groups.slice(0, limit ?? CLASS_QUESTION_GROUPS_MAX);
    },
  };
}
