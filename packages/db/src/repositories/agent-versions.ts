import type { AgentConfig } from '@edmate/contracts';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client.js';
import { agentVersions } from '../schema/index.js';
import { toAgentConfig } from './map.js';
import { IdSchema, parseArg, teacherScope, type TeacherScope } from './scope.js';

const Ref = z.strictObject({ agentId: IdSchema, version: z.int().min(0) });

export function agentVersionsRepo(db: Db) {
  return {
    /** One immutable agent version of the scope's teacher; null if missing or another teacher's. */
    async get(
      scope: TeacherScope,
      ref: { agentId: string; version: number },
    ): Promise<AgentConfig | null> {
      const method = 'agentVersions.get';
      const { teacherId } = teacherScope(scope, method);
      const { agentId, version } = parseArg(Ref, ref, method);
      const [row] = await db
        .select({
          teacherId: agentVersions.teacherId,
          agentId: agentVersions.agentId,
          version: agentVersions.version,
          config: agentVersions.config,
        })
        .from(agentVersions)
        .where(
          and(
            eq(agentVersions.teacherId, teacherId),
            eq(agentVersions.agentId, agentId),
            eq(agentVersions.version, version),
          ),
        )
        .limit(1);
      return row ? toAgentConfig(row, method) : null;
    },

    /**
     * Task 8.5: the newest version of one of the scope's teacher's agents, whatever the agent's
     * status (a draft is what the teacher's test chat previews); null if it has no version, is
     * missing or is another teacher's. Mirrors `packageVersions.latest`.
     */
    async latest(
      scope: TeacherScope,
      agentId: string,
    ): Promise<{ version: number; config: AgentConfig } | null> {
      const method = 'agentVersions.latest';
      const { teacherId } = teacherScope(scope, method);
      const id = parseArg(IdSchema, agentId, method);
      const [row] = await db
        .select({
          teacherId: agentVersions.teacherId,
          agentId: agentVersions.agentId,
          version: agentVersions.version,
          config: agentVersions.config,
        })
        .from(agentVersions)
        .where(and(eq(agentVersions.agentId, id), eq(agentVersions.teacherId, teacherId)))
        .orderBy(desc(agentVersions.version))
        .limit(1);
      return row ? { version: row.version, config: toAgentConfig(row, method) } : null;
    },
  };
}
