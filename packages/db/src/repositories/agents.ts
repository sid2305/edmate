import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client.js';
import { agents } from '../schema/index.js';
import { RepositoryError } from './errors.js';
import { IdSchema, parseArg, teacherScope, type TeacherScope } from './scope.js';

/** An agent as stored (its config lives in agent_versions). */
export interface AgentRow {
  id: string;
  teacherId: string;
  status: 'draft' | 'live' | 'suspended';
  liveVersion: number | null;
}

/**
 * The one public scope (task 3.2, plan Q5): which teacher owns a live agent is public on teacher
 * pages, so `agents.owner` takes only the agent id. It is parsed like a scope, before any SQL.
 */
const PublicAgentSchema = z.strictObject({ agentId: IdSchema });
export type PublicAgentScope = z.infer<typeof PublicAgentSchema>;

export function agentsRepo(db: Db) {
  return {
    /** One of the scope's teacher's agents (any status); null if missing or another teacher's. */
    async get(scope: TeacherScope, agentId: string): Promise<AgentRow | null> {
      const method = 'agents.get';
      const { teacherId } = teacherScope(scope, method);
      const id = parseArg(IdSchema, agentId, method);
      const [row] = await db
        .select({
          id: agents.id,
          teacherId: agents.teacherId,
          status: agents.status,
          liveVersion: agents.liveVersion,
        })
        .from(agents)
        .where(and(eq(agents.id, id), eq(agents.teacherId, teacherId)))
        .limit(1);
      return row ?? null;
    },

    /**
     * The owner of a live agent, and nothing else; null for a draft, suspended or missing agent.
     * The only repository read without a teacher or student scope.
     */
    async owner(scope: PublicAgentScope): Promise<{ teacherId: string } | null> {
      const method = 'agents.owner';
      const r = PublicAgentSchema.safeParse(scope);
      if (!r.success) throw new RepositoryError('scope', method);
      const [row] = await db
        .select({ teacherId: agents.teacherId })
        .from(agents)
        .where(and(eq(agents.id, r.data.agentId), eq(agents.status, 'live')))
        .limit(1);
      return row ? { teacherId: row.teacherId } : null;
    },
  };
}
