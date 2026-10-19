// A stand-in for a BullMQ Queue (rule 4: no real Redis in unit tests): records every add and can
// fail or hand each job to a "worker" callback without waiting for it.
import type { JobsOptions } from 'bullmq';
import type { JobQueue } from '../src/queues.js';

export interface AddedJob {
  name: string;
  data: unknown;
  opts: JobsOptions;
}

export interface FakeQueue extends JobQueue {
  readonly added: AddedJob[];
}

export function fakeQueue(
  opts: { fail?: boolean; onAdd?: (job: AddedJob) => void } = {},
): FakeQueue {
  const added: AddedJob[] = [];
  return {
    added,
    add(name, data, o) {
      if (opts.fail === true) return Promise.reject(new Error('redis down'));
      // Like BullMQ: the payload is serialised, so the caller's object is not kept.
      const job = { name, data: JSON.parse(JSON.stringify(data)) as unknown, opts: o };
      added.push(job);
      opts.onAdd?.(job);
      return Promise.resolve({ id: o.jobId });
    },
  };
}
