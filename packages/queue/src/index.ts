// @edmate/queue (task 3.8): the producer side of the turn queues. A composition root (the web
// turn route, the CLI chat, the eval runner) builds the queues once and, per turn, the four
// queue-backed ports for the turn's student x teacher; apps/worker processes the jobs.
import type { SessionStateStore, TraceSink, TranscriptStore } from '@edmate/contracts';
import { type ConnectionOptions, Queue } from 'bullmq';
import { COMMIT_QUEUE, type JobQueue, type JobScope, METER_QUEUE } from './queues.js';
import { queuedSessionStateStore } from './sessionStateStore.js';
import { queuedTraceSink } from './traceSink.js';
import { queuedTranscriptStore } from './transcriptStore.js';
import { type QueuedUsageMeter, queuedUsageMeter } from './usageMeter.js';

export * from './queues.js';
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
  close(): Promise<void>;
}

/** The two producer queues on a connection the caller owns. Nothing connects until a job is added. */
export function createTurnQueues(connection: ConnectionOptions): TurnQueues {
  const meter = new Queue(METER_QUEUE, { connection });
  const commit = new Queue(COMMIT_QUEUE, { connection });
  return {
    meter,
    commit,
    async close() {
      await Promise.all([meter.close(), commit.close()]);
    },
  };
}

export interface QueuedTurnPorts {
  usage: QueuedUsageMeter;
  transcripts: TranscriptStore;
  sessionState: SessionStateStore;
  traces: TraceSink;
}

/** One turn's queue-backed ports for its student x teacher (`reader` serves transcript history). */
export function queuedTurnPorts(
  queues: Pick<TurnQueues, 'meter' | 'commit'>,
  scope: JobScope,
  reader: Pick<TranscriptStore, 'history'>,
): QueuedTurnPorts {
  return {
    usage: queuedUsageMeter(queues.meter, scope),
    transcripts: queuedTranscriptStore(queues.commit, scope, reader),
    sessionState: queuedSessionStateStore(queues.commit, scope),
    traces: queuedTraceSink(queues.commit, scope),
  };
}
