// Step 11, commit (task 3.8): persists what the turn produced, through ports only.
// 1. The scrubbed student message (when the scrub passed and the input had text; a placeholder
//    when a pre guard blocked it, task 4.4), timestamped
//    when the turn started, with an id drawn here once (a worker retry replays the same job).
// 2. The agent's reply (when the student was shown one), with the `done` event's message id.
// 3. The session's next help state (when decide produced one), via SessionStateStore only.
//
// The answer key lives in `record.next` and in `record.decision` (systemPrompt, mustNotReveal);
// it goes to saveHelpState and nowhere else (ADR-0005): messages carry only `input.text` and
// `replyText`. In production the ports are queue-backed (@edmate/queue): this resolves once the
// jobs are enqueued, never on the database write. TeacherQuestion for `ask_teacher` and learner
// memory are task 3.17.
import { serializeSessionHelp } from '../../pedagogy/helpState.js';
import { WITHHELD_MESSAGE } from '../policies.js';
import type { Steps } from '../types.js';

export const commit: Steps['commit'] = async (env, record) => {
  const { transcripts, sessionState, ids } = env.deps;
  // A blocked input is saved as a placeholder, never its text (4.4 fix round).
  const text =
    record.input?.text === undefined
      ? undefined
      : record.inputWithheld === true
        ? WITHHELD_MESSAGE
        : record.input.text;
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
  if (record.next !== undefined) {
    await sessionState.saveHelpState(record.sessionId, serializeSessionHelp(record.next));
  }
};
