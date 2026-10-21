// Task 8.2 Phase 2: the BullMQ Worker for `edmate-ingest`. Concurrency 1 (documents aren't
// latency-sensitive the way turns are, and it keeps a replace's stale-chunk race narrow).
// Failures go through the same dead-letter path as the turn queues (task 3.8).
import { INGEST_QUEUE, type JobQueue } from '@edmate/queue';
import { type ConnectionOptions, Worker } from 'bullmq';
import { onJobFailed } from '../commit/deadLetter.js';
import { permanentToUnrecoverable } from '../commit/workers.js';
import { describeError, type Log } from '../log.js';
import { ingestProcessor, type IngestJobLike, type IngestOutcome, type IngestProcessorDeps } from './processor.js';

export interface IngestWorkerOptions {
  readonly connection: ConnectionOptions;
  readonly deps: IngestProcessorDeps;
  readonly deadLetter: JobQueue;
  readonly log: Log;
  readonly now?: () => Date;
  /** BullMQ key prefix (tests isolate themselves with one). */
  readonly prefix?: string;
  readonly autorun?: boolean;
}

export function createIngestWorker(o: IngestWorkerOptions): Worker {
  const worker = new Worker<unknown, IngestOutcome>(
    INGEST_QUEUE,
    permanentToUnrecoverable<IngestJobLike, IngestOutcome>(ingestProcessor(o.deps, o.log)),
    {
      connection: o.connection,
      autorun: o.autorun ?? false,
      concurrency: 1,
      ...(o.prefix === undefined ? {} : { prefix: o.prefix }),
    },
  );
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
