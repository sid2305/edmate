// Safety alerts (task 12.5a): the staff alert inbox behind the alert worker (4.3).
//
// - Writers: the alert worker only. `record` and `markEscalated` take the contracts
//   `SafetyAlert`, whose student, teacher and session ids are the scope: the row is inserted
//   through the alert's own session (insert-select, like safetyEvents.record), so a session that
//   is not that student x teacher's is `not_found` and nothing is written.
// - Readers: staff only. `listForStaff` and `acknowledge` take the acting user id `by`, whose
//   role must be `staff` right now (read through role-lock.ts, the role column alone). Rows carry
//   ids, the scrubbed excerpt and the teacher's public slug; never a name, email or phone.
// - `isAcknowledged` is the worker's ack read: by alert id, a missing row is `false`.
//
// Lock order (lessons: two writers that lock the same rows in different orders deadlock):
//   1. the acting user row, FOR SHARE (lockRole), in `acknowledge` only;
//   2. the safety_alerts row: FOR UPDATE in `acknowledge`, the upsert's row lock in
//      `markEscalated` (which takes no other row lock first).
// The audit row `acknowledge` writes is an insert (its foreign keys take KEY SHARE locks on the
// teacher and student rows, which never conflict with step 1's FOR SHARE).
import { SafetyAlertSchema } from '@edmate/contracts';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client.js';
import { lockRole } from '../role-lock.js';
import { safetyAlerts, sessions, teacherProfiles } from '../schema/index.js';
import { insertAuditEntry } from './audit.js';
import { RepositoryError, translateWrite } from './errors.js';
import { insertSelect, written } from './insert.js';
import { checked, iso } from './map.js';
import { IdSchema, parseArg } from './scope.js';
import { ownSession } from './sessions.js';

/** Largest page of alerts one staff read returns. */
export const SAFETY_ALERT_LIST_MAX_LIMIT = 50;
/** Longest acknowledgement note, in characters (after trimming). */
export const SAFETY_ALERT_NOTE_MAX_LENGTH = 500;
/** The audit action an acknowledgement writes. */
export const SAFETY_ALERT_ACK_ACTION = 'safety_alert.ack';
/** A round far beyond any real escalation (one per 15 minutes), still inside int4. */
const ROUND_MAX = 1_000_000;

const ListOptions = z.strictObject({
  status: z.enum(['open', 'all']),
  limit: z.int().min(1).max(SAFETY_ALERT_LIST_MAX_LIMIT),
});
const AckInput = z.strictObject({
  alertId: IdSchema,
  note: z.string().trim().min(1).max(SAFETY_ALERT_NOTE_MAX_LENGTH).optional(),
});
const Round = z.int().min(0).max(ROUND_MAX);

export type SafetyAlertListOptions = z.infer<typeof ListOptions>;
export type SafetyAlertAckInput = z.input<typeof AckInput>;

/** One alert as staff see it: ids and the scrubbed excerpt, no personal data. */
export interface SafetyAlertRow {
  id: string;
  level: z.infer<typeof SafetyAlertSchema>['level'];
  kind: z.infer<typeof SafetyAlertSchema>['kind'];
  studentId: string;
  teacherId: string;
  sessionId: string;
  /** The teacher's public slug, or null when the teacher has no profile. */
  teacherSlug: string | null;
  excerptRedacted: string;
  /** The alert's own time. */
  createdAt: string;
  receivedAt: string;
  escalatedAt: string | null;
  escalationRound: number;
  lastPagedAt: string | null;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  ackNote: string | null;
}

const LevelKind = SafetyAlertSchema.pick({ level: true, kind: true });
const isoOrNull = (d: Date | null) => (d === null ? null : iso(d));

/** The columns an alert insert sets from the alert itself; the scope ids come from the session. */
function alertValues(a: z.infer<typeof SafetyAlertSchema>) {
  return [
    [safetyAlerts.id, sql`${a.id}::text`],
    [safetyAlerts.level, sql`${a.level}::text`],
    [safetyAlerts.kind, sql`${a.kind}::text`],
    [safetyAlerts.studentId, sql`${sessions.studentId}`],
    [safetyAlerts.teacherId, sql`${sessions.teacherId}`],
    [safetyAlerts.sessionId, sql`${sessions.id}`],
    [safetyAlerts.excerptRedacted, sql`${a.excerptRedacted}::text`],
    [safetyAlerts.createdAt, sql`${a.createdAt}::timestamptz`],
  ] as const;
}

const fromOwnSession = (a: z.infer<typeof SafetyAlertSchema>) =>
  sql`from ${sessions} where ${ownSession(a.sessionId, a)}`;

