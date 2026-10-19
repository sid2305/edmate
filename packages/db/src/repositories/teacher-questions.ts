import { randomUUID } from 'node:crypto';
import { LIMITS, TeacherQuestionSchema, type TeacherQuestion } from '@edmate/contracts';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client.js';
import { agents, teacherQuestions } from '../schema/index.js';
import { RepositoryError, translateWrite } from './errors.js';
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
     *
     * Insert-or-return-existing (task 3.17, migration 0011's partial unique index on
     * `(teacher_id, student_id, agent_id, md5(text))` where `status = 'open'`): the live (3.7)
     * attempt and commit's fallback (3.17) can both try to open "the same" question for one turn
     * (a timed-out live attempt may still land), so a second identical open converges on the
     * first row — `similarIds` and `moduleHint` from a second, redundant call are discarded; the
     * first open's are kept.
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

      const row = await translateWrite(method, () =>
        db.transaction(async (tx) => {
          const [owner] = await tx
            .select({ id: agents.id })
            .from(agents)
            .where(and(eq(agents.id, q.agentId), eq(agents.teacherId, teacherId)))
            .for('key share');
          if (!owner) throw new RepositoryError('not_found', method);

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

          // Drizzle's onConflictDoNothing() only infers a conflict target from plain columns
          // (drizzle-orm/pg-core's PgInsertBase.onConflictDoNothing types `target` as
          // IndexColumn | IndexColumn[]), not an expression like migration 0011's `md5(text)`;
          // Postgres itself requires `ON CONFLICT`'s target to match the index expression
          // exactly (else `42P10 invalid_column_reference`), so this is a raw insert — with bare
          // (table-unqualified) column names via `sql.identifier` in both the column list and the
          // conflict target: an INSERT's column list and ON CONFLICT target both reject a
          // table-qualified name (`"teacher_questions"."id"`) with a plain syntax error (`42601`).
          const col = (c: { name: string }) => sql.identifier(c.name);
          await tx.execute(sql`
            insert into ${teacherQuestions}
              (${col(teacherQuestions.id)}, ${col(teacherQuestions.teacherId)},
               ${col(teacherQuestions.agentId)}, ${col(teacherQuestions.studentId)},
               ${col(teacherQuestions.text)}, ${col(teacherQuestions.moduleHint)},
               ${col(teacherQuestions.similarIds)}, ${col(teacherQuestions.createdAt)})
            values (
              ${id}::text, ${teacherId}::text, ${q.agentId}::text, ${studentId}::text,
              ${q.text}::text, ${q.moduleHint ?? null}::text,
              ${sql.param(similarIds)}::text[], ${createdAt}::timestamptz
            )
            on conflict (
              ${col(teacherQuestions.teacherId)}, ${col(teacherQuestions.studentId)},
              ${col(teacherQuestions.agentId)}, md5(${col(teacherQuestions.text)})
            ) where ${col(teacherQuestions.status)} = 'open'
            do nothing
          `);

          // Either the row this call just inserted, or the open row it collided with: the WHERE
          // below names exactly the dedup index's key (plus `status = 'open'`, its predicate), so
          // one of those two always matches; there is no third outcome to handle.
          const [existing] = await tx
            .select(common)
            .from(teacherQuestions)
            .where(
              and(
                eq(teacherQuestions.teacherId, teacherId),
                eq(teacherQuestions.studentId, studentId),
                eq(teacherQuestions.agentId, q.agentId),
                eq(teacherQuestions.text, q.text),
                eq(teacherQuestions.status, 'open'),
              ),
            )
            .limit(1);
          return existing!;
        }),
      );
      return toTeacherQuestion({ ...row, studentId }, method);
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
