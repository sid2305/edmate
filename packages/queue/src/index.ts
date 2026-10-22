// @edmate/queue (task 3.8): the producer side of the turn queues. A composition root (the web
// turn route, the CLI chat, the eval runner) builds the queues once and, per turn, the four
// queue-backed ports for the turn's student x teacher; apps/worker processes the jobs. The
// safety-alert queue (task 4.3) carries distress alerts to the alert worker; the safety-event
// queue (task 4.4) carries moderationIn and jailbreak blocks to the safety-event worker.
import type {
  AlertSink,
  ProfileStore,
  SafetyEventSink,
  SessionStateStore,
  TraceSink,
  TranscriptStore,
} from '@edmate/contracts';
import { type ConnectionOptions, Queue } from 'bullmq';
import { queuedAlertSink, type QueuedAlertSinkOptions } from './alertSink.js';
import { type ProfileReader, queuedProfileStore } from './profileStore.js';
import {
  ALERT_QUEUE,
  COMMIT_QUEUE,
  INGEST_QUEUE,
  type IngestJob,
  IngestJobSchema,
  JOB,
  type JobQueue,
  type JobScope,
  jobId,
  jobOptions,
  METER_QUEUE,
  SAFETY_EVENT_QUEUE,
} from './queues.js';
import { queuedSafetyEventSink } from './safetyEventSink.js';
import { queuedSessionStateStore } from './sessionStateStore.js';
import { queuedTraceSink } from './traceSink.js';
import { queuedTranscriptStore } from './transcriptStore.js';
import { type QueuedUsageMeter, queuedUsageMeter } from './usageMeter.js';

export * from './queues.js';
export {
  createGateQueue,
  enqueueGate,
  GATE_JOB,
  GATE_QUEUE,
  type GateJob,
  GateJobSchema,
  gateJobId,
  gateJobOptions,
} from './gate.js';
export { queuedAlertSink, type QueuedAlertSinkOptions } from './alertSink.js';
export { type ProfileReader, queuedProfileStore } from './profileStore.js';
export { queuedSafetyEventSink } from './safetyEventSink.js';
export { queuedSessionStateStore } from './sessionStateStore.js';
export { queuedTraceSink } from './traceSink.js';
export { queuedTranscriptStore } from './transcriptStore.js';
export { type RedisTurnCounterOptions, redisTurnCounter, redisTurnLimits } from './turnLimits.js';
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
 * The producer queues (meter, commit, alert, safety event) on a connection the caller owns
 * (`prefix`: BullMQ's key prefix, for tests). Nothing connects until a job is added.
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
  profiles: ProfileStore;
}

/**
 * One turn's queue-backed ports for its student x teacher (`reader` serves transcript history and
 * `profileReader` serves `profiles.get`: both reads the turn needs now, so neither goes through
 * the queue).
 */
export function queuedTurnPorts(
  queues: Pick<TurnQueues, 'meter' | 'commit' | 'alert' | 'safetyEvent'>,
  scope: JobScope,
  reader: Pick<TranscriptStore, 'history'>,
  profileReader: ProfileReader,
  alertOptions: QueuedAlertSinkOptions = {},
): QueuedTurnPorts {
  return {
    usage: queuedUsageMeter(queues.meter, scope),
    transcripts: queuedTranscriptStore(queues.commit, scope, reader),
    sessionState: queuedSessionStateStore(queues.commit, scope),
    traces: queuedTraceSink(queues.commit, scope),
    alerts: queuedAlertSink(queues.alert, alertOptions),
    safetyEvents: queuedSafetyEventSink(queues.safetyEvent, scope),
    profiles: queuedProfileStore(queues.commit, scope, profileReader),
  };
}

// ---- ingest (task 8.2 Phase 2) ----------------------------------------------------------------

/** The ingest queue on a connection the caller owns (`prefix`: BullMQ's key prefix, for tests). */
export function createIngestQueue(
  connection: ConnectionOptions,
  opts: { prefix?: string } = {},
): JobQueue & { close(): Promise<void> } {
  return new Queue(INGEST_QUEUE, {
    connection,
    ...(opts.prefix === undefined ? {} : { prefix: opts.prefix }),
  });
}

/**
 * Enqueues one document for the ingest worker, keyed by `storageKey` (the file this call is
 * enqueuing, named by the caller — the job payload itself carries no `storageKey`; see
 * `IngestJobSchema`'s doc comment) so a retry of the *same* file replaces the still-queued
 * attempt, while a replace (a new `storageKey` for the same document) gets its own job id rather
 * than reusing one a still-active old job might hold.
 */
export async function enqueueIngest(
  queue: JobQueue,
  job: IngestJob,
  storageKey: string,
): Promise<void> {
  const data = IngestJobSchema.parse(job);
  await queue.add(
    JOB.ingestProcess,
    data,
    jobOptions(jobId.ingest(data.documentId, storageKey), JOB.ingestProcess),
  );
}
