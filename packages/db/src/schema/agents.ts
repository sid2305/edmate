// Data model rows: agents / agent_versions, packages / package_versions.
import { index, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { agentStatus, id, timestamps } from './_shared.js';
import { teacherId } from './users.js';

/** A teacher's agent. Its config lives in immutable agent_versions. */
export const agents = pgTable(
  'agents',
  {
    id: id(),
    teacherId: teacherId(),
    status: agentStatus('status').notNull().default('draft'),
    /** The version students get; null until the first publish. */
    liveVersion: integer('live_version'),
    ...timestamps(),
  },
  (t) => [index('agents_teacher_id_idx').on(t.teacherId)],
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
    config: jsonb('config').notNull(),
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
    config: jsonb('config').notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('package_versions_package_id_version_key').on(t.packageId, t.version),
    index('package_versions_teacher_id_idx').on(t.teacherId),
  ],
);
