// Audit log (task 1.6): config, staff and memory changes, with before/after. Append-only: there is
// no update and no delete method. Every row belongs to one teacher; memory and other student x
// teacher events also carry the student. Reads are scoped like every other repository; staff's
// cross-teacher view is the trust console's own read path (12.1), not built here.
import { and, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client.js';
import { auditLog } from '../schema/index.js';
import { RepositoryError, translateWrite } from './errors.js';
import { toAuditRow, type AuditRow } from './map.js';
import { redactPersonalData } from './redact-json.js';
import {
  IdSchema,
  parseArg,
  studentScope,
  teacherScope,
  type StudentScope,
  type TeacherScope,
} from './scope.js';

/** Largest page of audit rows. */
export const AUDIT_MAX_LIMIT = 200;
/** Largest serialised before or after, in characters, after redaction. Larger is `invalid`. */
export const AUDIT_JSON_MAX_LENGTH = 10_000;

/** What a caller records. `actor` is the user who acted, in the role they acted in. */
export interface AuditEntryInput {
  actor: string;
  actorRole: 'student' | 'teacher' | 'staff';
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
  actorRole: z.enum(['student', 'teacher', 'staff']),
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
 * act on anyone's rows; their authority is checked by the caller's role check.
 */
function checkActor(e: ParsedEntry, teacherId: string, studentId: string | null, method: string) {
  const ok =
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

export function auditRepo(db: Db) {
  /** The one write path: actor check, redaction and size cap live here. */
  async function insertEntry(
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
  };
}
