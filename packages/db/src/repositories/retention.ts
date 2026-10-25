// Retention (task 13.4, Phase A): purge/anonymise queries, one per table, each taking a cutoff
// date and a dry-run flag (default true, so a caller never purges by accident) and returning a
// row count. These are system/scheduled jobs, not a signed-in student or teacher's own request —
// they take no TeacherScope/StudentScope and are deliberately not part of `createRepositories`
// (so they are not in `RepositoryMethod`/the isolation grid in `test/repositories.int.test.ts`,
// which models per-teacher/per-student access, not a cross-account scheduled purge). Exported
// standalone from `repositories/index.ts`, the same way `ports.ts`'s factories are.
//
// Explicitly out of scope, and why (so a reviewer never has to guess):
// - `safety_alerts`: a legal/safety record; retention (if any) is a staff/legal decision, not
//   this task's.
// - `payments`, `ledger_entries`, `payouts`, `invoices`: financial records with their own
//   (longer) legal retention; never purged here.
// - `audit_log`, `platform_audit_log`: append-only compliance records of who did what; purging
//   them would destroy the evidence a dispute or an account-delete audit trail depends on.
// - `webhook_events`, `eval_runs`/`eval_results`: operational/quality records, not personal data;
//   out of this task's scope (no retention rule asked for them).
import { and, eq, inArray, isNotNull, lt, notExists } from 'drizzle-orm';
import type { Db } from '../client.js';
import { guarded } from './errors.js';
import { chunks } from '../schema/content.js';
import { messages, sessions, turnTraces } from '../schema/learning.js';
import { safetyAlerts } from '../schema/operations.js';

/** A purge/anonymise result: `dryRun: true` reports what would change; `false` means it did. */
export interface RetentionResult {
  count: number;
  dryRun: boolean;
}

/** Default: report only, never purge (same fail-closed pattern as 3.10's unverified helplines). */
const DEFAULT_DRY_RUN = true;

export function retentionRepo(db: Db) {
  return {
    /**
     * Sessions past `cutoff` (by `created_at`) that have ended, and have no `turn_traces` or
     * `safety_alerts` row left referencing them (both have their own, usually shorter, retention
     * — a session with either still attached is skipped this round, not force-deleted: the two
     * FKs are `restrict`, so skipping, not erroring, is the only safe move). Deletes the
     * session's own messages first, in the same transaction, then the session row.
     */
    async purgeOldSessions(cutoff: Date, dryRun = DEFAULT_DRY_RUN): Promise<RetentionResult> {
      const method = 'retention.purgeOldSessions';
      return guarded(method, () =>
        db.transaction(async (tx) => {
          const rows = await tx
            .select({ id: sessions.id })
            .from(sessions)
            .where(
              and(
                lt(sessions.createdAt, cutoff),
                isNotNull(sessions.endedAt),
                notExists(
                  tx.select().from(turnTraces).where(eq(turnTraces.sessionId, sessions.id)),
                ),
                notExists(
                  tx.select().from(safetyAlerts).where(eq(safetyAlerts.sessionId, sessions.id)),
                ),
              ),
            );
          const ids = rows.map((r) => r.id);
          if (ids.length === 0) return { count: 0, dryRun };
          if (dryRun) return { count: ids.length, dryRun };
          await tx.delete(messages).where(inArray(messages.sessionId, ids));
          await tx.delete(sessions).where(inArray(sessions.id, ids));
          return { count: ids.length, dryRun };
        }),
      );
    },

    /** `turn_traces` past `cutoff`: a leaf table ("no keys, no names"), nothing references it. */
    async purgeOldTraces(cutoff: Date, dryRun = DEFAULT_DRY_RUN): Promise<RetentionResult> {
      const method = 'retention.purgeOldTraces';
      return guarded(method, async () => {
        if (dryRun) {
          const rows = await db
            .select({ id: turnTraces.id })
            .from(turnTraces)
            .where(lt(turnTraces.createdAt, cutoff));
          return { count: rows.length, dryRun };
        }
        const deleted = await db
          .delete(turnTraces)
          .where(lt(turnTraces.createdAt, cutoff))
          .returning({ id: turnTraces.id });
        return { count: deleted.length, dryRun };
      });
    },

    /**
     * `chunks` of `kind = 'transcript'` past `cutoff`; never `material` or `teacher_note` chunks
     * (those are the teacher's own teaching content, not personal transcript data).
     * `topic_chunks` cascades on delete, so a transcript chunk linked into a topic is removed
     * cleanly.
     */
    async purgeOldTranscriptChunks(
      cutoff: Date,
      dryRun = DEFAULT_DRY_RUN,
    ): Promise<RetentionResult> {
      const method = 'retention.purgeOldTranscriptChunks';
      return guarded(method, async () => {
        const where = and(eq(chunks.kind, 'transcript'), lt(chunks.createdAt, cutoff));
        if (dryRun) {
          const rows = await db.select({ id: chunks.id }).from(chunks).where(where);
          return { count: rows.length, dryRun };
        }
        const deleted = await db.delete(chunks).where(where).returning({ id: chunks.id });
        return { count: deleted.length, dryRun };
      });
    },
  };
}

export type RetentionRepo = ReturnType<typeof retentionRepo>;
