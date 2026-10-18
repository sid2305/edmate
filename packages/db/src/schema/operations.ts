// Data model rows: eval_runs / eval_results, live_classes / class_questions, insights,
// reports / takedowns / safety_events, audit_log.
import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { id, timestamps, tstz, userRole } from './_shared.js';
import { agentVersions } from './agents.js';
import { teacherId, users } from './users.js';

/** Quality gate: one suite run against one agent version. */
export const evalRuns = pgTable(
  'eval_runs',
  {
    id: id(),
    teacherId: teacherId(),
    agentVersionId: text('agent_version_id')
      .notNull()
      .references(() => agentVersions.id),
    suite: text('suite').notNull(),
    model: text('model').notNull(),
    /** 0..1; null while running. */
    passRate: doublePrecision('pass_rate'),
    finishedAt: tstz('finished_at'),
    ...timestamps(),
  },
  (t) => [
    index('eval_runs_teacher_id_idx').on(t.teacherId),
    index('eval_runs_agent_version_id_suite_idx').on(t.agentVersionId, t.suite),
  ],
);

export const evalResults = pgTable(
  'eval_results',
  {
    id: id(),
    evalRunId: text('eval_run_id')
      .notNull()
      .references(() => evalRuns.id),
    caseId: text('case_id').notNull(),
    passed: boolean('passed').notNull(),
    details: jsonb('details'),
    ...timestamps(),
  },
  (t) => [uniqueIndex('eval_results_eval_run_id_case_id_key').on(t.evalRunId, t.caseId)],
);

/** The teacher's live class, open to subscribers of the listed packages. */
export const liveClasses = pgTable(
  'live_classes',
  {
    id: id(),
    teacherId: teacherId(),
    packageIds: text('package_ids')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    title: text('title').notNull(),
    startsAt: tstz('starts_at').notNull(),
    link: text('link'),
    ...timestamps(),
  },
  (t) => [index('live_classes_teacher_id_starts_at_idx').on(t.teacherId, t.startsAt)],
);

/** Questions collected for a live class (for example, grouped from teacher_questions). */
export const classQuestions = pgTable(
  'class_questions',
  {
    id: id(),
    liveClassId: text('live_class_id')
      .notNull()
      .references(() => liveClasses.id),
    text: text('text').notNull(),
    order: integer('order').notNull().default(0),
    ...timestamps(),
  },
  (t) => [index('class_questions_live_class_id_idx').on(t.liveClassId)],
);

/** Weekly teacher insights; aggregated and anonymised before they are stored. */
export const insights = pgTable(
  'insights',
  {
    id: id(),
    teacherId: teacherId(),
    /** Monday of the ISO week. */
    week: date('week').notNull(),
    payload: jsonb('payload').notNull(),
    ...timestamps(),
  },
  (t) => [uniqueIndex('insights_teacher_id_week_key').on(t.teacherId, t.week)],
);

/** Trust console tables share this shape: a target, a reason, a status and staff actions. */
const trustColumns = () => ({
  id: id(),
  /** `<kind>:<id>`, for example `teacher:…` or `message:…`. */
  target: text('target').notNull(),
  reason: text('reason').notNull(),
  status: text('status').notNull().default('open'),
  /** [{ actor, action, note, ts }] appended by staff. */
  staffActions: jsonb('staff_actions')
    .notNull()
    .default(sql`'[]'::jsonb`),
  ...timestamps(),
});

export const reports = pgTable(
  'reports',
  {
    ...trustColumns(),
    reporterId: text('reporter_id').references(() => users.id),
  },
  (t) => [
    index('reports_target_idx').on(t.target),
    index('reports_status_idx').on(t.status),
    index('reports_reporter_id_idx').on(t.reporterId),
  ],
);

export const takedowns = pgTable('takedowns', trustColumns(), (t) => [
  index('takedowns_target_idx').on(t.target),
  index('takedowns_status_idx').on(t.status),
]);

export const safetyEvents = pgTable('safety_events', trustColumns(), (t) => [
  index('safety_events_target_idx').on(t.target),
  index('safety_events_status_idx').on(t.status),
]);

/**
 * Config, staff and memory changes. Append-only: the audit repository (1.6) has no update or
 * delete. Every row is about one teacher; memory and student-specific rows also carry the student.
 * `before`/`after` are redacted of personal keys before they are stored.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    actor: text('actor').notNull(),
    actorRole: userRole('actor_role').notNull(),
    action: text('action').notNull(),
    /** `<kind>:<id>`, for example `package:…` or `profile:…` (advisory, not a foreign key). */
    target: text('target').notNull(),
    teacherId: teacherId(),
    /** Set for student x teacher events (memory changes); null for teacher-only ones. */
    studentId: text('student_id').references(() => users.id),
    reason: text('reason'),
    before: jsonb('before'),
    after: jsonb('after'),
    ts: tstz('ts').notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [
    index('audit_log_target_ts_idx').on(t.target, t.ts),
    index('audit_log_actor_ts_idx').on(t.actor, t.ts),
    index('audit_log_teacher_id_ts_idx').on(t.teacherId, t.ts),
    // Led by student_id (every student_id column is; see test/schema.test.ts), so it also serves
    // a student's rows across teachers (export, retention).
    index('audit_log_student_id_teacher_id_ts_idx').on(t.studentId, t.teacherId, t.ts),
  ],
);
