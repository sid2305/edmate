// TranscriptStore whose `append` goes through the commit queue (task 3.8). `history` is a read
// the turn needs now, so it goes to the given reader (the direct @edmate/db store). The job id is
// the message id, so a retried job (or a second add of the same message) never writes twice.
import { MessageSchema, type TranscriptStore } from '@edmate/contracts';
import {
  bindScope,
  JOB,
  type JobQueue,
  type JobScope,
  jobId,
  jobOptions,
  type MessageJob,
  MessageJobSchema,
} from './queues.js';

export function queuedTranscriptStore(
  queue: JobQueue,
  scope: JobScope,
  reader: Pick<TranscriptStore, 'history'>,
): TranscriptStore {
  const bound = bindScope(scope, 'queuedTranscriptStore');
  return {
    history: (sessionId, limit) => reader.history(sessionId, limit),
    async append(sessionId, m) {
      const data: MessageJob = MessageJobSchema.parse({
        scope: bound,
        sessionId,
        message: MessageSchema.parse(m),
      });
      await queue.add(JOB.message, data, jobOptions(jobId.message(data.message.id), JOB.message));
    },
  };
}
