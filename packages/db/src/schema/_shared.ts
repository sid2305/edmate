import { randomUUID } from 'node:crypto';
import { customType, pgEnum, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Primary key. Ids are `text`, not Postgres `uuid`: the contracts' id format is
 * /^[A-Za-z0-9_-]{1,128}$/ (fixtures use ids like `stu_test_01`), so the database never rejects an
 * id the app accepts. New rows get a random UUID, which matches that format.
 */
export const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => randomUUID());

/** `created_at` and `updated_at`, both timestamptz, set by the database on insert. */
export const timestamps = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/** A timestamptz column. */
export const tstz = (name: string) => timestamp(name, { withTimezone: true });

// Enums. Where the contracts define the same set, test/schema.test.ts checks they stay equal.
export const userRole = pgEnum('user_role', ['student', 'teacher', 'staff']);
export const subscriptionStatus = pgEnum('subscription_status', [
  'trial',
  'active',
  'past_due',
  'paused',
  'ended',
]);
export const agentStatus = pgEnum('agent_status', ['draft', 'live', 'suspended']);
export const chunkKind = pgEnum('chunk_kind', ['material', 'transcript', 'teacher_note']);
export const messageRole = pgEnum('message_role', ['student', 'agent', 'teacher']);
export const teacherQuestionStatus = pgEnum('teacher_question_status', [
  'open',
  'answered',
  'dismissed',
]);
export const evidenceSource = pgEnum('evidence_source', ['check', 'practice', 'rubric']);
export const modelTier = pgEnum('model_tier', ['small', 'main']);
export const ledgerDirection = pgEnum('ledger_direction', ['debit', 'credit']);
/** Who a call is billed to: Entitlement.source (a teacher preview to the teacher, evals to Edmate). */
export const entitlementSource = pgEnum('entitlement_source', [
  'subscription',
  'teacher_preview',
  'eval',
]);
/**
 * A usage_ledger row: `recorded` (priced), `unknown` (the provider reported no usage) or
 * `unpriced` (tokens known, model missing from prices.yaml). Task 2.4.
 */
export const usageStatus = pgEnum('usage_status', ['recorded', 'unknown', 'unpriced']);

/** Text form pgvector accepts: `[1,2.5,-3]`. Rejects empty or non-finite vectors. */
export function vectorToDriver(value: number[]): string {
  if (value.length === 0 || !value.every((n) => Number.isFinite(n))) {
    throw new Error('embedding must be a non-empty array of finite numbers');
  }
  return `[${value.join(',')}]`;
}

/** pgvector returns its text form, which is a JSON array. */
export function vectorFromDriver(value: string): number[] {
  return JSON.parse(value) as number[];
}

/**
 * Dimension of every stored embedding: text-embedding-3-small (task 2.7, provisional until 7.6).
 * It must equal `EMBEDDING_CONFIG.dimension` in @edmate/gateway; changing the model means a new
 * migration that changes the column type and rebuilds the HNSW index.
 */
export const EMBEDDING_DIMENSIONS = 1536;

/**
 * pgvector `vector`, optionally with a fixed dimension (`vector(1536)`), which Postgres then
 * enforces on every insert. Without `dimensions` the column takes any length.
 */
export const vector = customType<{
  data: number[];
  driverData: string;
  config: { dimensions?: number };
}>({
  dataType: (config) =>
    config?.dimensions === undefined ? 'vector' : `vector(${String(config.dimensions)})`,
  toDriver: vectorToDriver,
  fromDriver: vectorFromDriver,
});

/** Postgres `tsvector`, read back as its text form. */
export const tsvector = customType<{ data: string }>({
  dataType: () => 'tsvector',
});
