// Task 5.10 (§ Ask the teacher 5, Q2): the student's own read of a teacher's answer. In-app only
// (email and push wait, B-25); joined to the scope's own teacher_questions rows, so another
// student's notification is never readable, let alone another teacher's.
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client.js';
import { notifications, teacherQuestions } from '../schema/index.js';
import { RepositoryError } from './errors.js';
import { iso } from './map.js';
import { IdSchema, parseArg, studentScope, type StudentScope } from './scope.js';

/** Most notifications one `listForStudent` call returns. */
export const NOTIFICATIONS_MAX_LIMIT = 200;

const ListOptions = z.strictObject({
  unreadOnly: z.boolean(),
  limit: z.int().min(1).max(NOTIFICATIONS_MAX_LIMIT),
});

/** The scope's own notification, joined to the question it is about. */
export interface NotificationRow {
  id: string;
  kind: 'teacher_answer';
  questionId: string;
  questionText: string;
  answer: string | null;
  createdAt: string;
  readAt: string | null;
}

export function notificationsRepo(db: Db) {
  return {
    /**
     * The scope's own notifications, newest first (at most `limit`). `unreadOnly` filters to
     * `read_at is null`. Joined to the scope's own question (another scope's row never matches,
     * so a notification can't be read through a borrowed id).
     */
    async listForStudent(
      scope: StudentScope,
      options: { unreadOnly: boolean; limit: number },
    ): Promise<NotificationRow[]> {
      const method = 'notifications.listForStudent';
      const { studentId, teacherId } = studentScope(scope, method);
      const o = parseArg(ListOptions, options, method);
      const rows = await db
        .select({
          id: notifications.id,
          kind: notifications.kind,
          questionId: teacherQuestions.id,
          questionText: teacherQuestions.text,
          answer: teacherQuestions.answer,
          createdAt: notifications.createdAt,
          readAt: notifications.readAt,
        })
        .from(notifications)
        .innerJoin(
          teacherQuestions,
          and(
            eq(teacherQuestions.id, notifications.teacherQuestionId),
            eq(teacherQuestions.studentId, studentId),
            eq(teacherQuestions.teacherId, teacherId),
          ),
        )
        .where(
          and(
            eq(notifications.studentId, studentId),
            eq(notifications.teacherId, teacherId),
            o.unreadOnly ? isNull(notifications.readAt) : undefined,
          ),
        )
        .orderBy(desc(notifications.createdAt), desc(notifications.id))
        .limit(o.limit);
      return rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        questionId: r.questionId,
        questionText: r.questionText,
        answer: r.answer,
        createdAt: iso(r.createdAt),
        readAt: r.readAt === null ? null : iso(r.readAt),
      }));
    },

    /** Marks the scope's own notification read. Another student's, or a missing one, is `not_found`. */
    async markRead(scope: StudentScope, id: string): Promise<void> {
      const method = 'notifications.markRead';
      const { studentId, teacherId } = studentScope(scope, method);
      const notifId = parseArg(IdSchema, id, method);
      const [row] = await db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notifications.id, notifId),
            eq(notifications.studentId, studentId),
            eq(notifications.teacherId, teacherId),
          ),
        )
        .returning({ id: notifications.id });
      if (!row) throw new RepositoryError('not_found', method);
    },
  };
}
