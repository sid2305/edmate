// Data model rows: sessions / messages, turn_traces, usage_ledger, evidence_events /
// learner_profiles, teacher_questions.
import type { LearnerProfile, SourceRef, TurnTrace } from '@edmate/contracts';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import {
  entitlementSource,
  evidenceSource,
  id,
  messageRole,
  modelTier,
  teacherQuestionStatus,
  timestamps,
  tstz,
  usageStatus,
} from './_shared.js';
import { agents, packages } from './agents.js';
import { topics } from './content.js';
import { studentId, teacherId } from './users.js';

/** A student's study session with one teacher's agent. The retention job applies. */
export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    studentId: studentId(),
    teacherId: teacherId(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id),
    agentVersion: integer('agent_version').notNull(),
    /** Hint ladder state for the open problem. */
    helpState: jsonb('help_state')
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** ≤ 60 words, written at session end. */
    summary: text('summary'),
    endedAt: tstz('ended_at'),
    ...timestamps(),
  },
  (t) => [
    index('sessions_teacher_id_student_id_idx').on(t.teacherId, t.studentId),
    index('sessions_student_id_idx').on(t.studentId),
    index('sessions_agent_id_idx').on(t.agentId),
  ],
);

/** Message content. The retention job applies. */
export const messages = pgTable(
  'messages',
  {
    id: id(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id),
    role: messageRole('role').notNull(),
    text: text('text').notNull(),
    /** SourceRef[] shown under an agent answer. */
    sources: jsonb('sources').$type<SourceRef[]>(),
    ...timestamps(),
  },
  (t) => [index('messages_session_id_created_at_idx').on(t.sessionId, t.createdAt)],
);

/** Per-turn trace. No keys, no names. */
export const turnTraces = pgTable(
  'turn_traces',
  {
    id: id(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id),
    steps: jsonb('steps').$type<TurnTrace['steps']>().notNull(),
    /** Summary of `usage`: the distinct models, comma-separated ('' when the turn made no call). */
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    costMicroUsd: bigint('cost_micro_usd', { mode: 'number' }).notNull(),
    // The rest of the TurnTrace contract (task 3.8, migration 0007). One trace per turn.
    turnId: text('turn_id').notNull(),
    agentVersion: integer('agent_version').notNull(),
    packageVersion: integer('package_version').notNull(),
    intent: text('intent').$type<TurnTrace['intent']>().notNull(),
    move: text('move').$type<TurnTrace['move']>().notNull(),
    guards: jsonb('guards').$type<TurnTrace['guards']>().notNull(),
    usage: jsonb('usage').$type<TurnTrace['usage']>().notNull(),
    ...timestamps(),
  },
  (t) => [
    index('turn_traces_session_id_idx').on(t.sessionId),
    uniqueIndex('turn_traces_turn_id_key').on(t.turnId),
  ],
);

/**
 * Model spend per teacher, package and student: caps and dashboards. One row per provider attempt
 * (task 2.4). `status` says whether the figures are known: `unknown` (the provider reported no
 * usage: tokens and cost are NULL) or `unpriced` (tokens known, no price: cost is NULL). NULL,
 * never 0, so a raw query can't read an unknown call as free. A `recorded` row has every figure.
 */
