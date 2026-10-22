// Task 9.6 Phase B: `GET /api/me/export/:agentId` (complete JSON) and
// `GET /api/me/export/:agentId/notes` (the notes PDF). Both key by the live agent's scope
// (`studentTurnScope`, never a client-given studentId/teacherId) and ignore the request body
// entirely, following `src/memory/routes.ts`'s precedent.
import { RepositoryError } from '@edmate/db';
import type { NextRequest } from 'next/server';
import { serverDatabase } from '../auth';
import { apiError } from '../auth/errors';
import type { RoleContext } from '../auth/guard';
import { StartSessionSchema } from '../turn/clientInput';
import { studentTurnScope, type AgentOwners } from '../turn/scope';
import { buildExport, type ExportBackend } from './buildExport';
import { notesDocument } from './notes';
import { renderPdf } from './pdf';

const ParamsSchema = StartSessionSchema.shape.agentId;

const MSG = {
  agent: 'That agent is not available.',
  failed: 'Something went wrong. Try again.',
} as const;

const notFound = () => apiError('not_found', MSG.agent, 404);

/** The error's constructor name only -- never its message, which can carry a method name or
 * other internal detail (same convention as `studio/packages.ts`'s `errorName`). */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/** A thrown `RepositoryError`'s kind mapped to this route's fixed response; anything else is 500,
 * logging only the error's name (9.6g). */
function fromError(error: unknown): Response {
  if (error instanceof RepositoryError && (error.kind === 'not_found' || error.kind === 'scope')) {
    return notFound();
  }
  console.error(`[export] ${errorName(error)}`);
  return apiError('provider_error', MSG.failed, 500);
}

async function paramsAgentId(ctx: RoleContext): Promise<string | null> {
  const raw = (await ctx.params) as { agentId?: unknown } | undefined;
  const parsed = ParamsSchema.safeParse(raw?.agentId);
  return parsed.success ? parsed.data : null;
}

type Handler = (req: NextRequest, ctx: RoleContext) => Promise<Response>;

/** The export routes over an injected backend (`buildExport`'s own backend plus agent ownership). */
export function createExportHandlers(
  backend: ExportBackend & { agents: AgentOwners },
): { json: Handler; notes: Handler } {
  async function resolveScope(ctx: RoleContext) {
    const agentId = await paramsAgentId(ctx);
    if (agentId === null) return null;
    const scope = await studentTurnScope(backend.agents, ctx.principal, agentId);
    if (scope === null) return null;
    return { ...scope, agentId };
  }

  const json: Handler = async (_req, ctx) => {
    const scope = await resolveScope(ctx);
    if (scope === null) return notFound();
    try {
      const exportJson = await buildExport(backend, scope, new Date().toISOString());
      return Response.json(exportJson, {
        status: 200,
        headers: {
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'content-disposition': `attachment; filename="edmate-export-${scope.agentId}.json"`,
        },
      });
    } catch (error) {
      return fromError(error);
    }
  };

  const notes: Handler = async (_req, ctx) => {
    const scope = await resolveScope(ctx);
    if (scope === null) return notFound();
    try {
      const exportJson = await buildExport(backend, scope, new Date().toISOString());
      const blocks = notesDocument(exportJson, exportJson.progress);
      const bytes = renderPdf(blocks);
      // `renderPdf`'s `Uint8Array` is typed over `ArrayBufferLike` (it could in principle be
      // backed by a `SharedArrayBuffer`); copying into a plain `ArrayBuffer`-backed array is what
      // the DOM lib's `BodyInit` actually needs, not a behaviour change.
      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: {
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'content-type': 'application/pdf',
          'content-disposition': `attachment; filename="edmate-notes-${scope.agentId}.pdf"`,
        },
      });
    } catch (error) {
      return fromError(error);
    }
  };

  return { json, notes };
}

/** Wired to the shared auth runtime's database (same memoised pool the other routes use). */
export const exportHandlers = createExportHandlers({
  agents: { owner: (scope) => serverDatabase().repos.agents.owner(scope) },
  // `opts.after`/`next` is `buildExport`'s own `ExportCursor` (9.6g), the same shape as the
  // repositories' own module-local cursor type -- no cast, the route forwards what the pager
  // produced untouched.
  sessions: {
    listForStudent: (scope, opts) => serverDatabase().repos.sessions.listForStudent(scope, opts),
  },
  messages: {
    listForStudent: (scope, opts) => serverDatabase().repos.messages.listForStudent(scope, opts),
  },
  learnerProfiles: { get: (scope) => serverDatabase().repos.learnerProfiles.get(scope) },
  evidenceEvents: { list: (scope, opts) => serverDatabase().repos.evidenceEvents.list(scope, opts) },
  teacherQuestions: { listForStudent: (scope) => serverDatabase().repos.teacherQuestions.listForStudent(scope) },
  subscriptions: { findLive: (scope) => serverDatabase().repos.subscriptions.findLive(scope) },
  packageVersions: {
    getById: (scope, id) => serverDatabase().repos.packageVersions.getById(scope, id),
  },
  outline: { getOutline: (scope) => serverDatabase().repos.outline.getOutline(scope) },
});
