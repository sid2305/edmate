import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import * as schema from '../src/schema/index.js';
import { MIGRATIONS_DIR } from '../src/migrate.js';

/** Every table in the build plan's Data model section, one per name listed there, plus sign-in. */
export const DATA_MODEL_TABLES = [
  'users',
  'teacher_profiles',
  'consents',
  'courses',
  'modules',
  'topics',
  // Outline source links (task 8.3).
  'topic_chunks',
  'documents',
  'chunks',
  'teacher_material_revisions',
  'style_cards',
  // Task 6.3a: proposed mistake tags, pending teacher approval.
  'mistake_tag_proposals',
  'agents',
  'agent_versions',
  'packages',
  'package_versions',
  'subscriptions',
  'payments',
  'ledger_entries',
  'payouts',
  'invoices',
  'webhook_events',
  'sessions',
  'messages',
  'turn_traces',
  'usage_ledger',
  'evidence_events',
  'learner_profiles',
  'corrections',
  'teacher_questions',
  'teacher_eval_cases',
  'notifications',
  'eval_runs',
  'eval_results',
  'live_classes',
  'class_questions',
  'insights',
  'reports',
  'takedowns',
  'safety_events',
  // Safety alert inbox (task 12.5a).
  'safety_alerts',
  'audit_log',
  // Sign-in tables (task 1.3), behind the identity store rather than a repository.
  'auth_accounts',
  'auth_sessions',
  'platform_audit_log',
  // Magic-link verification tokens (task 1.4), also behind the identity store.
  'auth_verification_tokens',
] as const;

/** Drizzle's view of every table the schema exports. */
export function schemaTables() {
  return (Object.values(schema) as unknown[])
    .filter((v): v is PgTable => is(v, PgTable))
    .map((t) => getTableConfig(t));
}

export interface SnapshotIndex {
  name: string;
  columns: { expression: string; isExpression: boolean; opclass?: string }[];
  isUnique: boolean;
  where?: string;
  method: string;
}
export interface SnapshotTable {
  name: string;
  schema: string;
  columns: Record<string, { name: string; type: string; notNull: boolean; primaryKey: boolean }>;
  indexes: Record<string, SnapshotIndex>;
  foreignKeys: Record<
    string,
    { tableFrom: string; tableTo: string; columnsFrom: string[]; columnsTo: string[] }
  >;
}
export interface Snapshot {
  tables: Record<string, SnapshotTable>;
  enums: Record<string, { name: string; values: string[] }>;
}

interface Journal {
  entries: { idx: number; tag: string }[];
}

/** The drizzle-kit snapshot of the newest migration: what the migrations build. */
export function latestSnapshot(): Snapshot {
  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8'),
  ) as Journal;
  const last = journal.entries.at(-1);
  if (!last) throw new Error('migrations/meta/_journal.json has no entries');
  const file = `${String(last.idx).padStart(4, '0')}_snapshot.json`;
  return JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'meta', file), 'utf8')) as Snapshot;
}

/** Every migration's SQL, in file-name order. */
export function migrationSql(): { file: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => ({ file, sql: readFileSync(join(MIGRATIONS_DIR, file), 'utf8') }));
}

/** Copied from .claude/skills/merge-gate/merge_gate.py (DESTRUCTIVE_SQL). */
export const DESTRUCTIVE_SQL =
  /\b(DROP\s+(TABLE|COLUMN|SCHEMA|INDEX|VIEW|MATERIALIZED\s+VIEW|TYPE|FUNCTION|DATABASE|SEQUENCE|TRIGGER|CONSTRAINT)|ALTER\s+TABLE\b[^;]*?\bDROP\b|TRUNCATE|DELETE\s+FROM|UPDATE\s+\S+\s+SET)\b/i;
