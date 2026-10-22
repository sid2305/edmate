import { randomUUID } from 'node:crypto';
import { AgentConfigSchema, type AgentConfig } from '@edmate/contracts';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client.js';
import { agents, agentVersions, courses, styleCards } from '../schema/index.js';
import { RepositoryError, translateWrite } from './errors.js';
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

/**
 * What the studio passes to `agents.ensureDraft` (task 8.6b): the pins of the agent's first
 * version. Strict, so a client-set `teacherId`, `id` or `version` is `invalid`; the repository
 * builds those from the scope and the rows. The model policy and pack version are checked by
 * `AgentConfigSchema` once the full config is built.
 */
const DraftAgentInput = z.strictObject({
  courseId: IdSchema,
  styleCardId: IdSchema,
  promptPackVersion: z.string(),
  modelPolicy: z.unknown(),
});
export type DraftAgentInput = Pick<
  AgentConfig,
  'courseId' | 'styleCardId' | 'promptPackVersion' | 'modelPolicy'
>;

/**
 * Namespace for the per-teacher agent bootstrap lock (two-key advisory form, so it can never meet
 * migrate.ts's single-key lock or another repository's namespace). Arbitrary, used nowhere else.
 */
const AGENT_LOCK_NAMESPACE = 8601;

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

    /**
     * The scope's teacher's agent (MVP: one per teacher), created on first use (task 8.6b). The
     * course and style card must be the scope's (`not_found` otherwise, nothing written), checked
     * on every call, even when the agent already exists. If the teacher has an agent, it is
     * returned with its newest version number and nothing changes (publishing, 8.7, cuts new
     * versions). Otherwise a `draft` agent and its version 1 are inserted, with a config built
     * from the scope (`teacherId`), the input and `languages: ['en']`, parsed by
     * `AgentConfigSchema` before any SQL (`invalid`). Concurrent calls for one teacher are
     * serialised by a transaction-scoped advisory lock, so they make one agent.
     */
    async ensureDraft(
      scope: TeacherScope,
      input: DraftAgentInput,
    ): Promise<{ agentId: string; version: number }> {
      const method = 'agents.ensureDraft';
      const { teacherId } = teacherScope(scope, method);
      const d = parseArg(DraftAgentInput, input, method);
      const agentId = randomUUID();
      const config = parseArg(
        AgentConfigSchema,
        {
          id: agentId,
          version: 1,
          teacherId,
          courseId: d.courseId,
          styleCardId: d.styleCardId,
          promptPackVersion: d.promptPackVersion,
          languages: ['en'],
          modelPolicy: d.modelPolicy,
        },
        method,
      );
      return translateWrite(method, () =>
        db.transaction(async (tx) => {
          await tx.execute(
            sql`select pg_advisory_xact_lock(${AGENT_LOCK_NAMESPACE}::int4, hashtext(${teacherId}))`,
          );
          // KEY SHARE: the pinned course and card can't be deleted before the insert commits.
          const [course] = await tx
            .select({ id: courses.id })
            .from(courses)
            .where(and(eq(courses.id, d.courseId), eq(courses.teacherId, teacherId)))
            .for('key share');
          const [card] = await tx
            .select({ id: styleCards.id })
            .from(styleCards)
            .where(and(eq(styleCards.id, d.styleCardId), eq(styleCards.teacherId, teacherId)))
            .for('key share');
          if (!course || !card) throw new RepositoryError('not_found', method);

          const [existing] = await tx
            .select({ id: agents.id })
            .from(agents)
            .where(eq(agents.teacherId, teacherId))
            .orderBy(asc(agents.createdAt), asc(agents.id))
            .limit(1);
          if (existing) {
            const [{ max }] = (await tx
              .select({ max: sql<number | null>`max(${agentVersions.version})::int` })
              .from(agentVersions)
              .where(
                and(eq(agentVersions.agentId, existing.id), eq(agentVersions.teacherId, teacherId)),
              )) as [{ max: number | null }];
            // An agent without a version is never written by this repository.
            if (max === null) throw new RepositoryError('integrity', method);
            return { agentId: existing.id, version: max };
          }

          await tx.insert(agents).values({ id: agentId, teacherId, status: 'draft' });
          await tx.insert(agentVersions).values({ teacherId, agentId, version: 1, config });
          return { agentId, version: 1 };
        }),
      );
    },
  };
}
