// Rows leave repositories as contract shapes, parsed. A stored row that fails its contract, or
// whose jsonb disagrees with its own columns, throws `integrity` and is never returned.
// Absent optional fields are omitted, never `undefined` (exactOptionalPropertyTypes).
import {
  AgentConfigSchema,
  ChunkKindSchema,
  LearnerProfileSchema,
  MessageSchema,
  PackageConfigSchema,
  SourceRefSchema,
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
  actorRole: z.enum(['student', 'teacher', 'staff', 'system']),
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

/** Where a document is in ingestion (task 8.2); equals the `document_status` enum. */
export const DOCUMENT_STATUSES = ['uploading', 'processing', 'ready', 'failed'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

const DocumentRowSchema = z.strictObject({
  id: z.string().min(1),
  teacherId: z.string().min(1),
  moduleId: z.string().min(1),
  kind: ChunkKindSchema,
  sourceTitle: z.string().min(1),
  storageKey: z.string().min(1).optional(),
  status: z.enum(DOCUMENT_STATUSES),
  failureReason: z.string().min(1).optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

/**
 * A documents row as its teacher sees it in the upload centre (task 8.2). No contract type exists
 * for it (same precedent as AuditRow). `rightsDeclaredAt` is not returned yet.
 */
export type DocumentRow = z.infer<typeof DocumentRowSchema>;

export function toDocumentRow(
  row: {
    id: string;
    teacherId: string;
    moduleId: string;
    kind: string;
    sourceTitle: string;
    storageKey: string | null;
    status: string;
    failureReason: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
  method: string,
): DocumentRow {
  return checked(
    DocumentRowSchema,
    {
      id: row.id,
      teacherId: row.teacherId,
      moduleId: row.moduleId,
      kind: row.kind,
      sourceTitle: row.sourceTitle,
      ...(row.storageKey === null ? {} : { storageKey: row.storageKey }),
      status: row.status,
      ...(row.failureReason === null ? {} : { failureReason: row.failureReason }),
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    },
    method,
  );
}

const TeacherProfileRowSchema = z.strictObject({
  id: z.string().min(1),
  teacherId: z.string().min(1),
  slug: z.string().min(1),
  subject: z.string().min(1),
  bio: z.string(),
  languages: z.array(z.string()),
  verificationStatus: z.enum(['pending', 'verified', 'rejected']),
});

/**
 * A teacher_profiles row as the teacher sees it (task 8.1). No contract type exists for it (same
 * precedent as AuditRow). `photo` (no input yet) and `payoutAccountRef` (M10) are not returned.
 */
export type TeacherProfileRow = z.infer<typeof TeacherProfileRowSchema>;

export function toTeacherProfile(
  row: {
    id: string;
    userId: string;
    slug: string;
    subject: string;
    bio: string;
    languages: string[];
    verificationStatus: string;
  },
  method: string,
): TeacherProfileRow {
  return checked(
    TeacherProfileRowSchema,
    {
      id: row.id,
      teacherId: row.userId,
      slug: row.slug,
      subject: row.subject,
      bio: row.bio,
      languages: row.languages,
      verificationStatus: row.verificationStatus,
    },
    method,
  );
}

const TeacherVerificationQueueRowSchema = z.strictObject({
  id: z.string().min(1),
  teacherId: z.string().min(1),
  slug: z.string().min(1),
  subject: z.string().min(1),
  verificationStatus: z.enum(['pending', 'verified', 'rejected']),
  /** The declared name and email staff use to check identity (task 12.1a: staff-only). */
  name: z.string().min(1),
  email: z.string().min(1).nullable(),
});

/**
 * A pending teacher_profiles row joined to its user, as only a staff queue sees it (task 12.1a).
 * No contract type exists for it (same precedent as AuditRow). Unlike TeacherProfileRow, this
 * carries `name` and `email` -- staff-only, never returned to a teacher or a public read.
 */
export type TeacherVerificationQueueRow = z.infer<typeof TeacherVerificationQueueRowSchema>;

export function toTeacherVerificationQueueRow(
  row: {
    id: string;
    userId: string;
    slug: string;
    subject: string;
    verificationStatus: string;
    name: string;
    email: string | null;
  },
  method: string,
): TeacherVerificationQueueRow {
  return checked(
    TeacherVerificationQueueRowSchema,
    {
      id: row.id,
      teacherId: row.userId,
      slug: row.slug,
      subject: row.subject,
      verificationStatus: row.verificationStatus,
      name: row.name,
      email: row.email,
    },
    method,
  );
}

// Task 8.3: the studio outline. No contract type exists for it (same precedent as DocumentRow);
// `@edmate/ingest`'s OutlineDraft is the drafter's output, not the stored shape.
const CourseRowSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1),
  outlineVersion: z.int().min(1),
});
/** A teacher's course as the studio sees it. */
export type CourseRow = z.infer<typeof CourseRowSchema>;

/** A courses row, or `integrity` (also for a missing row the caller expected to exist). */
export function toCourseRow(
  row: { id: string; title: string; outlineVersion: number } | undefined,
  method: string,
): CourseRow {
  return checked(CourseRowSchema, row, method);
}

const OutlineSourceSchema = z.strictObject({
  chunkId: z.string().min(1),
  sourceTitle: z.string().min(1),
  locator: z.string(),
});
const OutlineTopicRowSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1),
  order: z.int(),
  /** The chunks backing this topic, in link order: display fields only, never chunk text. */
  chunkIds: z.array(OutlineSourceSchema),
});
const OutlineModuleRowSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1),
  order: z.int(),
  topics: z.array(OutlineTopicRowSchema),
});
const OutlineSchema = z.strictObject({
  courseId: z.string().min(1),
  outlineVersion: z.int().min(1),
  modules: z.array(OutlineModuleRowSchema),
});
/** One source link of a topic: which chunk, from which file, where in it. */
export type OutlineSource = z.infer<typeof OutlineSourceSchema>;
export type OutlineTopicRow = z.infer<typeof OutlineTopicRowSchema>;
export type OutlineModuleRow = z.infer<typeof OutlineModuleRowSchema>;
/** A teacher's whole outline: modules in order, each with its topics and their source links. */
export type Outline = z.infer<typeof OutlineSchema>;

