// ProfileStore on the commit queue (task 3.17). `get` is a read the turn needs now, so it goes to
// the given reader (the direct @edmate/db adapter, `profileStoreFor`); `applyEvidence` enqueues
// one job per event (never a batch): the job id is `jobId.evidence(evidenceEventId(event))`, the
// same content hash the worker's `evidence.apply` processor uses as the row id it writes, so a
// retried job (or the same evidence fed twice) changes mastery once.
import type { EvidenceEvent, ProfileStore } from '@edmate/contracts';
import {
  bindScope,
  type EvidenceJob,
  EvidenceJobSchema,
  evidenceEventId,
  JOB,
  type JobQueue,
  type JobScope,
  jobId,
  jobOptions,
} from './queues.js';

/** What `queuedProfileStore` needs to serve `get`: the direct db adapter's own method. */
export type ProfileReader = Pick<ProfileStore, 'get'>;

export function queuedProfileStore(
  queue: JobQueue,
  scope: JobScope,
  reader: ProfileReader,
): ProfileStore {
  const bound = bindScope(scope, 'queuedProfileStore');
  return {
    get: (studentId, teacherId) => reader.get(studentId, teacherId),
    async applyEvidence(events: EvidenceEvent[]) {
      for (const event of events) {
        if (event.studentId !== bound.studentId || event.teacherId !== bound.teacherId) {
          throw new TypeError(
            'queuedProfileStore.applyEvidence: an event is not this store’s student x teacher',
          );
        }
        const data: EvidenceJob = EvidenceJobSchema.parse({ scope: bound, event });
        await queue.add(
          JOB.evidence,
          data,
          jobOptions(jobId.evidence(evidenceEventId(event)), JOB.evidence),
        );
      }
      // Resolves once every job is enqueued, never on the database write (the same precedent as
      // the other queued ports): the returned profile may not yet reflect this call's evidence.
      // The harness (commit, 3.17) never reads applyEvidence's return value, so this is a cheap
      // "best current view", not a promise of read-your-writes.
      return reader.get(bound.studentId, bound.teacherId);
    },
  };
}
