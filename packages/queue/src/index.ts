// @edmate/queue (task 3.8): the producer side of the turn queues. A composition root (the web
// turn route, the CLI chat, the eval runner) builds the queues once and, per turn, the four
// queue-backed ports for the turn's student x teacher; apps/worker processes the jobs. The
// safety-alert queue (task 4.3) carries distress alerts to the alert worker; the safety-event
// queue (task 4.4) carries moderationIn and jailbreak blocks to the safety-event worker.
import type {
  AlertSink,
  SafetyEventSink,
  SessionStateStore,
  TraceSink,
  TranscriptStore,
} from '@edmate/contracts';
import { type ConnectionOptions, Queue } from 'bullmq';
import { queuedAlertSink, type QueuedAlertSinkOptions } from './alertSink.js';
import {
  ALERT_QUEUE,
  COMMIT_QUEUE,
  type JobQueue,
  type JobScope,
  METER_QUEUE,
  SAFETY_EVENT_QUEUE,
} from './queues.js';
import { queuedSafetyEventSink } from './safetyEventSink.js';
import { queuedSessionStateStore } from './sessionStateStore.js';
import { queuedTraceSink } from './traceSink.js';
import { queuedTranscriptStore } from './transcriptStore.js';
import { type QueuedUsageMeter, queuedUsageMeter } from './usageMeter.js';

export * from './queues.js';
export { queuedAlertSink, type QueuedAlertSinkOptions } from './alertSink.js';
export { queuedSafetyEventSink } from './safetyEventSink.js';
export { queuedSessionStateStore } from './sessionStateStore.js';
export { queuedTraceSink } from './traceSink.js';
export { queuedTranscriptStore } from './transcriptStore.js';
export {
  MAX_TRACKED_TURNS,
  type QueuedUsageMeter,
  queuedUsageMeter,
  type UnmeteredInput,
  type UsageContext,
} from './usageMeter.js';

export interface TurnQueues {
  meter: JobQueue;
  commit: JobQueue;
  alert: JobQueue;
  safetyEvent: JobQueue;
  close(): Promise<void>;
}

/**
 * The producer queues (meter, commit, alert, safety event) on a connection the caller owns (`prefix`: BullMQ's key prefix, for
 * tests). Nothing connects until a job is added.
 */
export function createTurnQueues(
  connection: ConnectionOptions,
  opts: { prefix?: string } = {},
): TurnQueues {
  const common = { connection, ...(opts.prefix === undefined ? {} : { prefix: opts.prefix }) };
  const meter = new Queue(METER_QUEUE, common);
  const commit = new Queue(COMMIT_QUEUE, common);
  const alert = new Queue(ALERT_QUEUE, common);
  const safetyEvent = new Queue(SAFETY_EVENT_QUEUE, common);
  return {
    meter,
    commit,
    alert,
    safetyEvent,
    async close() {
      await Promise.all([meter.close(), commit.close(), alert.close(), safetyEvent.close()]);
    },
  };
}

export interface QueuedTurnPorts {
  usage: QueuedUsageMeter;
  transcripts: TranscriptStore;
  sessionState: SessionStateStore;
  traces: TraceSink;
  alerts: AlertSink;
  safetyEvents: SafetyEventSink;
}

/** One turn's queue-backed ports for its student x teacher (`reader` serves transcript history). */
export function queuedTurnPorts(
  queues: Pick<TurnQueues, 'meter' | 'commit' | 'alert' | 'safetyEvent'>,
  scope: JobScope,
  reader: Pick<TranscriptStore, 'history'>,
  alertOptions: QueuedAlertSinkOptions = {},
): QueuedTurnPorts {
  return {
    usage: queuedUsageMeter(queues.meter, scope),
    transcripts: queuedTranscriptStore(queues.commit, scope, reader),
    sessionState: queuedSessionStateStore(queues.commit, scope),
    traces: queuedTraceSink(queues.commit, scope),
    alerts: queuedAlertSink(queues.alert, alertOptions),
    safetyEvents: queuedSafetyEventSink(queues.safetyEvent, scope),
  };
}
