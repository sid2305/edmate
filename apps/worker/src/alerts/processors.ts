// The safety-alert processor (task 4.3; persistence added in 12.5b).
//
// - `alert.raise`: persist the alert (`store.record`), then tell the trust team. A failed persist
//   never blocks the notice: it is logged at once (`safety_alert.store_failed`, ids and the error
//   name only; before notify runs, so a joint DB and notifier outage still logs it) and the job
//   still throws afterwards, so BullMQ retries the write.
// - `alert.escalate_check` (round n, 15 minutes after the raise and then every 15 minutes): read
//   the ack from the DB (`store.isAcknowledged`, the source of truth since 12.5b). A failed ack
//   read counts as *not acknowledged* (fail closed: a DB hiccup must not silently stop paging) and
//   is logged. Acknowledged: stop, nothing else runs. Otherwise schedule round n+1 first, mark the
//   row escalated (a failure there is logged, not thrown -- a throw would retry the whole check on
//   the 30 s backoff and could page far more often than once per interval), then page on-call.
//
// Every failure but a malformed payload is retried with no practical attempt limit (the job
// options in @edmate/queue), so an alert is retried until delivered. A retried step may notify
// twice: an extra notification is safer than a missed one. Round ids (`<alertId>.escalate.<n>`)
// keep at most one pending check per alert. Log lines carry ids only, never the excerpt.
import {
  AlertEscalateJobSchema,
  alertJobOptions,
  AlertRaiseJobSchema,
  JOB,
  type JobQueue,
  jobId,
} from '@edmate/queue';
import { PermanentJobError } from '../commit/processors.js';
import type { Log } from '../log.js';
import type { AckStore, AlertAudience, AlertNotifier, AlertStore } from './types.js';

/** The name of a thrown value, when it is an Error (never the message: it may carry driver detail). */
function errorName(e: unknown): string {
  return e instanceof Error ? e.name : 'UnknownError';
}

/** A notifier call that takes longer fails (and is retried): a hung vendor must not stall it. */
export const ALERT_NOTIFY_TIMEOUT_MS = 20_000;

/** The notifier did not answer in time. Names the audience and the limit, nothing else. */
export class NotifyTimeoutError extends Error {
  override readonly name = 'NotifyTimeoutError';
  constructor(audience: AlertAudience, ms: number) {
    super(`alert notify to ${audience} timed out after ${ms} ms`);
  }
}

export interface AlertJob {
  id?: string | undefined;
  name: string;
  data: unknown;
}

export type AlertJobOutcome = 'notified' | 'escalated' | 'acknowledged';

export interface AlertProcessorDeps {
  notifier: AlertNotifier;
  /** Persists the alert and its escalations, and reads the ack (12.5b: the DB is the source of truth). */
  store: AlertStore & AckStore;
  /** The alert queue itself, for the next escalation check. */
  queue: JobQueue;
  /** Time between escalation checks (ALERT_ESCALATION_MS; tests shorten it). */
  escalateAfterMs: number;
  /** Per notifier call (default ALERT_NOTIFY_TIMEOUT_MS). */
  notifyTimeoutMs?: number;
  log: Log;
}

function parse<T>(
  schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } },
  job: AlertJob,
): T {
  const r = schema.safeParse(job.data);
  if (!r.success) throw new PermanentJobError(`${job.name}: invalid job payload`);
  return r.data;
}

export function alertProcessor(d: AlertProcessorDeps) {
  const limit = d.notifyTimeoutMs ?? ALERT_NOTIFY_TIMEOUT_MS;
  const notify = async (alert: Parameters<AlertNotifier['notify']>[0], audience: AlertAudience) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new NotifyTimeoutError(audience, limit));
      }, limit);
    });
    try {
      await Promise.race([d.notifier.notify(alert, audience), timeout]);
    } finally {
      clearTimeout(timer);
    }
  };
  return async (job: AlertJob): Promise<AlertJobOutcome> => {
    switch (job.name) {
      case JOB.alertRaise: {
        const { alert } = parse(AlertRaiseJobSchema, job);
        // Logged in the catch, before notify is awaited (12.5e): if the notifier also throws,
        // the store failure must still have been logged; the notify error then makes the job
        // retry, and the retry records again.
        let storeError: unknown;
        try {
          await d.store.record(alert);
        } catch (error) {
          storeError = error;
          d.log({
            level: 'error',
            event: 'safety_alert.store_failed',
            alertId: alert.id,
            error: errorName(error),
          });
        }
        await notify(alert, 'trust_team');
        d.log({
          level: 'info',
          event: 'safety_alert.notified',
          alertId: alert.id,
          audience: 'trust_team',
        });
        if (storeError !== undefined) throw storeError;
        return 'notified';
      }
      case JOB.alertEscalateCheck: {
        const { alert, round } = parse(AlertEscalateJobSchema, job);
        let acked: boolean;
        try {
          acked = await d.store.isAcknowledged(alert.id);
        } catch (error) {
          d.log({
            level: 'error',
            event: 'safety_alert.ack_read_failed',
            alertId: alert.id,
            error: errorName(error),
          });
          acked = false;
        }
        if (acked) return 'acknowledged';
        const next = round + 1;
        await d.queue.add(
          JOB.alertEscalateCheck,
          { alert, round: next },
          alertJobOptions(jobId.alertEscalate(alert.id, next), d.escalateAfterMs),
        );
        try {
          await d.store.markEscalated(alert, round);
        } catch (error) {
          d.log({
            level: 'error',
            event: 'safety_alert.mark_escalated_failed',
            alertId: alert.id,
            round,
            error: errorName(error),
          });
        }
        await notify(alert, 'on_call');
        d.log({ level: 'warn', event: 'safety_alert.escalated', alertId: alert.id, round });
        return 'escalated';
      }
      default:
        throw new PermanentJobError(`${job.name}: unknown alert job`);
    }
  };
}