export function toOutline(value: Outline, method: string): Outline {
  return checked(OutlineSchema, value, method);
}

const RegulatedAgentRowSchema = z.strictObject({
  agentId: z.string().min(1),
  /** The teacher's public slug, or null when the teacher has no profile. */
  teacherSlug: z.string().min(1).nullable(),
  status: z.enum(['draft', 'live', 'suspended']),
  liveVersion: z.int().min(1).nullable(),
  regulatedSubject: AgentConfigSchema.shape.regulatedSubject.unwrap().nullable(),
  approvedAt: z.iso.datetime().nullable(),
  /** The approving staff user's id; never a name or email. */
  approvedBy: z.string().min(1).nullable(),
});

/**
 * One agent as the staff regulated-subject list sees it (task 12.4a): ids, the public slug and
 * the flag columns. No contract type exists for it (same precedent as AuditRow); no name, email
 * or phone.
 */
export type RegulatedAgentRow = z.infer<typeof RegulatedAgentRowSchema>;

export function toRegulatedAgentRow(
  row: {
    agentId: string;
    teacherSlug: string | null;
    status: string;
    liveVersion: number | null;
    regulatedSubject: string | null;
    approvedAt: Date | null;
    approvedBy: string | null;
  },
  method: string,
): RegulatedAgentRow {
  return checked(
    RegulatedAgentRowSchema,
    { ...row, approvedAt: row.approvedAt === null ? null : iso(row.approvedAt) },
    method,
  );
}

// Task 12.2a: the staff reports queue. The categories live here (not in reports.ts) so this file
// never imports a repository; reports.ts re-exports them.
/** What a student can say about a reply: a closed set, never free text (12.2 Q2). */
export const REPORT_CATEGORIES = [
  'harmful',
  'inappropriate',
  'wrong_information',
  'copyright',
  'other',
] as const;
export const ReportCategorySchema = z.enum(REPORT_CATEGORIES);
export type ReportCategory = z.infer<typeof ReportCategorySchema>;
/** At most this many cited documents per report in the staff queue. */
export const REPORT_CITED_DOCUMENTS_MAX = 10;

const StaffReportRowSchema = z.strictObject({
  id: z.string().min(1),
  category: ReportCategorySchema,
  status: z.literal('open'),
  createdAt: z.string().min(1),
  messageId: z.string().min(1),
  /** From the reported message's session; null only when the message is gone. */
  teacherId: z.string().min(1).nullable(),
  agentId: z.string().min(1).nullable(),
  /** The teacher's public slug; null when the teacher has no profile (or the message is gone). */
  teacherSlug: z.string().min(1).nullable(),
  message: z
    .strictObject({
      role: z.enum(['agent', 'teacher']),
      text: z.string(),
      sources: z.array(SourceRefSchema).optional(),
      createdAt: z.string().min(1),
    })
    .nullable(),
  /** The teacher's documents whose title a cited source names, for a takedown decision. */
  citedDocuments: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        title: z.string(),
        kind: ChunkKindSchema,
        takenDown: z.boolean(),
      }),
    )
    .max(REPORT_CITED_DOCUMENTS_MAX),
});

/**
 * One open report as only staff see it (task 12.2a): the reported reply and where it came from.
 * Never the reporter's id, name, email or phone, and never the session id.
 */
export type StaffReportRow = z.infer<typeof StaffReportRowSchema>;

export function toStaffReportRow(value: unknown, method: string): StaffReportRow {
  return checked(StaffReportRowSchema, value, method);
}
