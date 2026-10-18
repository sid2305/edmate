import { describe, expect, it } from 'vitest';
import {
  ChunkKindSchema,
  EntitlementSchema,
  EvidenceEventSchema,
  MessageSchema,
  TeacherQuestionSchema,
  UsageSchema,
} from '@edmate/contracts';
import { getTableConfig } from 'drizzle-orm/pg-core';
import * as schema from '../src/schema/index.js';
import { vectorFromDriver, vectorToDriver } from '../src/schema/_shared.js';
import {
  DATA_MODEL_TABLES,
  DESTRUCTIVE_SQL,
  latestSnapshot,
  migrationSql,
  schemaTables,
  type SnapshotTable,
} from './helpers.js';

const snapshot = latestSnapshot();
const snapTables = Object.values(snapshot.tables);
const byName = new Map(snapTables.map((t) => [t.name, t]));

function table(name: string): SnapshotTable {
  const t = byName.get(name);
  if (!t) throw new Error(`no table ${name} in the migration snapshot`);
  return t;
}

/** Index names whose first column is `column`. */
function indexesLedBy(t: SnapshotTable, column: string): string[] {
  return Object.values(t.indexes)
    .filter((i) => i.columns[0]?.expression === column && !i.columns[0].isExpression)
    .map((i) => i.name);
}

describe('schema: one table per Data model row', () => {
  it('exports exactly the Data model tables', () => {
    const names = schemaTables().map((t) => t.name);
    expect([...names].sort()).toEqual([...DATA_MODEL_TABLES].sort());
  });

  it('gives every table a text id primary key and created_at/updated_at', () => {
    for (const t of schemaTables()) {
      const cols = new Map(t.columns.map((c) => [c.name, c]));
      expect(cols.get('id')?.primary, `${t.name}.id is the primary key`).toBe(true);
      expect(cols.get('id')?.getSQLType(), `${t.name}.id is text`).toBe('text');
      for (const ts of ['created_at', 'updated_at']) {
        const c = cols.get(ts);
        expect(c?.getSQLType(), `${t.name}.${ts}`).toBe('timestamp with time zone');
        expect(c?.notNull, `${t.name}.${ts} not null`).toBe(true);
        expect(c?.hasDefault, `${t.name}.${ts} has a default`).toBe(true);
      }
    }
  });

  it('every foreign key points at a table and column in the schema', () => {
    const tables = new Map(schemaTables().map((t) => [t.name, t]));
    let count = 0;
    for (const t of tables.values()) {
      for (const fk of t.foreignKeys) {
        const ref = fk.reference();
        const target = tables.get(getTableConfig(ref.foreignTable).name);
        expect(target, `${t.name} -> ${getTableConfig(ref.foreignTable).name}`).toBeDefined();
        for (const col of ref.foreignColumns) {
          expect(target?.columns.map((c) => c.name)).toContain(col.name);
        }
        count += 1;
      }
    }
    expect(count).toBeGreaterThan(40);
  });

  it('serialises embeddings for pgvector and rejects empty or non-finite ones', () => {
    expect(vectorToDriver([0.5, -1, 2])).toBe('[0.5,-1,2]');
    expect(vectorFromDriver('[0.5,-1,2]')).toEqual([0.5, -1, 2]);
    expect(() => vectorToDriver([])).toThrow(/non-empty/);
    expect(() => vectorToDriver([1, Number.NaN])).toThrow(/finite/);
    expect(() => vectorToDriver([Number.POSITIVE_INFINITY])).toThrow(/finite/);
  });

  it('generates a uuid id for new rows (matches the contracts id format)', () => {
    const id = schema.users.id.defaultFn?.();
    expect(id).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
    expect(schema.users.id.defaultFn?.()).not.toBe(id);
  });
});

describe('migration snapshot matches the schema', () => {
  it('has the same tables and columns as src/schema', () => {
    for (const t of schemaTables()) {
      const snap = table(t.name);
      expect(Object.keys(snap.columns).sort(), t.name).toEqual(t.columns.map((c) => c.name).sort());
    }
    expect(snapTables.map((t) => t.name).sort()).toEqual([...DATA_MODEL_TABLES].sort());
  });

  it('has the same index names as src/schema', () => {
    for (const t of schemaTables()) {
      expect(Object.keys(table(t.name).indexes).sort(), t.name).toEqual(
        t.indexes.map((i) => i.config.name).sort(),
      );
    }
  });
});