export const usageLedger = pgTable(
  'usage_ledger',
  {
    id: id(),
    teacherId: teacherId(),
    packageId: text('package_id')
      .notNull()
      .references(() => packages.id),
    studentId: studentId(),
    /** The model the attempt was sent to, or the one the provider reported. */
    model: text('model'),
    tier: modelTier('tier').notNull(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    costMicroUsd: bigint('cost_micro_usd', { mode: 'number' }),
    /**
     * The turn the call served. Not a foreign key: meter and commit are independent async steps,
     * so a usage row never waits for (or depends on) a trace.
     */
    turnId: text('turn_id').notNull(),
    source: entitlementSource('source').notNull(),
    status: usageStatus('status').notNull().default('recorded'),
    /** null when recorded; `no_usage_reported` or `unpriced_model:<model>` otherwise. */
    reason: text('reason'),
    ...timestamps(),
  },
  (t) => [
    index('usage_ledger_teacher_id_package_id_student_id_idx').on(
      t.teacherId,
      t.packageId,
      t.studentId,
    ),
    index('usage_ledger_student_id_idx').on(t.studentId),
    index('usage_ledger_package_id_idx').on(t.packageId),
    index('usage_ledger_teacher_id_turn_id_idx').on(t.teacherId, t.turnId),
    check(
      'usage_ledger_counts_non_negative',
      sql`${t.inputTokens} >= 0 and ${t.outputTokens} >= 0 and ${t.costMicroUsd} >= 0`,
    ),
    // sumForStudent, and 2.5's rolling windows per student x teacher.
    index('usage_ledger_teacher_id_student_id_created_at_idx').on(
      t.teacherId,
      t.studentId,
      t.createdAt,
    ),
    // The monthly cost alarm (2.5): one teacher's rows since a date, across every student. Not
    // partial: unknown and unpriced rows are counted next to the cost, never skipped.
    index('usage_ledger_teacher_id_created_at_idx').on(t.teacherId, t.createdAt),
    // The scheduled cost alarm's teacher list (3.8): every teacher's non-eval rows since a date.
    index('usage_ledger_created_at_source_idx').on(t.createdAt, t.source),
    check(
      'usage_ledger_recorded_has_figures',
      sql`${t.status} <> 'recorded' or (${t.model} is not null and ${t.inputTokens} is not null
        and ${t.outputTokens} is not null and ${t.costMicroUsd} is not null)`,
    ),
  ],
);

/** Scored evidence that updates mastery. */
export const evidenceEvents = pgTable(
  'evidence_events',
  {
    id: id(),
    studentId: studentId(),
    teacherId: teacherId(),
    topicId: text('topic_id')
      .notNull()
      .references(() => topics.id),
    correct: boolean('correct').notNull(),
    source: evidenceSource('source').notNull(),
    weight: doublePrecision('weight').notNull().default(1),
    ts: tstz('ts').notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [
    index('evidence_events_teacher_id_student_id_idx').on(t.teacherId, t.studentId),
    index('evidence_events_student_id_idx').on(t.studentId),
    index('evidence_events_topic_id_idx').on(t.topicId),
  ],
);

/** One per (student, teacher). Mirrors the LearnerProfile contract. */
export const learnerProfiles = pgTable(
  'learner_profiles',
  {
    id: id(),
    studentId: studentId(),
    teacherId: teacherId(),
    lang: text('lang').notNull(),
    /** Topic id -> { p, n, updatedAt }. */
    mastery: jsonb('mastery')
      .$type<LearnerProfile['mastery']>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    mistakes: jsonb('mistakes')
      .$type<LearnerProfile['mistakes']>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    lastSummary: text('last_summary'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('learner_profiles_teacher_id_student_id_key').on(t.teacherId, t.studentId),
    index('learner_profiles_student_id_idx').on(t.studentId),
  ],
);

/** Ask the teacher. `student_id` is stored but hidden from the teacher by the read layer (1.2+). */
export const teacherQuestions = pgTable(
  'teacher_questions',
  {
    id: id(),
    teacherId: teacherId(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id),
    studentId: studentId(),
    text: text('text').notNull(),
    moduleHint: text('module_hint'),
    /** Similar open questions are grouped for the teacher. */
    groupId: text('group_id'),
    similarIds: text('similar_ids')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: teacherQuestionStatus('status').notNull().default('open'),
    answer: text('answer'),
    answeredAt: tstz('answered_at'),
    ...timestamps(),
  },
  (t) => [
    index('teacher_questions_teacher_id_status_idx').on(t.teacherId, t.status),
    index('teacher_questions_student_id_idx').on(t.studentId),
    index('teacher_questions_agent_id_idx').on(t.agentId),
    index('teacher_questions_group_id_idx').on(t.groupId),
  ],
);
