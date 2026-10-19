// SessionStateStore on the commit queue (task 3.8, ADR-0005). The help state holds the answer
// key: it rides only in this job's payload, which nothing logs, and the dead-letter entry leaves
// it out. A value over LIMITS.helpStateMaxJsonLength (or not serialisable) is refused here, before
// it reaches Redis; the db adapter checks again before writing.
//
// The port has no turn id, so each save gets a fresh write id for its job id (saves are last
// write wins; a retry reuses its own job, never a newer one).
import { randomUUID } from 'node:crypto';
import { LIMITS, type SessionStateStore } from '@edmate/contracts';
import {
  bindScope,
  type HelpStateJob,
  HelpStateJobSchema,
  JOB,
  type JobQueue,
  type JobScope,
  jobId,
  jobOptions,
} from './queues.js';

function withinCap(value: unknown): boolean {
  try {
    const json = JSON.stringify(value);
    return json !== undefined && json.length <= LIMITS.helpStateMaxJsonLength;
  } catch {
    return false;
  }
}

export function queuedSessionStateStore(
  queue: JobQueue,
  scope: JobScope,
  opts: { writeId?: () => string } = {},
): SessionStateStore {
  const bound = bindScope(scope, 'queuedSessionStateStore');
  const writeId = opts.writeId ?? randomUUID;
  return {
    async saveHelpState(sessionId, helpState) {
      if (!withinCap(helpState)) {
        throw new RangeError('help state not serialisable or over LIMITS.helpStateMaxJsonLength');
      }
      const data: HelpStateJob = HelpStateJobSchema.parse({ scope: bound, sessionId, helpState });
      await queue.add(
        JOB.helpState,
        data,
        jobOptions(jobId.helpState(data.sessionId, writeId()), JOB.helpState),
      );
    },
  };
}
