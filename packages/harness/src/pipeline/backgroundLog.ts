// Logs every `TurnRunResult.background` failure (task 3.7, lead answer Q7): the task, the ids,
// the error's name, and its message only for the harness's own errors (HarnessError); a foreign
// error's message can quote prompt or student text. The ids come from the input before any step
// checked them, so each is logged only when it is a valid id.
import { EntitlementSchema } from '@edmate/contracts';
import { errorName, HarnessError } from './errors.js';
import type { BackgroundFailureLog, TurnLog, TurnRunResult } from './types.js';

/** Error messages are cut to this many UTF-16 units. */
export const BACKGROUND_LOG_MESSAGE_MAX = 300;

const IdSchema = EntitlementSchema.shape.agentId;
const safeId = (v: unknown): string => (IdSchema.safeParse(v).success ? (v as string) : 'invalid');

export function backgroundLogEntry(
  b: TurnRunResult['background'][number],
  ids: { turnId: string; sessionId: unknown; agentId: unknown; studentId: unknown },
): BackgroundFailureLog {
  const e = b.error;
  return {
    task: b.task,
    ...(ids.turnId === '' ? {} : { turnId: ids.turnId }),
    sessionId: safeId(ids.sessionId),
    agentId: safeId(ids.agentId),
    studentId: safeId(ids.studentId),
    errorName: errorName(e),
    // Foreign errors (provider, port, store, tool) can quote prompt or student text: name only.
    errorMessage: e instanceof HarnessError ? e.message.slice(0, BACKGROUND_LOG_MESSAGE_MAX) : '',
  };
}

/** One log call per failure. Never throws: a failing logger has nowhere else to report. */
export function logBackground(
  log: TurnLog | undefined,
  ids: Parameters<typeof backgroundLogEntry>[1],
  background: TurnRunResult['background'],
): void {
  for (const b of background) {
    try {
      log?.backgroundFailure(backgroundLogEntry(b, ids));
    } catch {
      // Nothing to do: the failure is still in `finished.background`.
    }
  }
}
