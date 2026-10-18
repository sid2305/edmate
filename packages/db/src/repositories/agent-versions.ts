import type { AgentConfig } from '@edmate/contracts';
import { and, eq } from 'drizzle-orm';
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
  };
}
