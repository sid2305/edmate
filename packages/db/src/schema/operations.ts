// Data model rows: eval_runs / eval_results, live_classes / class_questions, insights,
// reports / takedowns / safety_events, safety_alerts, audit_log.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { auditActorRole, id, timestamps, tstz } from './_shared.js';
import { agents, agentVersions } from './agents.js';
import { sessions } from './learning.js';
import { studentId, teacherId, users } from './users.js';

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
    // Task 8.7: publish-gate runs (`suite = 'gate'`). Additive and nullable: rows from before
    // migration 0021 (offline suite runs) keep these null.
    /** The agent being published; the run cut `agent_version_id` for it. */
    agentId: text('agent_id').references(() => agents.id),
    /** queued | running | passed | failed | error (publish gate runs only). */
    status: text('status'),
    /** The gate's change kinds, derived from `basis` against the last published run. */
    changes: text('changes').array(),
    /** What the run publishes: pins, style card, material revision, package versions. */
    basis: jsonb('basis'),
    /** Gate groups, stats, cost in micro-USD and an error code. */
    summary: jsonb('summary'),
    /** The teaching scorecard of a finished run (7.8's `Scorecard`). */
    scorecard: jsonb('scorecard'),
    /** When `goLive` made the run's agent version and package versions live. */
    publishedAt: tstz('published_at'),
    ...timestamps(),
  },
  (t) => [
    index('eval_runs_teacher_id_idx').on(t.teacherId),
    index('eval_runs_agent_version_id_suite_idx').on(t.agentVersionId, t.suite),
    index('eval_runs_agent_id_created_at_idx').on(t.agentId, t.createdAt),
    // One open publish run per agent.
    uniqueIndex('eval_runs_agent_id_open_key')
      .on(t.agentId)
      .where(sql`${t.status} in ('queued', 'running')`),
    check(
      'eval_runs_status_check',
      sql`${t.status} is null or ${t.status} in ('queued', 'running', 'passed', 'failed', 'error')`,
    ),
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
    // Task 11.1d: scheduled | cancelled. Additive; existing rows get 'scheduled' from the default.
    status: text('status').notNull().default('scheduled'),
    ...timestamps(),
  },
  (t) => [
    index('live_classes_teacher_id_starts_at_idx').on(t.teacherId, t.startsAt),
    check('live_classes_status_check', sql`${t.status} in ('scheduled', 'cancelled')`),
  ],
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
 * The staff safety alert inbox (task 12.5a): one row per contracts `SafetyAlert`, written by the
 * alert worker and read and acknowledged by staff only. `id` is the alert's own id and
 * `created_at` the alert's own time (`received_at` is when the worker stored it). The excerpt is
 * the scrubbed one from distressDetect; no name, email or phone is stored. Retention is 13.4's.
 */
export const safetyAlerts = pgTable(
  'safety_alerts',
  {
    id: id(),
    /** SafetyAlert.level: info | alert | critical. */
    level: text('level').notNull(),
    /** SafetyAlert.kind: distress | abuse | misuse | other. */
    kind: text('kind').notNull(),
    studentId: studentId(),
    teacherId: teacherId(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id),
    excerptRedacted: text('excerpt_redacted').notNull(),
    receivedAt: tstz('received_at').notNull().defaultNow(),
    /** First time a check found it unacknowledged; never cleared. */
    escalatedAt: tstz('escalated_at'),
    /** How many checks found it unacknowledged (on-call paged that many times). */
    escalationRound: integer('escalation_round').notNull().default(0),
    lastPagedAt: tstz('last_paged_at'),
    acknowledgedAt: tstz('acknowledged_at'),
    acknowledgedBy: text('acknowledged_by').references(() => users.id),
    ackNote: text('ack_note'),
    ...timestamps(),
  },
  (t) => [
    // The inbox's open list.
    index('safety_alerts_open_created_at_id_idx')
      .on(t.createdAt, t.id)
      .where(sql`${t.acknowledgedAt} is null`),
    index('safety_alerts_teacher_id_created_at_idx').on(t.teacherId, t.createdAt),
    index('safety_alerts_student_id_teacher_id_idx').on(t.studentId, t.teacherId),
    index('safety_alerts_session_id_idx').on(t.sessionId),
    check('safety_alerts_level_check', sql`${t.level} in ('info', 'alert', 'critical')`),
    check('safety_alerts_kind_check', sql`${t.kind} in ('distress', 'abuse', 'misuse', 'other')`),
    check('safety_alerts_ack_note_length', sql`char_length(${t.ackNote}) <= 500`),
    check(
      'safety_alerts_ack_pair',
      sql`(${t.acknowledgedAt} is null) = (${t.acknowledgedBy} is null)`,
    ),
    check('safety_alerts_escalation_round_non_negative', sql`${t.escalationRound} >= 0`),
  ],
);

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
    actorRole: auditActorRole('actor_role').notNull(),
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
