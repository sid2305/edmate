// Task 8.2i (Phase B): the stuck-`processing` sweep's candidate list. A scheduled job (not a
// signed-in teacher or student's own request) finds documents stuck mid-ingest -- a worker that
// crashed, was redeployed or lost its connection mid-attempt, leaving the row in `processing`
// with no further write coming -- and marks each one `failed` so the teacher sees a retryable
// state instead of a silent stall. Same "deliberately outside `createRepositories`, not in the
// isolation grid" pattern as `./retention.ts`: this is a cross-teacher read, not a scoped one.
import { and, asc, inArray, isNotNull, lt } from 'drizzle-orm';
import type { Db } from '../client.js';
import { guarded } from './errors.js';
import { documents } from '../schema/content.js';

/** One stuck document the sweep should fail (always has a storage key: see below). */
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
     * Documents stuck `processing` or `uploading` whose `updated_at` is older than `cutoff`,
     * oldest first, at most `limit` rows. Task 8.2q: `uploading` is included alongside
     * `processing` -- a `create` whose signing failed and whose own cleanup delete *also* failed
     * (`routes.ts`'s `create`) can leave a row stuck in `uploading` forever, with no further write
     * coming, same as a crashed worker leaves one stuck in `processing`. The caller's cutoff
     * (`STUCK_PROCESSING_MINUTES`, `apps/worker/src/ingest/sweep.ts`, 30 minutes) is twice
     * `UPLOAD_URL_TTL_SECONDS` (`apps/web/src/storage/presign.ts`, 15 minutes): an upload that
     * started on a still-valid signed URL has finished or failed well before the sweep's cutoff,
     * so a row genuinely stuck that long is safe to fail -- check this comment against both
     * constants if either one changes. A null `storage_key` (a `teacher_note`, which is never
     * ingested async and never set to `uploading`) never shows here, since `failIfStorageKey`'s
     * compare-and-set needs a real key to compare against; `ready`/`failed` rows are never stuck
     * in this sense, so they're excluded too.
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
              inArray(documents.status, ['processing', 'uploading']),
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
