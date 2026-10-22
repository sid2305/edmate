// Data model rows: agents / agent_versions, packages / package_versions.
import type { AgentConfig, PackageConfig } from '@edmate/contracts';
import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { agentStatus, id, timestamps, tstz } from './_shared.js';
import { teacherId, users } from './users.js';

/** A teacher's agent. Its config lives in immutable agent_versions. */
export const agents = pgTable(
  'agents',
  {
    id: id(),
    teacherId: teacherId(),
    status: agentStatus('status').notNull().default('draft'),
    /** The version students get; null until the first publish. */
    liveVersion: integer('live_version'),
    /**
     * The regulated subject staff set (task 12.4): `investing`, `health` or `law`, or null. Only
     * staff write it (repositories/regulated-subjects.ts); a flagged agent publishes only once
     * staff approve it.
     */
    regulatedSubject: text('regulated_subject'),
    /** When and by which staff user the flagged subject was approved; both null or both set. */
    regulatedApprovedAt: tstz('regulated_approved_at'),
    regulatedApprovedBy: text('regulated_approved_by').references(() => users.id),
    ...timestamps(),
  },
  (t) => [
    index('agents_teacher_id_idx').on(t.teacherId),
    check(
      'agents_regulated_subject_check',
      sql`${t.regulatedSubject} in ('investing', 'health', 'law')`,
    ),
    check(
      'agents_regulated_approval_check',
      sql`(${t.regulatedApprovedAt} is null) = (${t.regulatedApprovedBy} is null) and (${t.regulatedApprovedAt} is null or ${t.regulatedSubject} is not null)`,
    ),
  ],
);

/** Immutable. `config` is an AgentConfig, validated by the contracts at the port boundary. */
export const agentVersions = pgTable(
  'agent_versions',
  {
    id: id(),
    teacherId: teacherId(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id),
    version: integer('version').notNull(),
    config: jsonb('config').$type<AgentConfig>().notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('agent_versions_agent_id_version_key').on(t.agentId, t.version),
    index('agent_versions_teacher_id_idx').on(t.teacherId),
  ],
);

/** What a teacher sells. Its config lives in immutable package_versions. */
export const packages = pgTable(
  'packages',
  {
    id: id(),
    teacherId: teacherId(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id),
    name: text('name').notNull(),
    /** The version new subscribers get; null until the first publish. */
    liveVersion: integer('live_version'),
    ...timestamps(),
  },
  (t) => [
    index('packages_teacher_id_idx').on(t.teacherId),
    index('packages_agent_id_idx').on(t.agentId),
  ],
);

/** Immutable. `config` is a PackageConfig, validated by the contracts at the port boundary. */
export const packageVersions = pgTable(
  'package_versions',
  {
    id: id(),
    teacherId: teacherId(),
    packageId: text('package_id')
      .notNull()
      .references(() => packages.id),
    version: integer('version').notNull(),
    config: jsonb('config').$type<PackageConfig>().notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('package_versions_package_id_version_key').on(t.packageId, t.version),
    index('package_versions_teacher_id_idx').on(t.teacherId),
  ],
);