export function safetyAlertsRepo(db: Db) {
  /** `by` must be a current staff user, else `scope`. `tx` is the caller's transaction or db. */
  async function requireStaff(tx: Pick<Db, 'select'>, by: string, method: string) {
    if ((await lockRole(tx, by)) !== 'staff') throw new RepositoryError('scope', method);
  }

  return {
    /**
     * Stores the alert on its own session. `written: false` when the row was already there (a
     * replay); an alert whose session is not its student x teacher's, or whose id is taken by
     * another scope's alert, is `not_found` and nothing is written.
     */
    async record(alert: z.input<typeof SafetyAlertSchema>): Promise<{ written: boolean }> {
      const method = 'safetyAlerts.record';
      const a = parseArg(SafetyAlertSchema, alert, method);
      const result = await translateWrite(method, () =>
        db.execute(
          sql`${insertSelect(safetyAlerts, alertValues(a), fromOwnSession(a))} on conflict (id) do nothing`,
        ),
      );
      if (written(result) === 1) return { written: true };
      const [found] = await db
        .select({ id: safetyAlerts.id })
        .from(safetyAlerts)
        .where(
          and(
            eq(safetyAlerts.id, a.id),
            eq(safetyAlerts.sessionId, a.sessionId),
            eq(safetyAlerts.studentId, a.studentId),
            eq(safetyAlerts.teacherId, a.teacherId),
          ),
        );
      if (found === undefined) throw new RepositoryError('not_found', method);
      return { written: false };
    },

    /**
     * Check `round` (0 is the first, 15 minutes after the raise) found the alert unacknowledged
     * and paged on-call. Upserts through the same session scoping, so it works even if `record`
     * never ran: `escalation_round` becomes at least `round + 1` (never lowered),
     * `escalated_at` keeps its first value and `last_paged_at` is now. Acknowledgement fields
     * are never touched. Returns the stored round.
     */
    async markEscalated(
      alert: z.input<typeof SafetyAlertSchema>,
      round: number,
    ): Promise<{ round: number }> {
      const method = 'safetyAlerts.markEscalated';
      const a = parseArg(SafetyAlertSchema, alert, method);
      const r = parseArg(Round, round, method);
      const values = [
        ...alertValues(a),
        [safetyAlerts.escalatedAt, sql`now()`],
        [safetyAlerts.escalationRound, sql`${r + 1}::int`],
        [safetyAlerts.lastPagedAt, sql`now()`],
      ] as const;
      const result = await translateWrite(method, () =>
        db.execute<{ escalation_round: number }>(
          sql`${insertSelect(safetyAlerts, values, fromOwnSession(a))}
            on conflict (id) do update set
              escalation_round = greatest(${safetyAlerts.escalationRound}, excluded.escalation_round),
              escalated_at = coalesce(${safetyAlerts.escalatedAt}, now()),
              last_paged_at = now(),
              updated_at = now()
            where ${safetyAlerts.sessionId} = excluded.session_id
              and ${safetyAlerts.studentId} = excluded.student_id
              and ${safetyAlerts.teacherId} = excluded.teacher_id
            returning ${safetyAlerts.escalationRound}`,
        ),
      );
      const stored = result.rows[0]?.escalation_round;
      if (stored === undefined) throw new RepositoryError('not_found', method);
      return { round: stored };
    },

    /** Whether staff acknowledged the alert; a missing row is `false`. */
    async isAcknowledged(alertId: string): Promise<boolean> {
      const method = 'safetyAlerts.isAcknowledged';
      const id = parseArg(IdSchema, alertId, method);
      const [row] = await db
        .select({ at: safetyAlerts.acknowledgedAt })
        .from(safetyAlerts)
        .where(eq(safetyAlerts.id, id));
      return row !== undefined && row.at !== null;
    },

    /**
     * Task 13.4b: whether the student has any open (unacknowledged) safety alert, across every
     * teacher -- serves only the student's own account-delete hold (`DELETE /api/me`), never
     * staff's inbox. Returns a boolean only, never alert content. No alert at all is `false`,
     * same as `isAcknowledged`'s missing-row case.
     */
    async hasOpenForStudent(studentId: string): Promise<boolean> {
      const method = 'safetyAlerts.hasOpenForStudent';
      const id = parseArg(IdSchema, studentId, method);
      const [row] = await db
        .select({ id: safetyAlerts.id })
        .from(safetyAlerts)
        .where(and(eq(safetyAlerts.studentId, id), isNull(safetyAlerts.acknowledgedAt)))
        .limit(1);
      return row !== undefined;
    },

    /**
     * The staff inbox. `by` must be staff right now (a plain read of the role: this writes
     * nothing, as in teacherProfiles.listPendingForStaff), else `scope`. Open alerts first,
     * escalated before unescalated, then oldest first; `status: 'open'` leaves acknowledged
     * ones out. At most `limit` (cap `SAFETY_ALERT_LIST_MAX_LIMIT`) rows.
     */
    async listForStaff(by: string, options: SafetyAlertListOptions): Promise<SafetyAlertRow[]> {
      const method = 'safetyAlerts.listForStaff';
      const actor = parseArg(IdSchema, by, method);
      const { status, limit } = parseArg(ListOptions, options, method);
      await requireStaff(db, actor, method);
      const rows = await db
        .select({
          id: safetyAlerts.id,
          level: safetyAlerts.level,
          kind: safetyAlerts.kind,
          studentId: safetyAlerts.studentId,
          teacherId: safetyAlerts.teacherId,
          sessionId: safetyAlerts.sessionId,
          teacherSlug: teacherProfiles.slug,
          excerptRedacted: safetyAlerts.excerptRedacted,
          createdAt: safetyAlerts.createdAt,
          receivedAt: safetyAlerts.receivedAt,
          escalatedAt: safetyAlerts.escalatedAt,
          escalationRound: safetyAlerts.escalationRound,
          lastPagedAt: safetyAlerts.lastPagedAt,
          acknowledgedAt: safetyAlerts.acknowledgedAt,
          acknowledgedBy: safetyAlerts.acknowledgedBy,
          ackNote: safetyAlerts.ackNote,
        })
        .from(safetyAlerts)
        .leftJoin(teacherProfiles, eq(teacherProfiles.userId, safetyAlerts.teacherId))
        .where(status === 'open' ? isNull(safetyAlerts.acknowledgedAt) : undefined)
        .orderBy(
          sql`${safetyAlerts.acknowledgedAt} is not null`,
          sql`${safetyAlerts.escalatedAt} is null`,
          asc(safetyAlerts.createdAt),
          asc(safetyAlerts.id),
        )
        .limit(limit);
      return rows.map((r) => {
        const { level, kind } = checked(LevelKind, { level: r.level, kind: r.kind }, method);
        return {
          ...r,
          level,
          kind,
          createdAt: iso(r.createdAt),
          receivedAt: iso(r.receivedAt),
          escalatedAt: isoOrNull(r.escalatedAt),
          lastPagedAt: isoOrNull(r.lastPagedAt),
          acknowledgedAt: isoOrNull(r.acknowledgedAt),
        };
      });
    },

    /**
     * A staff user acknowledges an alert, with an optional note (trimmed, at most
     * `SAFETY_ALERT_NOTE_MAX_LENGTH`). One transaction, in the lock order above: `by` must be
     * staff (share-locked) else `scope`; the alert row is locked, `not_found` if missing. An
     * alert already acknowledged returns `acknowledged: false` and writes nothing; otherwise the
     * ack fields are set and one `safety_alert.ack` audit row (for the alert's teacher and
     * student, never the excerpt) commits with them.
     */
    async acknowledge(by: string, input: SafetyAlertAckInput): Promise<{ acknowledged: boolean }> {
      const method = 'safetyAlerts.acknowledge';
      const actor = parseArg(IdSchema, by, method);
      const { alertId, note } = parseArg(AckInput, input, method);
      return db.transaction(async (tx) => {
        await requireStaff(tx, actor, method);
        const [current] = await tx
          .select({
            studentId: safetyAlerts.studentId,
            teacherId: safetyAlerts.teacherId,
            acknowledgedAt: safetyAlerts.acknowledgedAt,
            escalationRound: safetyAlerts.escalationRound,
          })
          .from(safetyAlerts)
          .where(eq(safetyAlerts.id, alertId))
          .for('update');
        if (current === undefined) throw new RepositoryError('not_found', method);
        if (current.acknowledgedAt !== null) return { acknowledged: false };
        const [after] = await tx
          .update(safetyAlerts)
          .set({
            acknowledgedAt: sql`now()`,
            acknowledgedBy: actor,
            ackNote: note ?? null,
            updatedAt: sql`now()`,
          })
          .where(eq(safetyAlerts.id, alertId))
          .returning({ acknowledgedAt: safetyAlerts.acknowledgedAt });
        await insertAuditEntry(tx, method, current.teacherId, current.studentId, {
          actor,
          actorRole: 'staff',
          action: SAFETY_ALERT_ACK_ACTION,
          target: `safety_alert:${alertId}`,
          ...(note === undefined ? {} : { reason: note }),
          before: { acknowledgedAt: null, escalationRound: current.escalationRound },
          after: { acknowledgedAt: isoOrNull(after!.acknowledgedAt), acknowledgedBy: actor },
        });
        return { acknowledged: true };
      });
    },
  };
}
