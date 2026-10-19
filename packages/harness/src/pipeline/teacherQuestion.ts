// findSimilar then open (build plan § Ask the teacher), shared by the runner's live attempt (3.7,
// within one budget, inside the turn) and commit's fallback (3.17, after `done`, when the live
// attempt left no id): one path, so both ways of opening a TeacherQuestion for an ask_teacher turn
// validate the same way. Throws on any store failure or scope mismatch; the caller decides what
// that means (the runner reports it and sends no id; commit lets it fail the background step).
import { type TeacherQuestionStore, TeacherQuestionSchema } from '@edmate/contracts';
import { z } from 'zod';
import { HarnessError } from './errors.js';

/** The ids `open` must come back scoped to: a turn's agent, teacher and student. */
export interface TeacherQuestionScope {
  teacherId: string;
  agentId: string;
  studentId: string;
}

const SimilarQuestionsSchema = z.array(TeacherQuestionSchema);

/**
 * Opens `scope`'s TeacherQuestion for `text` (the scrubbed input; never raw text), returning its
 * id. `text` must be non-empty (callers check before calling: see `runner.ts` and `commit.ts`).
 */
export async function openTeacherQuestion(
  store: TeacherQuestionStore,
  scope: TeacherQuestionScope,
  text: string,
): Promise<string> {
  const similar = SimilarQuestionsSchema.parse(await store.findSimilar(scope.teacherId, text));
  if (similar.some((q) => q.teacherId !== scope.teacherId)) {
    throw new HarnessError("TeacherQuestionStore.findSimilar returned another teacher's question");
  }
  const q = TeacherQuestionSchema.parse(
    await store.open({
      teacherId: scope.teacherId,
      agentId: scope.agentId,
      studentId: scope.studentId,
      text,
      similarIds: [...new Set(similar.map((s) => s.id))],
    }),
  );
  if (
    q.teacherId !== scope.teacherId ||
    q.agentId !== scope.agentId ||
    q.studentId !== scope.studentId
  ) {
    throw new HarnessError('TeacherQuestionStore.open returned a question for another turn');
  }
  return q.id;
}
