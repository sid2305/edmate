// Rows leave repositories as contract shapes, parsed. A stored row that fails its contract, or
// whose jsonb disagrees with its own columns, throws `integrity` and is never returned.
// Absent optional fields are omitted, never `undefined` (exactOptionalPropertyTypes).
import {
  AgentConfigSchema,
  LearnerProfileSchema,
  MessageSchema,
  PackageConfigSchema,
  TeacherQuestionSchema,
  type AgentConfig,
  type LearnerProfile,
  type Message,
  type PackageConfig,
  type TeacherQuestion,
} from '@edmate/contracts';
import { z } from 'zod';
import { RepositoryError } from './errors.js';

/** A teacher's view of a question: the asking student is never shown (build plan § Ask the teacher). */
export type TeacherQuestionForTeacher = Omit<TeacherQuestion, 'studentId'>;
const TeacherQuestionForTeacherSchema = TeacherQuestionSchema.omit({ studentId: true });

/** Parses a stored value against its contract, or throws `integrity`. */
export function checked<T>(schema: z.ZodType<T>, value: unknown, method: string): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new RepositoryError('integrity', method);
  return r.data;
}

export const iso = (d: Date) => d.toISOString();

export function toAgentConfig(
  row: { teacherId: string; agentId: string; version: number; config: unknown },
  method: string,
): AgentConfig {
  const c = checked(AgentConfigSchema, row.config, method);
  if (c.teacherId !== row.teacherId || c.id !== row.agentId || c.version !== row.version) {
    throw new RepositoryError('integrity', method);
  }
  return c;
}

export function toPackageConfig(
  row: { teacherId: string; packageId: string; version: number; config: unknown },
  method: string,
): PackageConfig {
  const c = checked(PackageConfigSchema, row.config, method);
  if (c.teacherId !== row.teacherId || c.id !== row.packageId || c.version !== row.version) {
    throw new RepositoryError('integrity', method);
  }
  return c;
}

export function toMessage(
  row: { id: string; role: string; text: string; sources: unknown; createdAt: Date },
  method: string,
): Message {
  return checked(
    MessageSchema,
    {
      id: row.id,
      role: row.role,
      text: row.text,
      createdAt: iso(row.createdAt),
      ...(row.sources === null ? {} : { sources: row.sources }),
    },
    method,
  );
}

export function toLearnerProfile(
  row: {
    studentId: string;
    teacherId: string;
    lang: string;
    mastery: unknown;
    mistakes: unknown;
    lastSummary: string | null;
  },
  method: string,
): LearnerProfile {
  return checked(
    LearnerProfileSchema,
    {
      studentId: row.studentId,
      teacherId: row.teacherId,
      lang: row.lang,
      mastery: row.mastery,
      mistakes: row.mistakes,
      ...(row.lastSummary === null ? {} : { lastSummary: row.lastSummary }),
    },
    method,
  );
}

interface QuestionRow {
  id: string;
  teacherId: string;
  agentId: string;
  text: string;
  moduleHint: string | null;
  similarIds: string[];
  status: string;
  createdAt: Date;
  answeredAt: Date | null;
}

function questionFields(row: QuestionRow) {
  return {
    id: row.id,
    teacherId: row.teacherId,
    agentId: row.agentId,
    text: row.text,
    ...(row.moduleHint === null ? {} : { moduleHint: row.moduleHint }),
    similarIds: row.similarIds,
    status: row.status,
    createdAt: iso(row.createdAt),
    ...(row.answeredAt === null ? {} : { answeredAt: iso(row.answeredAt) }),
  };
}

export function toTeacherQuestion(
  row: QuestionRow & { studentId: string },
  method: string,
): TeacherQuestion {
  return checked(
    TeacherQuestionSchema,
    { ...questionFields(row), studentId: row.studentId },
    method,
  );
}

export function toTeacherQuestionForTeacher(
  row: QuestionRow,
  method: string,
): TeacherQuestionForTeacher {
  return checked(TeacherQuestionForTeacherSchema, questionFields(row), method);
}

const AuditRowSchema = z.strictObject({
  id: z.string().min(1),
  actor: z.string().min(1),
  actorRole: z.enum(['student', 'teacher', 'staff']),
  action: z.string().min(1),
  target: z.string().min(1),
  teacherId: z.string().min(1),
  /** Present on student x teacher rows (memory changes) only. */
  studentId: z.string().min(1).optional(),
  reason: z.string().optional(),
  /** Already redacted of personal keys when it was written. */
  before: z.unknown().optional(),
  after: z.unknown().optional(),
  ts: z.iso.datetime(),
});

/** An audit_log row as read. No contract type exists for it (same precedent as SessionRow). */
export type AuditRow = z.infer<typeof AuditRowSchema>;

export function toAuditRow(
  row: {
    id: string;
    actor: string;
    actorRole: string;
    action: string;
    target: string;
    teacherId: string;
    studentId: string | null;
    reason: string | null;
    before: unknown;
    after: unknown;
    ts: Date;
  },
  method: string,
): AuditRow {
  return checked(
    AuditRowSchema,
    {
      id: row.id,
      actor: row.actor,
      actorRole: row.actorRole,
      action: row.action,
      target: row.target,
      teacherId: row.teacherId,
      ...(row.studentId === null ? {} : { studentId: row.studentId }),
      ...(row.reason === null ? {} : { reason: row.reason }),
      ...(row.before === null ? {} : { before: row.before }),
      ...(row.after === null ? {} : { after: row.after }),
      ts: iso(row.ts),
    },
    method,
  );
}
