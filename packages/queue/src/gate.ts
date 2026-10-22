// The publish-gate queue (task 8.7 Phase C). The studio starts a run (`publish.startRun`) and
// enqueues one job naming it; apps/worker's gate processor runs the quality gate and either
// publishes (`publish.goLive`) or finishes the run as failed/error.
//
// A gate run is up to 2 h, so a job is never retried automatically (`attempts: 1`): the teacher
// retries, and a crashed run is closed as stale by the next `startRun`. The job carries ids only;
// the processor re-reads the run (its basis, changes and status) from the database.
import { MessageSchema } from '@edmate/contracts';
import { type ConnectionOptions, type JobsOptions, Queue } from 'bullmq';
import { z } from 'zod';
import { FAILED_JOB_TTL_SECONDS, type JobQueue } from './queues.js';

export const GATE_QUEUE = 'edmate-gate';
export const GATE_JOB = 'gate.run';

const Id = MessageSchema.shape.id;

/** One gate run to process, scoped to its teacher. */
export const GateJobSchema = z.strictObject({ runId: Id, teacherId: Id });
export type GateJob = z.infer<typeof GateJobSchema>;

/** One job per run (BullMQ refuses `:` in a custom id): a re-enqueue of a waiting run dedupes. */
export function gateJobId(runId: string): string {
  return `${runId}.gate`;
}

export function gateJobOptions(runId: string): JobsOptions {
  return {
    jobId: gateJobId(runId),
    attempts: 1,
    removeOnComplete: true,
    removeOnFail: { age: FAILED_JOB_TTL_SECONDS, count: 1_000 },
  };
}

/** The gate queue on a connection the caller owns (`prefix`: BullMQ's key prefix, for tests). */
export function createGateQueue(
  connection: ConnectionOptions,
  opts: { prefix?: string } = {},
): JobQueue & { close(): Promise<void> } {
  return new Queue(GATE_QUEUE, {
    connection,
    ...(opts.prefix === undefined ? {} : { prefix: opts.prefix }),
  });
}

/** Enqueues one run for the gate worker; a malformed job is refused before the queue is touched. */
export async function enqueueGate(queue: JobQueue, job: GateJob): Promise<void> {
  const data = GateJobSchema.parse(job);
  await queue.add(GATE_JOB, data, gateJobOptions(data.runId));
}
