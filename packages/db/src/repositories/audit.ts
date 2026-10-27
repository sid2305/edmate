// Audit log (task 1.6): config, staff and memory changes, with before/after. Append-only: there is
// no update and no delete method. Every row belongs to one teacher; memory and other student x
// teacher events also carry the student. Reads are scoped like every other repository; staff's
// cross-teacher view is the trust console's own read path (12.1), not built here.
import { and, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client.js';
import { lockRole } from '../role-lock.js';
import { auditLog } from '../schema/index.js';
import { RepositoryError, translateWrite } from './errors.js';
import { iso, toAuditRow, type AuditRow } from './map.js';
import { redactPersonalData } from './redact-json.js';
import {
  IdSchema,
  parseArg,
  studentScope,
  teacherScope,
  type StudentScope,
  type TeacherScope,
} from './scope.js';

/** The decided status stored on a `teacher.verify` audit row's own `after.verificationStatus`. */
const VerifyAfter = z.object({ verificationStatus: z.enum(['verified', 'rejected']) });

/** A `teacher.subject` audit row's own `before`/`after` shape: the subject, nothing else. */
const SubjectChange = z.strictObject({ subject: z.string() });

/** Largest page of audit rows. */
export const AUDIT_MAX_LIMIT = 200;
/**
 * Task 9.3m (B-58): the most subject changes staff see for one teacher. Its own, smaller cap --
 * not `AUDIT_MAX_LIMIT`, which bounds other, general-purpose reads.
 */
export const SUBJECT_HISTORY_MAX_LIMIT = 10;
const SubjectHistoryLimit = z.int().min(1).max(SUBJECT_HISTORY_MAX_LIMIT);
/** Largest serialised before or after, in characters, after redaction. Larger is `invalid`. */
export const AUDIT_JSON_MAX_LENGTH = 10_000;

/** Prefix every `system` actor id carries, so an automated actor never looks like a user id. */
export const SYSTEM_ACTOR_PREFIX = 'system_';

/**
 * What a caller records. `actor` is the user who acted, in the role they acted in, or an
 * automated actor (`system`, task 2.5) whose id starts with `system_`.
 */
export interface AuditEntryInput {
  actor: string;
  actorRole: 'student' | 'teacher' | 'staff' | 'system';
  /** For example `package.publish`, `teacher.verify`, `profile.reset`. */
  action: string;
  /** `<kind>:<id>`, for example `package:pkg_1` (advisory, not checked against a table). */
  target: string;
  reason?: string;
  /** Keep personal text out: personal keys are redacted, free text inside values is not. */
  before?: unknown;
  after?: unknown;
}

const Entry = z.strictObject({
  actor: IdSchema,
  actorRole: z.enum(['student', 'teacher', 'staff', 'system']),
  action: z.string().min(1).max(100),
  target: z.string().min(1).max(200),
  reason: z.string().min(1).max(500).optional(),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
});

const ListOptions = z.strictObject({
  target: z.string().min(1).max(200).optional(),
  limit: z.int().min(1).max(AUDIT_MAX_LIMIT),
});

type ParsedEntry = z.infer<typeof Entry>;

/**
 * A before/after value as the jsonb parameter to store, or null. It goes through JSON first, so
 * class instances, `toJSON` and dates are plain data before redaction sees them; then it is
 * redacted and size-capped. Anything JSON can't hold (a bigint, a cycle, a bare function) and
 * anything over the cap is `invalid`: rejected, never truncated.
 */
function storable(value: unknown, method: string): SQL | null {
  if (value === undefined || value === null) return null;
  let plain: string | undefined;
  try {
    plain = JSON.stringify(value);
  } catch {
    throw new RepositoryError('invalid', method);
  }
  if (plain === undefined) throw new RepositoryError('invalid', method);
  const redacted = JSON.stringify(redactPersonalData(JSON.parse(plain)));
  if (redacted.length > AUDIT_JSON_MAX_LENGTH) throw new RepositoryError('invalid', method);
  return sql`${redacted}::jsonb`;
}

/**
 * The actor must be who the scope says: a teacher actor is the scope's teacher, a student actor is
 * the scope's student (teacher-only rows have no student, so a student can't act on them). Staff
 * act on anyone's rows; their authority is checked by the caller's role check. A system actor's
 * id must start with `system_` (and no other role's may), so the two never pass for each other.
 */
function checkActor(e: ParsedEntry, teacherId: string, studentId: string | null, method: string) {
  const system = e.actor.startsWith(SYSTEM_ACTOR_PREFIX);
  if (system !== (e.actorRole === 'system')) throw new RepositoryError('scope', method);
  const ok =
    e.actorRole === 'system' ||
    e.actorRole === 'staff' ||
    (e.actorRole === 'teacher' && e.actor === teacherId) ||
    (e.actorRole === 'student' && studentId !== null && e.actor === studentId);
  if (!ok) throw new RepositoryError('scope', method);
}

const columns = {
  id: auditLog.id,
  actor: auditLog.actor,
  actorRole: auditLog.actorRole,
  action: auditLog.action,
  target: auditLog.target,
  teacherId: auditLog.teacherId,
  studentId: auditLog.studentId,
  reason: auditLog.reason,
  before: auditLog.before,
  after: auditLog.after,
  ts: auditLog.ts,
};

/** Anything that can insert: the database or an open transaction. */
type Inserter = Pick<Db, 'insert'>;

/**
 * The one write path: actor check, redaction and size cap live here. Other repositories call it
 * with their own transaction when an audit row must commit with the change it records (2.5).
 * Scopes are the caller's job: `teacherId` / `studentId` must already be validated.
 */
export async function insertAuditEntry(
  db: Inserter,
  method: string,
  teacherId: string,
  studentId: string | null,
  input: unknown,
): Promise<void> {
  const e = parseArg(Entry, input, method);
  checkActor(e, teacherId, studentId, method);
  const before = storable(e.before, method);
  const after = storable(e.after, method);
  await translateWrite(method, () =>
    db.insert(auditLog).values({
      actor: e.actor,
      actorRole: e.actorRole,
      action: e.action,
      target: e.target,
      teacherId,
      studentId,
      reason: e.reason ?? null,
      before,
      after,
    }),
  );
}

export function auditRepo(db: Db) {
  const insertEntry = (
    method: string,
    teacherId: string,
    studentId: string | null,
    input: unknown,
  ) => insertAuditEntry(db, method, teacherId, studentId, input);

  async function list(method: string, where: SQL | undefined, options: unknown) {
    const { target, limit } = parseArg(ListOptions, options, method);
    const rows = await db
      .select(columns)
      .from(auditLog)
      .where(and(where, target === undefined ? undefined : eq(auditLog.target, target)))
      .orderBy(desc(auditLog.ts), desc(auditLog.id))
      .limit(limit);
    return rows.map((r) => toAuditRow(r, method));
  }

  return {
    /**
     * Records a change to the scope's teacher's own data (config, or a staff action on the
     * teacher or their content). A ghost scope id is `not_found`.
     */
    async appendForTeacher(scope: TeacherScope, entry: AuditEntryInput): Promise<void> {
      const method = 'audit.appendForTeacher';
      const { teacherId } = teacherScope(scope, method);
      await insertEntry(method, teacherId, null, entry);
    },

    /** Records a change to one student x teacher pair's data (memory, or a staff action on it). */
    async appendForStudent(scope: StudentScope, entry: AuditEntryInput): Promise<void> {
      const method = 'audit.appendForStudent';
      const { studentId, teacherId } = studentScope(scope, method);
      await insertEntry(method, teacherId, studentId, entry);
    },

    /**
     * The teacher's own audit rows, newest first. Student x teacher rows are not included: a
     * student's memory changes are theirs, and the teacher never sees which student did what.
     */
    async listForTeacher(
      scope: TeacherScope,
      options: { target?: string; limit: number },
    ): Promise<AuditRow[]> {
      const method = 'audit.listForTeacher';
      const { teacherId } = teacherScope(scope, method);
      return list(
        method,
        and(eq(auditLog.teacherId, teacherId), isNull(auditLog.studentId)),
        options,
      );
    },

    /** The scope's student x teacher audit rows, newest first. */
    async listForStudent(
      scope: StudentScope,
      options: { target?: string; limit: number },
    ): Promise<AuditRow[]> {
      const method = 'audit.listForStudent';
      const { studentId, teacherId } = studentScope(scope, method);
      return list(
        method,
        and(eq(auditLog.teacherId, teacherId), eq(auditLog.studentId, studentId)),
        options,
      );
    },

    /**
     * Task 9.3h: the newest `teacher.verify` decision on `teacherId`'s row (written by
     * `teacherProfiles.setVerification`), for `by`, a user who is staff right now (`lockRole`,
     * same precedent as `takedowns.listActiveForStaff` -- this never writes, but a repository
     * source file may never name the accounts table itself, so the role check always goes through
     * `role-lock.ts`). A malformed `by` or `teacherId` is `invalid` before any SQL; a well-formed
     * `by` who is not staff right now is `scope`; a teacher never decided is `null`. A stored
     * `after` that fails its own shape is `integrity` (never returned).
     */
    async findLastVerifyForStaff(
      by: unknown,
      teacherId: unknown,
    ): Promise<{ status: 'verified' | 'rejected'; reason: string | null; ts: string } | null> {
      const method = 'audit.findLastVerifyForStaff';
      const staff = parseArg(IdSchema, by, method);
      const tid = parseArg(IdSchema, teacherId, method);
      return db.transaction(async (tx) => {
        if ((await lockRole(tx, staff)) !== 'staff') throw new RepositoryError('scope', method);
        const [row] = await tx
          .select({ after: auditLog.after, reason: auditLog.reason, ts: auditLog.ts })
          .from(auditLog)
          .where(and(eq(auditLog.teacherId, tid), eq(auditLog.action, 'teacher.verify')))
          .orderBy(desc(auditLog.ts), desc(auditLog.id))
          .limit(1);
        if (!row) return null;
        const after = VerifyAfter.safeParse(row.after);
        if (!after.success) throw new RepositoryError('integrity', method);
        return { status: after.data.verificationStatus, reason: row.reason, ts: iso(row.ts) };
      });
    },

    /**
     * Task 9.3m (B-58): the last `limit` (at most `SUBJECT_HISTORY_MAX_LIMIT`) `teacher.subject`
     * changes on `teacherId`'s row (written by `teacherProfiles.update`), newest first, for
     * `by`, a user who is staff right now (same `lockRole`-gated precedent as
     * `findLastVerifyForStaff`). A malformed `by`, `teacherId` or out-of-range `limit` is
     * `invalid` before any SQL; a well-formed `by` who is not staff right now is `scope`; a
     * teacher with no subject changes is `[]`. A stored `before`/`after` that fails its own
     * shape is `integrity` (never returned).
     */
    async findSubjectHistoryForStaff(
      by: unknown,
      teacherId: unknown,
      limit: unknown,
    ): Promise<{ from: string; to: string; ts: string }[]> {
      const method = 'audit.findSubjectHistoryForStaff';
      const staff = parseArg(IdSchema, by, method);
      const tid = parseArg(IdSchema, teacherId, method);
      const n = parseArg(SubjectHistoryLimit, limit, method);
      return db.transaction(async (tx) => {
        if ((await lockRole(tx, staff)) !== 'staff') throw new RepositoryError('scope', method);
        const rows = await tx
          .select({ before: auditLog.before, after: auditLog.after, ts: auditLog.ts })
          .from(auditLog)
          .where(and(eq(auditLog.teacherId, tid), eq(auditLog.action, 'teacher.subject')))
          .orderBy(desc(auditLog.ts), desc(auditLog.id))
          .limit(n);
        return rows.map((row) => {
          const before = SubjectChange.safeParse(row.before);
          const after = SubjectChange.safeParse(row.after);
          if (!before.success || !after.success) throw new RepositoryError('integrity', method);
          return { from: before.data.subject, to: after.data.subject, ts: iso(row.ts) };
        });
      });
    },
  };
}