describe('acceptance: teacher-owned tables are indexed on teacher_id', () => {
  const teacherOwned = snapTables.filter((t) => 'teacher_id' in t.columns);

  it('covers the tables the Data model marks as teacher-owned', () => {
    const names = teacherOwned.map((t) => t.name);
    for (const n of [
      'courses',
      'modules',
      'topics',
      'documents',
      'chunks',
      'style_cards',
      'agents',
      'agent_versions',
      'packages',
      'package_versions',
      'subscriptions',
      'sessions',
      'usage_ledger',
      'evidence_events',
      'learner_profiles',
      'corrections',
      'teacher_questions',
      'live_classes',
      'insights',
    ]) {
      expect(names, n).toContain(n);
    }
  });

  it('every table with teacher_id has an index whose leading column is teacher_id', () => {
    const report = teacherOwned.map((t) => {
      const idx = indexesLedBy(t, 'teacher_id');
      expect(idx.length, `${t.name} has no index led by teacher_id`).toBeGreaterThan(0);
      return `${t.name}: ${idx.join(', ')}`;
    });
    // Printed for the handoff's acceptance evidence.
    console.log(`teacher_id indexes (${report.length} tables):\n  ${report.join('\n  ')}`);
  });

  it('teacher_id is not null and references users.id', () => {
    for (const t of teacherOwned) {
      const nullable = ['ledger_entries'];
      if (!nullable.includes(t.name)) expect(t.columns.teacher_id?.notNull, t.name).toBe(true);
      const fk = Object.values(t.foreignKeys).find((f) => f.columnsFrom.includes('teacher_id'));
      expect(fk?.tableTo, `${t.name}.teacher_id -> users`).toBe('users');
      expect(fk?.columnsTo).toEqual(['id']);
    }
  });

  it('every table with student_id has an index whose leading column is student_id', () => {
    for (const t of snapTables.filter((s) => 'student_id' in s.columns)) {
      expect(indexesLedBy(t, 'student_id').length, t.name).toBeGreaterThan(0);
    }
  });
});

describe('constraints the Data model states', () => {
  it('one live subscription per student x teacher (partial unique, ended rows excluded)', () => {
    const idx = Object.values(table('subscriptions').indexes).find(
      (i) => i.isUnique && i.columns.map((c) => c.expression).join() === 'student_id,teacher_id',
    );
    expect(idx?.where).toMatch(/status.*<>.*'ended'/);
  });

  it('one learner profile per (student, teacher)', () => {
    const idx = Object.values(table('learner_profiles').indexes).find((i) => i.isUnique);
    expect(idx?.columns.map((c) => c.expression).sort()).toEqual(['student_id', 'teacher_id']);
  });

  it('webhook_events.provider_event_id is unique (idempotency)', () => {
    const idx = Object.values(table('webhook_events').indexes).find((i) => i.isUnique);
    expect(idx?.columns.map((c) => c.expression)).toEqual(['provider_event_id']);
  });

  it('agent and package versions are unique per parent', () => {
    for (const [t, parent] of [
      ['agent_versions', 'agent_id'],
      ['package_versions', 'package_id'],
      ['style_cards', 'teacher_id'],
    ] as const) {
      const idx = Object.values(table(t).indexes).find((i) => i.isUnique);
      expect(
        idx?.columns.map((c) => c.expression),
        t,
      ).toEqual([parent, 'version']);
    }
  });

  it('chunks carry a nullable vector embedding and a generated tsvector with a GIN index', () => {
    const chunks = table('chunks');
    expect(chunks.columns.embedding?.type).toBe('vector');
    expect(chunks.columns.embedding?.notNull).toBe(false);
    expect(chunks.columns.search?.type).toBe('tsvector');
    const gin = Object.values(chunks.indexes).find((i) => i.method === 'gin');
    expect(gin?.columns.map((c) => c.expression)).toEqual(['search']);
  });

  it('money is stored as bigint minor units with a currency', () => {
    for (const t of ['payments', 'ledger_entries', 'payouts', 'invoices']) {
      expect(table(t).columns.amount_minor?.type, t).toBe('bigint');
      expect(table(t).columns.currency?.notNull, t).toBe(true);
    }
  });
});

describe('enums match the contracts', () => {
  const values = (name: string) => snapshot.enums[`public.${name}`]?.values;

  it('subscription_status = Entitlement.status', () => {
    expect(values('subscription_status')).toEqual(EntitlementSchema.shape.status.options);
  });
  it('chunk_kind = ChunkKind', () => {
    expect(values('chunk_kind')).toEqual(ChunkKindSchema.options);
  });
  it('message_role = Message.role', () => {
    expect(values('message_role')).toEqual(MessageSchema.shape.role.options);
  });
  it('teacher_question_status = TeacherQuestion.status', () => {
    expect(values('teacher_question_status')).toEqual(TeacherQuestionSchema.shape.status.options);
  });
  it('evidence_source = EvidenceEvent.source', () => {
    expect(values('evidence_source')).toEqual(EvidenceEventSchema.shape.source.options);
  });
  it('model_tier = Usage.tier', () => {
    expect(values('model_tier')).toEqual(UsageSchema.shape.tier.options);
  });
  it('user_role and agent_status follow the Data model', () => {
    expect(values('user_role')).toEqual(['student', 'teacher', 'staff']);
    expect(values('agent_status')).toEqual(['draft', 'live', 'suspended']);
  });
});

describe('migrations are create-only', () => {
  it('has at least one migration and none drop, truncate, delete or update data', () => {
    const files = migrationSql();
    expect(files.length).toBeGreaterThan(0);
    for (const { file, sql } of files) {
      expect(DESTRUCTIVE_SQL.test(sql), `${file} is destructive`).toBe(false);
    }
  });

  it('enables pgvector before any table uses it', () => {
    const [first] = migrationSql();
    expect(first?.sql).toMatch(/CREATE EXTENSION IF NOT EXISTS vector/);
  });
});
