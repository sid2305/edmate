import { asc, eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import { teacherEvalCases } from '../schema/index.js';
import { RepositoryError } from './errors.js';
import { teacherScope, type TeacherScope } from './scope.js';

/**
 * Most rows `teacherEvalCases.listForTeacher` returns. More than this is `invalid`, never a
 * truncated list: the quality gate (task 7.4) turns these rows into per-agent accuracy cases, and
 * a silently cut suite would let a publish pass on cases it never ran.
 */
export const TEACHER_EVAL_CASES_MAX = 10_000;

/** One teacher answer or correction, as the quality gate reads it (no teacher id, no chunk id). */
export interface TeacherEvalCaseRow {
  id: string;
  moduleId: string;
  question: string;
  answer: string;
  origin: 'teacher_answer' | 'correction';
}

/** Task 7.4: read path for task 5.10's `teacher_eval_cases` rows. Read-only. */
export function teacherEvalCasesRepo(db: Db) {
  return {
    /**
     * Every `teacher_eval_cases` row of the scope's teacher, ordered `created_at ASC, id ASC`.
     * Fetches `TEACHER_EVAL_CASES_MAX + 1` rows; if the extra row exists the call throws
     * `RepositoryError('invalid')` instead of returning a partial suite.
     */
    async listForTeacher(scope: TeacherScope): Promise<TeacherEvalCaseRow[]> {
      const method = 'teacherEvalCases.listForTeacher';
      const { teacherId } = teacherScope(scope, method);
      const rows = await db
        .select({
          id: teacherEvalCases.id,
          moduleId: teacherEvalCases.moduleId,
          question: teacherEvalCases.question,
          answer: teacherEvalCases.answer,
          origin: teacherEvalCases.origin,
        })
        .from(teacherEvalCases)
        .where(eq(teacherEvalCases.teacherId, teacherId))
        .orderBy(asc(teacherEvalCases.createdAt), asc(teacherEvalCases.id))
        .limit(TEACHER_EVAL_CASES_MAX + 1);
      if (rows.length > TEACHER_EVAL_CASES_MAX) throw new RepositoryError('invalid', method);
      return rows;
    },
  };
}
