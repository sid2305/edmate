// AlertSink on the safety-alert queue (task 4.3). `raise` resolves once both jobs are durably in
// Redis; delivery, acknowledgement and on-call escalation are the worker's (apps/worker alerts).
//
// The escalation check goes in first (lead answer 4): if the raise job then fails to enqueue and
// the process dies before the runner's retry, on-call is still paged when the check runs. Both
// ids derive from the alert id, so a retried raise adds nothing new while the first jobs exist.
import { type AlertSink, SafetyAlertSchema } from '@edmate/contracts';
import {
  ALERT_ESCALATION_MS,
  type AlertEscalateJob,
  alertJobOptions,
  type AlertRaiseJob,
  JOB,
  type JobQueue,
  jobId,
} from './queues.js';

export interface QueuedAlertSinkOptions {
  /** Delay before the first on-call check (default ALERT_ESCALATION_MS); tests shorten it. */
  escalateAfterMs?: number;
}

export function queuedAlertSink(queue: JobQueue, opts: QueuedAlertSinkOptions = {}): AlertSink {
  const after = opts.escalateAfterMs ?? ALERT_ESCALATION_MS;
  if (!(after > 0)) throw new TypeError('queuedAlertSink: escalateAfterMs must be positive');
  return {
    async raise(a) {
      const alert = SafetyAlertSchema.parse(a);
      const check: AlertEscalateJob = { alert, round: 0 };
      await queue.add(
        JOB.alertEscalateCheck,
        check,
        alertJobOptions(jobId.alertEscalate(alert.id, 0), after),
      );
      const raise: AlertRaiseJob = { alert };
      await queue.add(JOB.alertRaise, raise, alertJobOptions(jobId.alertRaise(alert.id)));
    },
  };
}
