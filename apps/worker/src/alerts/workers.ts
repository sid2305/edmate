// The safety-alert worker (task 4.3). Jobs carry @edmate/queue's alert options: a practically
// unlimited number of attempts on the custom `alert-capped` backoff, which this worker defines
// (doubling from 1 s, capped at 30 s). A stalled job (the worker died mid-job) is picked up again
// instead of failing after one stall. A malformed payload or a permanent store error
// (not_found/invalid/scope/integrity, 12.5g) ends the job (dead-lettered with ids only); every
// other failure is logged without the payload.
import {
  ALERT_BACKOFF_MAX_MS,
  ALERT_BACKOFF_START_MS,
  ALERT_ESCALATION_MS,
  ALERT_QUEUE,
  alertBackoffMs,
  type JobQueue,
} from '@edmate/queue';
import { type ConnectionOptions, Worker } from 'bullmq';
import { onJobFailed } from '../commit/deadLetter.js';
import { permanentToUnrecoverable } from '../commit/workers.js';
import { describeError, type Log } from '../log.js';
import { type AlertJob, type AlertJobOutcome, alertProcessor } from './processors.js';
import type { AckStore, AlertNotifier, AlertStore } from './types.js';

/** How often a job may stall (worker crash) and still be retried rather than failed. */
export const ALERT_MAX_STALLED = 1_000;

export interface AlertWorkerOptions {
  connection: ConnectionOptions;
  notifier: AlertNotifier;
  /** Persists the alert and its escalations, and reads the ack (12.5b). `dbAlertStore` in prod. */
  store: AlertStore & AckStore;
  /** The alert queue (a producer on the same queue), for the next escalation check. */
  queue: JobQueue;
  deadLetter: JobQueue;
  log: Log;
  now?: () => Date;
  /** Between escalation checks (default ALERT_ESCALATION_MS: 15 minutes). */
  escalateAfterMs?: number;
  /** The retry backoff (default 1 s doubling to 30 s); tests shorten it. */
  backoff?: { startMs: number; maxMs: number };
  /** BullMQ key prefix (tests isolate themselves with one). */
  prefix?: string;
  autorun?: boolean;
}

export function createAlertWorker(o: AlertWorkerOptions): Worker<unknown, AlertJobOutcome> {
  const { startMs, maxMs } = o.backoff ?? {
    startMs: ALERT_BACKOFF_START_MS,
    maxMs: ALERT_BACKOFF_MAX_MS,
  };
  const process = permanentToUnrecoverable<AlertJob, AlertJobOutcome>(
    alertProcessor({
      notifier: o.notifier,
      store: o.store,
      queue: o.queue,
      escalateAfterMs: o.escalateAfterMs ?? ALERT_ESCALATION_MS,
      log: o.log,
    }),
  );
  const worker = new Worker<unknown, AlertJobOutcome>(ALERT_QUEUE, process, {
    connection: o.connection,
    autorun: o.autorun ?? false,
    ...(o.prefix === undefined ? {} : { prefix: o.prefix }),
    concurrency: 4,
    maxStalledCount: ALERT_MAX_STALLED,
    settings: { backoffStrategy: (attemptsMade: number) => alertBackoffMs(attemptsMade, startMs, maxMs) },
  });
  const failed = onJobFailed({
    deadLetter: o.deadLetter,
    log: o.log,
    now: o.now ?? (() => new Date()),
  });
  worker.on('failed', (job, error) => {
    void failed(job, error);
  });
  worker.on('error', (error) => {
    o.log({ level: 'error', event: 'worker.error', queue: worker.name, error: describeError(error) });
  });
  return worker;
}
