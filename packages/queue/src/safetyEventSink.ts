// SafetyEventSink on the safety-event queue (task 4.4, ADR-0006). `record` resolves once the job is
// durably in Redis; the worker (apps/worker alerts) writes the safety_events row.
//
// - The event is parsed strictly first (ids, guard, a fixed code, source; nothing else), so no text
//   can ride along. A bad event is refused with a message that never quotes it.
// - The sink is bound to one student x teacher, like the other turn ports; an event for anyone
//   else is refused.
// - The job id is ADR-0006's dedupe key `${turnId}:${guard}`: a retried guard run adds nothing
//   while the first job is queued, and the worker's row id is derived from the same key.
import type { SafetyEventSink } from '@edmate/contracts';
import {
  bindScope,
  JOB,
  type JobQueue,
  type JobScope,
  jobId,
  jobOptions,
  type SafetyEventJob,
  SafetyEventSchema,
} from './queues.js';

const ADAPTER = 'queuedSafetyEventSink';

export function queuedSafetyEventSink(queue: JobQueue, scope: JobScope): SafetyEventSink {
  const bound = bindScope(scope, ADAPTER);
  return {
    async record(e) {
      const r = SafetyEventSchema.safeParse(e);
      if (!r.success) throw new TypeError(`${ADAPTER}: invalid safety event`);
      const ev = r.data;
      if (ev.studentId !== bound.studentId || ev.teacherId !== bound.teacherId) {
        throw new TypeError(`${ADAPTER}: event outside the bound scope`);
      }
      const job: SafetyEventJob = {
        scope: bound,
        sessionId: ev.sessionId,
        turnId: ev.turnId,
        guard: ev.guard,
        code: ev.code,
        source: ev.source,
      };
      await queue.add(
        JOB.safetyEventRecord,
        job,
        jobOptions(jobId.safetyEvent(ev.turnId, ev.guard), JOB.safetyEventRecord),
      );
    },
  };
}
