import { randomUUID } from 'node:crypto';
import { LIMITS, TeacherQuestionSchema, type TeacherQuestion } from '@edmate/contracts';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client.js';
import { agents, teacherQuestions } from '../schema/index.js';
import { RepositoryError, translateWrite } from './errors.js';
import { insertSelect, written } from './insert.js';
import {
  toTeacherQuestion,
  toTeacherQuestionForTeacher,
  type TeacherQuestionForTeacher,
} from './map.js';
import {
  IdSchema,
  parseArg,
  studentScope,
  teacherScope,
  type StudentScope,
  type TeacherScope,
} from './scope.js';

/** Largest page of questions. */
export const QUESTIONS_MAX_LIMIT = 200;

const ListOptions = z.strictObject({
  status: TeacherQuestionSchema.shape.status,
  limit: z.int().min(1).max(QUESTIONS_MAX_LIMIT),
});

const NewQuestion = z.strictObject({
  agentId: IdSchema,
  text: z
    .string()
    .max(LIMITS.turnTextMaxLength)
    .refine((t) => t.trim().length > 0, 'not empty'),
  moduleHint: TeacherQuestionSchema.shape.moduleHint,
  similarIds: z.array(IdSchema),
});

const common = {
  id: teacherQuestions.id,
  teacherId: teacherQuestions.teacherId,
  agentId: teacherQuestions.agentId,
  text: teacherQuestions.text,
  moduleHint: teacherQuestions.moduleHint,
  similarIds: teacherQuestions.similarIds,
  status: teacherQuestions.status,
  createdAt: teacherQuestions.createdAt,
  answeredAt: teacherQuestions.answeredAt,
};

export function teacherQuestionsRepo(db: Db) {
  return {
    /**
     * The teacher's inbox: newest first. The asking student is never selected (the column is not
     * in the SELECT list), so the teacher can't see who asked.
     */
    async listForTeacher(
      scope: TeacherScope,
      options: { status: TeacherQuestion['status']; limit: number },
    ): Promise<TeacherQuestionForTeacher[]> {
      const method = 'teacherQuestions.listForTeacher';
      const { teacherId } = teacherScope(scope, method);
      const { status, limit } = parseArg(ListOptions, options, method);
      const rows = await db
        .select(common)
        .from(teacherQuestions)
        .where(and(eq(teacherQuestions.teacherId, teacherId), eq(teacherQuestions.status, status)))
        .orderBy(desc(teacherQuestions.createdAt), desc(teacherQuestions.id))
        .limit(limit);
      return rows.map((r) => toTeacherQuestionForTeacher(r, method));
    },

    /**
     * Opens a question from the scope's student to one of the scope's teacher's agents (another
     * teacher's agent is `not_found`). Every `similarIds` entry must be one of that teacher's
     * questions (`scope`).
     */
    async open(
      scope: StudentScope,
      input: { agentId: string; text: string; moduleHint?: string; similarIds: string[] },
    ): Promise<TeacherQuestion> {
      const method = 'teacherQuestions.open';
      const { studentId, teacherId } = studentScope(scope, method);
      const q = parseArg(NewQuestion, input, method);
      const similarIds = [...new Set(q.similarIds)];
      const id = randomUUID();
      const createdAt = new Date().toISOString();

      await translateWrite(method, () =>
        db.transaction(async (tx) => {
          if (similarIds.length > 0) {
            const owned = await tx
              .select({ id: teacherQuestions.id })
              .from(teacherQuestions)
              .where(
                and(
                  eq(teacherQuestions.teacherId, teacherId),
                  inArray(teacherQuestions.id, similarIds),
                ),
              )
              .for('key share');
            if (owned.length !== similarIds.length) throw new RepositoryError('scope', method);
          }
          const result = await tx.execute(
            insertSelect(
              teacherQuestions,
              [
                [teacherQuestions.id, sql`${id}::text`],
                [teacherQuestions.teacherId, sql`${agents.teacherId}`],
                [teacherQuestions.agentId, sql`${agents.id}`],
                [teacherQuestions.studentId, sql`${studentId}::text`],
                [teacherQuestions.text, sql`${q.text}::text`],
                [teacherQuestions.moduleHint, sql`${q.moduleHint ?? null}::text`],
                // sql.param binds one text[] value (a bare array in a template expands to a list).
                [teacherQuestions.similarIds, sql`${sql.param(similarIds)}::text[]`],
                [teacherQuestions.createdAt, sql`${createdAt}::timestamptz`],
              ],
              sql`from ${agents} where ${and(eq(agents.id, q.agentId), eq(agents.teacherId, teacherId))}`,
            ),
          );
          if (written(result) !== 1) throw new RepositoryError('not_found', method);
        }),
      );
      return toTeacherQuestion(
        {
          id,
          teacherId,
          agentId: q.agentId,
          studentId,
          text: q.text,
          moduleHint: q.moduleHint ?? null,
          similarIds,
          status: 'open',
          createdAt: new Date(createdAt),
          answeredAt: null,
        },
        method,
      );
    },

    /** The scope's own questions to this teacher, newest first (at most 200). */
    async listForStudent(scope: StudentScope): Promise<TeacherQuestion[]> {
      const method = 'teacherQuestions.listForStudent';
      const { studentId, teacherId } = studentScope(scope, method);
      const rows = await db
        .select({ ...common, studentId: teacherQuestions.studentId })
        .from(teacherQuestions)
        .where(
          and(eq(teacherQuestions.studentId, studentId), eq(teacherQuestions.teacherId, teacherId)),
        )
        .orderBy(desc(teacherQuestions.createdAt), desc(teacherQuestions.id))
        .limit(QUESTIONS_MAX_LIMIT);
      return rows.map((r) => toTeacherQuestion(r, method));
    },
  };
}
