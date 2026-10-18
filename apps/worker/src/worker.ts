import { Worker, type ConnectionOptions, type Job } from 'bullmq';

/** Queue the scaffold worker listens on; real queues arrive with their tasks (ingest, evals, ...). */
export const NOOP_QUEUE_NAME = 'edmate-noop';

/** Accepts a job and does nothing. */
export async function noopProcessor(_job: Job): Promise<void> {}

/**
 * Builds the no-op worker on a connection the caller owns. Nothing connects at import time,
 * and with `autorun: false` the worker only starts when `run()` is called.
 */
export function createNoopWorker(
  connection: ConnectionOptions,
  { autorun = false }: { autorun?: boolean } = {},
): Worker {
  return new Worker(NOOP_QUEUE_NAME, noopProcessor, { connection, autorun });
}
