// Reports (task 12.2a): a student reports an agent or teacher reply in their own chat; staff list
// the open queue and review each report once. No migration: the `reports` table is from 0001.
//
// - `target` is `message:<messageId>`; `reason` is one category from REPORT_CATEGORIES (never
//   free text, 12.2 Q2); `reporter_id` is the scope's student and never leaves this file.
// - The row id derives from (reporter, target), so a student reports a message at most once: a
//   second call writes nothing and reads `created: false` (checked in scope, like
//   safetyEvents.record). The first category wins.
// - Staff checks never name the user table here: `lockRole` (role-lock.ts) reads the role column
//   alone, share-locked, so no repository source can reach a name, email or phone.
//
// Lock order (8.7a lesson). `review` takes: the staff user's role row (`FOR SHARE`), then the
// report row (`FOR UPDATE`). Takedowns (12.2b) take role, then the document or agent, then the
// takedown row, then the report; both keep "role first, report last", so neither can wait on the
// other in the opposite order. Nothing here locks a profile, an agent or a run, so there is no
// cycle with publish's order (advisory, profile, agent, run) either.
import { createHash } from 'node:crypto';
import { debuglog } from 'node:util';
import { and, asc, eq, inArray, like, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client.js';
import { lockRole } from '../role-lock.js';
import { documents, messages, reports, sessions, teacherProfiles } from '../schema/index.js';
import { insertAuditEntry } from './audit.js';
import { RepositoryError, translateWrite } from './errors.js';
import { insertSelect, written } from './insert.js';
import {
  iso,
  REPORT_CATEGORIES,
  REPORT_CITED_DOCUMENTS_MAX,
  ReportCategorySchema,
  type ReportCategory,
  type StaffReportRow,
  toStaffReportRow,
} from './map.js';
import { IdSchema, parseArg, studentScope, type StudentScope } from './scope.js';
import { ownSession } from './sessions.js';
import { notTakenDown } from './takedowns.js';

export { REPORT_CATEGORIES, REPORT_CITED_DOCUMENTS_MAX, type ReportCategory, type StaffReportRow };

/** The staff queue shows at most this many open reports in one read, oldest first. */
export const REPORTS_QUEUE_MAX_LIMIT = 50;
/** A staff review note's maximum length (the audit reason's cap). */
export const REPORT_NOTE_MAX = 500;

const TARGET_PREFIX = 'message:';

const debug = debuglog('edmate:db');

/**
 * `listOpenForStaff`'s per-row mapping can only fail with `RepositoryError('integrity', ...)`
 * (toStaffReportRow's only throw site, map.ts's `checked` helper) — a stored `reason` that no
 * longer matches `ReportCategorySchema`. Anything else (a connection drop, a programmer error) is
 * not a "skip this one bad row" case and must surface for the whole batch.
 */
export function isSkippableReportRowError(e: unknown): boolean {
  return e instanceof RepositoryError && e.kind === 'integrity';
}

const FileInput = z.strictObject({
  sessionId: IdSchema,
  messageId: IdSchema,
  category: ReportCategorySchema,
});
export type ReportFileInput = z.infer<typeof FileInput>;

const ReviewInput = z.strictObject({
  decision: z.enum(['dismissed', 'actioned']),
  note: z.string().trim().min(1).max(REPORT_NOTE_MAX).optional(),
});
export type ReportReviewInput = z.infer<typeof ReviewInput>;
export type ReportDecision = ReportReviewInput['decision'];

/** The row id for (reporter, message): the same on every retry; neither id can be read from it. */
export function reportRowId(reporterId: string, messageId: string): string {
  const digest = createHash('sha256')
    .update(`${reporterId}\u0000${TARGET_PREFIX}${messageId}`)
    .digest('hex');
  return `rp_${digest.slice(0, 40)}`;
}

/** Only replies can be reported: never a student's own (or another student's) message. */
const isReply = sql`${messages.role} in ('agent', 'teacher')`;
/** The message id inside a `message:<id>` target (only matched for such targets). */
const targetMessageId = sql`substr(${reports.target}, ${TARGET_PREFIX.length + 1})`;

/** Staff only: `invalid` for a malformed id, `scope` for anyone who is not staff right now. */
async function requireStaff(tx: Pick<Db, 'select'>, by: string, method: string): Promise<void> {
  if ((await lockRole(tx, by)) !== 'staff') throw new RepositoryError('scope', method);
}

export function reportsRepo(db: Db) {
  return {
    /**
     * Files the scope's student's report on an agent or teacher reply in their own session. A
     * student message, another scope's session or message, or a missing one is `not_found` and
     * nothing is written. A second report on the same message is `{ created: false }`.
     */
    async file(
      scope: StudentScope,
      input: ReportFileInput,
    ): Promise<{ id: string; created: boolean }> {
      const method = 'reports.file';
      const sc = studentScope(scope, method);
      const r = parseArg(FileInput, input, method);
      const id = reportRowId(sc.studentId, r.messageId);
      const owned = and(eq(messages.id, r.messageId), isReply, ownSession(r.sessionId, sc));
      const result = await translateWrite(method, () =>
        db.execute(
          sql`${insertSelect(
            reports,
            [
              [reports.id, sql`${id}::text`],
              [reports.target, sql`${TARGET_PREFIX}::text || ${messages.id}`],
              [reports.reason, sql`${r.category}::text`],
              [reports.reporterId, sql`${sessions.studentId}`],
            ],
            sql`from ${messages} inner join ${sessions} on ${sessions.id} = ${messages.sessionId}
                where ${owned}`,
          )} on conflict (id) do nothing`,
        ),
      );
      if (written(result) === 1) return { id, created: true };
      // Nothing written: already filed (the row is there, about this scope's own reply) or not
      // the scope's to report.
      const [found] = await db
        .select({ id: reports.id })
        .from(reports)
        .innerJoin(messages, eq(messages.id, targetMessageId))
        .innerJoin(sessions, eq(sessions.id, messages.sessionId))
        .where(and(eq(reports.id, id), eq(reports.reporterId, sc.studentId), owned));
      if (found === undefined) throw new RepositoryError('not_found', method);
      return { id, created: false };
    },

    /**
     * The open reports, oldest first by (created_at, id), capped at REPORTS_QUEUE_MAX_LIMIT, for a
     * user who is staff right now. Each row has the reported reply (null if it is gone), the
     * session's teacher and agent, the teacher's slug and the teacher's documents its sources
     * cite. Never the reporter or the session.
     */
    async listOpenForStaff(by: unknown): Promise<StaffReportRow[]> {
      const method = 'reports.listOpenForStaff';
      const staff = parseArg(IdSchema, by, method);
      return db.transaction(async (tx) => {
        await requireStaff(tx, staff, method);
        const rows = await tx
          .select({
            id: reports.id,
            reason: reports.reason,
            status: reports.status,
            createdAt: reports.createdAt,
            messageId: targetMessageId.mapWith(String),
            role: messages.role,
            text: messages.text,
            sources: messages.sources,
            messageAt: messages.createdAt,
            teacherId: sessions.teacherId,
            agentId: sessions.agentId,
            slug: teacherProfiles.slug,
          })
          .from(reports)
          .leftJoin(messages, and(eq(messages.id, targetMessageId), isReply))
          .leftJoin(sessions, eq(sessions.id, messages.sessionId))
          .leftJoin(teacherProfiles, eq(teacherProfiles.userId, sessions.teacherId))
          .where(and(eq(reports.status, 'open'), like(reports.target, `${TARGET_PREFIX}%`)))
          .orderBy(asc(reports.createdAt), asc(reports.id))
          .limit(REPORTS_QUEUE_MAX_LIMIT);

        const cited = (r: (typeof rows)[number]): string[] =>
          Array.isArray(r.sources)
            ? r.sources.flatMap((s: unknown) =>
                typeof s === 'object' &&
                s !== null &&
                typeof (s as { title?: unknown }).title === 'string'
                  ? [(s as { title: string }).title]
                  : [],
              )
            : [];
        const teacherIds = [...new Set(rows.flatMap((r) => (r.teacherId ? [r.teacherId] : [])))];
        const titles = [...new Set(rows.flatMap(cited))];
        const docs =
          teacherIds.length === 0 || titles.length === 0
            ? []
            : await tx
                .select({
                  id: documents.id,
                  teacherId: documents.teacherId,
                  title: documents.sourceTitle,
                  kind: documents.kind,
                  // The one takedown predicate (12.2b), which qualifies the column itself.
                  takenDown: sql<boolean>`not ${notTakenDown(documents.id)}`.mapWith(Boolean),
                })
                .from(documents)
                .where(
                  and(
                    inArray(documents.teacherId, teacherIds),
                    inArray(documents.sourceTitle, titles),
                  ),
                )
                .orderBy(asc(documents.createdAt), asc(documents.id))
                // This cap is batch-wide (across the whole open queue), not per report, ordered
                // by (createdAt, id) ascending. Once more than
                // REPORTS_QUEUE_MAX_LIMIT * REPORT_CITED_DOCUMENTS_MAX distinct (teacher, title)
                // document rows exist across the open queue, a report late in that order can have
                // its citedDocuments silently truncated below its own per-report cap. Acceptable
                // at today's queue sizes; revisit if the queue regularly nears the cap.
                .limit(REPORTS_QUEUE_MAX_LIMIT * REPORT_CITED_DOCUMENTS_MAX);

        const out: StaffReportRow[] = [];
        let skipped = 0;
        for (const r of rows) {
          const hasMessage = r.role !== null && r.text !== null && r.messageAt !== null;
          const wanted = new Set(cited(r));
          try {
            out.push(
              toStaffReportRow(
                {
                  id: r.id,
                  category: r.reason,
                  status: r.status,
                  createdAt: iso(r.createdAt),
                  messageId: r.messageId,
                  teacherId: r.teacherId,
                  agentId: r.agentId,
                  teacherSlug: r.slug,
                  message: hasMessage
                    ? {
                        role: r.role,
                        text: r.text,
                        ...(r.sources === null ? {} : { sources: r.sources }),
                        createdAt: iso(r.messageAt!),
                      }
                    : null,
                  citedDocuments: docs
                    .filter((d) => d.teacherId === r.teacherId && wanted.has(d.title))
                    .slice(0, REPORT_CITED_DOCUMENTS_MAX)
                    .map((d) => ({
                      id: d.id,
                      title: d.title,
                      kind: d.kind,
                      takenDown: d.takenDown,
                    })),
                },
                method,
              ),
            );
          } catch (e) {
            // A row's stored `reason` can fail ReportCategorySchema (e.g. written before a
            // category was removed from REPORT_CATEGORIES) — that's the one case we skip, so one
            // bad row drops out of the queue instead of hiding every row. Anything else rethrows
            // for the whole batch instead of silently disappearing.
            /* v8 ignore next -- toStaffReportRow only throws integrity errors today; the rule is unit-tested via isSkippableReportRowError */
            if (!isSkippableReportRowError(e)) throw e;
            skipped += 1;
          }
        }
        if (skipped > 0) {
          // Count only, never the row id, report text or reason: this log is shared.
          debug('%s: skipped %d row(s) with an invalid stored category', method, skipped);
        }
        return out;
      });
    },

    /**
     * Staff close an open report as `dismissed` or `actioned`, once. In one transaction (lock
     * order in the file header): `by` must be staff now (else `scope`), the report must still be
     * open (else `not_found`, so a second or concurrent review writes nothing), its status is set,
     * `{ actor, action, note, ts }` is appended to `staff_actions`, and a `report.review` audit
     * row names the reply's teacher. A report whose message is gone is `integrity`.
     */
    async review(
      by: unknown,
      reportId: unknown,
      input: ReportReviewInput,
    ): Promise<{ id: string; status: ReportDecision }> {
      const method = 'reports.review';
      const staff = parseArg(IdSchema, by, method);
      const id = parseArg(IdSchema, reportId, method);
      const d = parseArg(ReviewInput, input, method);
      return translateWrite(method, () =>
        db.transaction(async (tx) => {
          await requireStaff(tx, staff, method);
          const [report] = await tx
            .select({ target: reports.target })
            .from(reports)
            .where(and(eq(reports.id, id), eq(reports.status, 'open')))
            .for('update');
          if (!report) throw new RepositoryError('not_found', method);
          const messageId = report.target.startsWith(TARGET_PREFIX)
            ? report.target.slice(TARGET_PREFIX.length)
            : null;
          const [owner] =
            messageId === null
              ? []
              : await tx
                  .select({ teacherId: sessions.teacherId })
                  .from(messages)
                  .innerJoin(sessions, eq(sessions.id, messages.sessionId))
                  .where(eq(messages.id, messageId));
          if (!owner) throw new RepositoryError('integrity', method);
          const note = d.note ?? null;
          await tx
            .update(reports)
            .set({
              status: d.decision,
              staffActions: sql`${reports.staffActions} || jsonb_build_array(jsonb_build_object(
                'actor', ${staff}::text, 'action', ${d.decision}::text,
                'note', ${note}::text, 'ts', now()))`,
            })
            .where(eq(reports.id, id));
          await insertAuditEntry(tx, method, owner.teacherId, null, {
            actor: staff,
            actorRole: 'staff',
            action: 'report.review',
            target: `report:${id}`,
            ...(d.note === undefined ? {} : { reason: d.note }),
            before: { status: 'open' },
            after: { status: d.decision },
          });
          return { id, status: d.decision };
        }),
      );
    },
  };
}
