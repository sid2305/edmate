// Step 11, commit (tasks 3.8, 3.17): persists what the turn produced, through ports only.
// 1. The scrubbed student message (when the scrub passed and the input had text; a placeholder
//    when a pre guard blocked it, task 4.4), timestamped
//    when the turn started, with an id drawn here once (a worker retry replays the same job).
// 2. The agent's reply (when the student was shown one), with the `done` event's message id.
// 3. A grounding escalation's TeacherQuestion (4.7, `escalateToTeacher`) when the live attempt
//    left `teacherQuestionId` unset, BEFORE the help state is saved: only an open that succeeds
//    counts toward the session's cap (fix round 1). When it fails too, the escalation is lost:
//    the step finishes the rest, then fails with GroundingEscalationLost (error name only).
// 4. The session's next help state (when decide produced one), via SessionStateStore only.
// 5. Learner-profile evidence (when the turn produced any — task 3.17), via `profiles.applyEvidence`.
// 5b. Mistake tags (task 6.3c): known tags via `profiles.applyMistakes` (optional port methods,
//     a safe no-op for an implementer that hasn't landed them yet), proposed tags also via
//     `profiles.recordProposedMistakes`.
// 6. The TeacherQuestion for an `ask_teacher` turn, as a fallback, when the live (3.7) attempt
//    left `teacherQuestionId` unset (its own open timed out or failed) — never a second question
//    when it is already set (`teacherQuestion.ts`'s shared, idempotent open).
//
// The answer key lives in `record.next` and in `record.decision` (systemPrompt, mustNotReveal);
// it goes to saveHelpState and nowhere else (ADR-0005): messages, evidence and the TeacherQuestion
// carry only `input.text` (scrubbed, or its blocked placeholder, task 4.4) and `replyText` — never
// the answer key or locked text. In production the ports are queue-backed (@edmate/queue): this
// resolves once the jobs are enqueued, never on the database write.
import { serializeSessionHelp, withGroundingAsks } from '../../pedagogy/helpState.js';
import { errorName, GroundingEscalationLost } from '../errors.js';
import { withheldMessage } from '../policies.js';
import { openTeacherQuestion } from '../teacherQuestion.js';
import type { Steps } from '../types.js';

export const commit: Steps['commit'] = async (env, record) => {
  const { transcripts, sessionState, profiles, teacherQuestions, ids } = env.deps;
  // A blocked input is saved as a placeholder, never its text (4.4 fix round).
  const text =
    record.input?.text === undefined
      ? undefined
      : record.inputWithheld === true
        ? withheldMessage(record.withheldCode)
        : record.input.text;
  const asks = text !== undefined && text.trim() !== '' && record.teacherQuestionId === undefined;
  if (text !== undefined) {
    await transcripts.append(record.sessionId, {
      id: ids.next('message'),
      role: 'student',
      text,
      createdAt: record.receivedAt,
    });
  }
  if (record.replyText !== undefined) {
    await transcripts.append(record.sessionId, {
      id: record.messageId,
      role: 'agent',
      text: record.replyText,
      createdAt: record.createdAt,
    });
  }
  let next = record.next;
  let lost: GroundingEscalationLost | undefined;
  if (asks && record.escalateToTeacher === true && record.decision?.move !== 'ask_teacher') {
    try {
      await openTeacherQuestion(teacherQuestions, record.entitled.entitlement, text);
      if (next !== undefined) next = withGroundingAsks(next, (next.help.groundingAsks ?? 0) + 1);
    } catch (error) {
      lost = new GroundingEscalationLost(errorName(error));
    }
  }
  if (next !== undefined) {
    await sessionState.saveHelpState(record.sessionId, serializeSessionHelp(next));
  }
  if (record.evidence !== undefined && record.evidence.length > 0) {
    await profiles.applyEvidence(record.evidence);
  }
  const known = record.mistakesKnown ?? [];
  const proposed = record.mistakesProposed ?? [];
  if (known.length > 0 || proposed.length > 0) {
    const scope = {
      studentId: record.entitled.entitlement.studentId,
      teacherId: record.entitled.entitlement.teacherId,
    };
    await profiles.applyMistakes?.(scope, known, proposed);
    if (proposed.length > 0) await profiles.recordProposedMistakes?.(scope, proposed);
  }
  if (asks && record.decision?.move === 'ask_teacher') {
    await openTeacherQuestion(teacherQuestions, record.entitled.entitlement, text);
  }
  if (lost !== undefined) throw lost;
};
