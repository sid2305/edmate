// Task 8.2i (Phase B): the stuck-`processing` sweep's candidate list. A scheduled job (not a
// signed-in teacher or student's own request) finds documents stuck mid-ingest -- a worker that
// crashed, was redeployed or lost its connection mid-attempt, leaving the row in `processing`
// with no further write coming -- and marks each one `failed` so the teacher sees a retryable
// state instead of a silent stall. Same "deliberately outside `createRepositories`, not in the
// isolation grid" pattern as `./retention.ts`: this is a cross-teacher read, not a scoped one.
import { and, asc, eq, isNotNull, lt } from 'drizzle-orm';
import type { Db } from '../client.js';
import { guarded } from './errors.js';
import { documents } from '../schema/content.js';

/** One stuck-`processing` document the sweep should fail (always has a storage key: see below). */
export interface StaleProcessingDocument {
  id: string;
  teacherId: string;
  storageKey: string;
}

/** At most this many rows per call, mirroring `RETENTION_PURGE_LIMIT`'s size and intent. */
export const INGEST_SWEEP_LIMIT = 1000;

export function ingestSweepRepo(db: Db) {
  return {
    /**
     * Documents still `processing` whose `updated_at` is older than `cutoff`, oldest first, at
     * most `limit` rows. A null `storage_key` (a `teacher_note`, which is never ingested async)
     * never shows here, since `failIfStorageKey`'s compare-and-set needs a real key to compare
     * against; `ready`/`failed`/`uploading` rows are never stuck in this sense, so they're
     * excluded too.
     */
    async staleProcessing(
      cutoff: Date,
      limit = INGEST_SWEEP_LIMIT,
    ): Promise<StaleProcessingDocument[]> {
      const method = 'ingestSweep.staleProcessing';
      return guarded(method, async () => {
        const rows = await db
          .select({
            id: documents.id,
            teacherId: documents.teacherId,
            storageKey: documents.storageKey,
          })
          .from(documents)
          .where(
            and(
              eq(documents.status, 'processing'),
              lt(documents.updatedAt, cutoff),
              isNotNull(documents.storageKey),
            ),
          )
          .orderBy(asc(documents.updatedAt), asc(documents.id))
          .limit(limit);
        return rows.map((r) => ({ id: r.id, teacherId: r.teacherId, storageKey: r.storageKey! }));
      });
    },
  };
}

export type IngestSweepRepo = ReturnType<typeof ingestSweepRepo>;
