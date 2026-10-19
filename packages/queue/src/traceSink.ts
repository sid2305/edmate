// TraceSink on the commit queue (task 3.8): one job per turn, id `<turnId>.trace`.
import { type TraceSink, TurnTraceSchema } from '@edmate/contracts';
import {
  bindScope,
  JOB,
  type JobQueue,
  type JobScope,
  jobId,
  jobOptions,
  type TraceJob,
} from './queues.js';

export function queuedTraceSink(queue: JobQueue, scope: JobScope): TraceSink {
  const bound = bindScope(scope, 'queuedTraceSink');
  return {
    async record(t) {
      const data: TraceJob = { scope: bound, trace: TurnTraceSchema.parse(t) };
      await queue.add(JOB.trace, data, jobOptions(jobId.trace(data.trace.turnId), JOB.trace));
    },
  };
}
