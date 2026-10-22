// Task 8.5 (§ Staying true to the teacher "Corrections"): a teacher marks an agent answer wrong in
// the test chat and writes the right one. One transaction keeps the record of what was wrong
// (`corrections`) and turns the right answer into a teacher note + eval case (`insertTeacherNote`,
// chunks.ts: the only file besides retrieval.ts allowed to name the chunks table).
import { randomUUID } from 'node:crypto';
import { teacherNoteParts } from '@edmate/harness';
import { z } from 'zod';
import type { Db } from '../client.js';
import { corrections } from '../schema/index.js';
import { insertTeacherNote } from './chunks.js';
import { RepositoryError, translateWrite } from './errors.js';
import { IdSchema, parseArg, teacherScope, type TeacherScope } from './scope.js';

const CorrectionInputSchema = z.strictObject({
  moduleId: IdSchema,
  question: z.string(),
  badAnswer: z.string(),
  correctedAnswer: z.string(),
});
/** What the teacher's correction form sends (task 8.5). */
export type CorrectionRecordInput = z.infer<typeof CorrectionInputSchema>;

/** What `corrections.record` wrote: the correction, its teacher-note chunk and its eval case. */
export interface CorrectionRecordResult {
  correctionId: string;
  chunkId: string;
  evalCaseId: string;
}

export function correctionsRepo(db: Db) {
  return {
    /**
     * Records the scope's teacher's correction of an agent answer, in one transaction: the
     * teacher note (`insertTeacherNote`, origin 'correction': a `documents` row, its chunk, a
     * `teacher_eval_cases` row, a material-revision bump) and then one `corrections` row.
     * `moduleId` must be one of the teacher's own modules (`insertTeacherNote`'s `INSERT …
     * SELECT FROM modules WHERE id AND teacher_id`; a missing or another teacher's module is
     * `not_found` and nothing is written). Each text must be non-empty after trimming and within
     * `TEACHER_NOTE_PART_MAX` (= `LIMITS.turnTextMaxLength`), checked by `teacherNoteParts` before
     * any SQL (`invalid`); the stored texts are the trimmed ones.
     */
    async record(
      scope: TeacherScope,
      input: CorrectionRecordInput,
    ): Promise<CorrectionRecordResult> {
      const method = 'corrections.record';
      const { teacherId } = teacherScope(scope, method);
      const i = parseArg(CorrectionInputSchema, input, method);
      const right = teacherNoteParts({ question: i.question, answer: i.correctedAnswer });
      const wrong = teacherNoteParts({ question: i.question, answer: i.badAnswer });
      if (right === null || wrong === null) throw new RepositoryError('invalid', method);

      return translateWrite(method, () =>
        db.transaction(async (tx) => {
          // First: its INSERT … SELECT is the module ownership check (not_found rolls back).
          const note = await insertTeacherNote(
            tx,
            teacherId,
            {
              moduleId: i.moduleId,
              question: right.question,
              answer: right.answer,
              origin: 'correction',
            },
            method,
          );
          const correctionId = randomUUID();
          await tx.insert(corrections).values({
            id: correctionId,
            teacherId,
            moduleId: i.moduleId,
            question: right.question,
            badAnswer: wrong.answer,
            correctedAnswer: right.answer,
          });
          return { correctionId, ...note };
        }),
      );
    },
  };
}
