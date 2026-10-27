// Task 6.5 Phase B: a student's view, export and reset of what their tutor's agent remembers.
// `GET /api/me/memory/:agentId` exports the pair's profile and evidence as a JSON download;
// `DELETE /api/me/memory/:agentId` clears it (`learnerProfiles.reset`, task 6.5 Phase A). Both key
// by the live agent's scope (`studentTurnScope`, task 9.4) -- never by a teacherId or studentId the
// client names -- and ignore the request body entirely (plan Q4).
import type { EvidenceEvent, LearnerProfile } from '@edmate/contracts';
import { EVIDENCE_LIST_MAX, RepositoryError } from '@edmate/db';
import type { NextRequest } from 'next/server';
import { serverDatabase } from '../auth';
import { apiError } from '../auth/errors';
import type { RoleContext } from '../auth/guard';
import { StartSessionSchema } from '../turn/clientInput';
import { studentTurnScope, type AgentOwners } from '../turn/scope';

const ParamsSchema = StartSessionSchema.shape.agentId;

/** Everything the memory routes need, built once per process or per test (rule 4: no real db in tests). */
export interface MemoryBackend {
  agents: AgentOwners;
  learnerProfiles: {
    get(scope: { studentId: string; teacherId: string }): Promise<LearnerProfile | null>;
    reset(scope: { studentId: string; teacherId: string }): Promise<{ reset: boolean }>;
  };
  evidenceEvents: {
    list(
      scope: { studentId: string; teacherId: string },
      options: { limit: number },
    ): Promise<{ events: EvidenceEvent[]; truncated: boolean }>;
  };
}

const MSG = {
  agent: 'That agent is not available.',
  failed: 'Something went wrong. Try again.',
} as const;

const notFound = () => apiError('not_found', MSG.agent, 404);

/** A thrown `RepositoryError`'s kind mapped to this route's fixed response; anything else is 500. */
function fromError(error: unknown): Response {
  if (error instanceof RepositoryError && (error.kind === 'not_found' || error.kind === 'scope')) {
    return notFound();
  }
  return apiError('provider_error', MSG.failed, 500);
}

async function paramsAgentId(ctx: RoleContext): Promise<string | null> {
  const raw = (await ctx.params) as { agentId?: unknown } | undefined;
  const parsed = ParamsSchema.safeParse(raw?.agentId);
  return parsed.success ? parsed.data : null;
}

type Handler = (req: NextRequest, ctx: RoleContext) => Promise<Response>;

/** The memory export and reset handlers over an injected backend. */
export function createMemoryHandlers(backend: MemoryBackend): { export: Handler; reset: Handler } {
  async function resolveScope(ctx: RoleContext) {
    const agentId = await paramsAgentId(ctx);
    if (agentId === null) return null;
    return studentTurnScope(backend.agents, ctx.principal, agentId);
  }

  const exportMemory: Handler = async (_req, ctx) => {
    const scope = await resolveScope(ctx);
    if (scope === null) return notFound();
    try {
      const [profile, { events, truncated }] = await Promise.all([
        backend.learnerProfiles.get(scope),
        backend.evidenceEvents.list(scope, { limit: EVIDENCE_LIST_MAX }),
      ]);
      return Response.json(
        { profile, evidence: events, truncated },
        {
          status: 200,
          headers: {
            'cache-control': 'no-store',
            'content-disposition': 'attachment; filename="edmate-memory.json"',
          },
        },
      );
    } catch (error) {
      return fromError(error);
    }
  };

  // `learnerProfiles.reset` (packages/db) ends the pair's open sessions before it checks whether
  // a profile row exists, so `{ reset: false }` means there was no mastery/evidence to clear, not
  // that nothing happened -- any open session still ended and nothing else was written.
  const reset: Handler = async (_req, ctx) => {
    const scope = await resolveScope(ctx);
    if (scope === null) return notFound();
    try {
      const { reset: didReset } = await backend.learnerProfiles.reset(scope);
      return Response.json(
        { reset: didReset },
        { status: 200, headers: { 'cache-control': 'no-store' } },
      );
    } catch (error) {
      return fromError(error);
    }
  };

  return { export: exportMemory, reset };
}

/** Wired to the shared auth runtime's database (same memoised pool the other routes use). */
export const memoryHandlers = createMemoryHandlers({
  agents: { owner: (scope) => serverDatabase().repos.agents.owner(scope) },
  learnerProfiles: {
    get: (scope) => serverDatabase().repos.learnerProfiles.get(scope),
    reset: (scope) => serverDatabase().repos.learnerProfiles.reset(scope),
  },
  evidenceEvents: {
    list: (scope, options) => serverDatabase().repos.evidenceEvents.list(scope, options),
  },
});
