// Task 8.3 Phase B: the studio outline API, over Phase A's `courses`/`outline`/`chunks`
// repositories (8.3a) and `@edmate/ingest`'s `draftOutline` (5.11). The teacher is always the
// session's own principal (`ctx.principal.userId`), never a body/query field — same convention as
// `routes.ts`'s document handlers.
//
//   GET  /api/studio/outline            the teacher's outline (bootstraps a course+module on first
//                                        visit — lead answer Q1, 22 Oct 2026)
//   PUT  /api/studio/outline            replace (reorder/rename/merge/split) the whole tree
//   POST /api/studio/outline/generate   draft an outline from each module's ready chunks and save it
import type { ModelGateway } from '@edmate/contracts';
import type { Outline, OutlineInput, Repositories, TeacherScope } from '@edmate/db';
import { OutlineInputSchema, RepositoryError } from '@edmate/db';
import { draftOutline, type OutlineModuleInput } from '@edmate/ingest';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiError } from '../auth/errors';
import type { RoleContext } from '../auth/guard';
import { MAX_BODY_BYTES, readJson, TOO_LARGE, type ServerLog } from './routes';

/** Everything the outline routes need: Phase A's repositories, scoped to what this file calls,
 * and a `generateObject`-only model gateway (the `small` tier, no streaming, no tool calls). */
export interface OutlineBackend {
  courses: Pick<Repositories['courses'], 'ensureDefault'>;
  outline: Pick<Repositories['outline'], 'getOutline' | 'replaceOutline'>;
  chunks: Pick<Repositories['chunks'], 'listForModule'>;
  gateway: Pick<ModelGateway, 'generateObject'>;
  log: ServerLog;
}

export { MAX_BODY_BYTES };

const MSG = {
  validation: 'Check the request and try again.',
  notFound: 'That outline was not found.',
  noMaterial: 'Upload files before generating an outline.',
  failed: 'Something went wrong. Try again.',
} as const;

const validation = (message: string = MSG.validation) => apiError('validation', message, 400);
const notFound = () => apiError('not_found', MSG.notFound, 404);
const ok = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

async function parseBody<S extends z.ZodType>(
  req: Request,
  schema: S,
): Promise<z.infer<S> | Response> {
  const raw = await readJson(req);
  if (raw === TOO_LARGE) return apiError('input_too_large', 'The request is too large.', 413);
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : validation();
}

/** `OutlineModuleInput[]` for every module that has at least one ready chunk (8.3 Phase B design,
 * "skips a module with zero ready chunks"); a module with none is simply left out, so `generate`
 * never touches it. */
async function moduleInputs(
  b: OutlineBackend,
  scope: TeacherScope,
  outline: Outline,
): Promise<OutlineModuleInput[]> {
  const candidates = await Promise.all(
    outline.modules.map(async (m) => {
      const chunks = await b.chunks.listForModule(scope, m.id);
      if (chunks.length === 0) return null;
      return {
        moduleId: m.id,
        title: m.title,
        chunks: chunks.map((c) => ({ id: c.id, text: c.text, locator: c.locator })),
      };
    }),
  );
  return candidates.filter((x): x is OutlineModuleInput => x !== null);
}

/** The drafted topics, mapped back onto `replaceOutline`'s input shape: only the modules that
 * were drafted (had chunks) are named, so every other module is left exactly as it was. */
function toOutlineInput(
  outline: Outline,
  draft: {
    modules: readonly { moduleId: string; topics: readonly { topic: string; chunkIds: readonly string[] }[] }[];
  },
): OutlineInput {
  const drafted = new Map(draft.modules.map((m) => [m.moduleId, m]));
  const modules = outline.modules.flatMap((m) => {
    const d = drafted.get(m.id);
    if (!d) return [];
    return [
      {
        id: m.id,
        title: m.title,
        order: m.order,
        topics: d.topics.map((t, i) => ({ title: t.topic, order: i, chunkIds: [...t.chunkIds] })),
      },
    ];
  });
  return { modules };
}

type Handler = (req: NextRequest, ctx: RoleContext) => Promise<Response>;
type Work = (b: OutlineBackend, scope: TeacherScope, req: NextRequest) => Promise<Response>;

const get: Work = async (b, scope) => {
  await b.courses.ensureDefault(scope);
  const outline = await b.outline.getOutline(scope);
  if (!outline) {
    b.log.error('outline.missing_after_ensure', {});
    return apiError('provider_error', MSG.failed, 500);
  }
  return ok(outline);
};

const put: Work = async (b, scope, req) => {
  const body = await parseBody(req, OutlineInputSchema);
  if (body instanceof Response) return body;
  const result = await b.outline.replaceOutline(scope, body);
  return ok(result);
};

const generate: Work = async (b, scope) => {
  await b.courses.ensureDefault(scope);
  const outline = await b.outline.getOutline(scope);
  if (!outline) {
    b.log.error('outline.missing_after_ensure', {});
    return apiError('provider_error', MSG.failed, 500);
  }
  const inputs = await moduleInputs(b, scope, outline);
  if (inputs.length === 0) return validation(MSG.noMaterial);
  const draft = await draftOutline(b.gateway, inputs);
  const input = toOutlineInput(outline, draft);
  await b.outline.replaceOutline(scope, input);
  const fresh = await b.outline.getOutline(scope);
  if (!fresh) {
    b.log.error('outline.missing_after_generate', {});
    return apiError('provider_error', MSG.failed, 500);
  }
  return ok(fresh);
};

/**
 * The three handlers over a lazily built backend (`runtime.ts`); a backend that can't be built
 * (no provider key) is 503, a repository `not_found` is 404, `invalid` is 400 and anything else
 * is a logged 500 — same mapping as `createStudioHandlers`.
 */
export function createOutlineHandlers(
  backend: () => Promise<OutlineBackend>,
  fallbackLog: ServerLog,
): { get: Handler; put: Handler; generate: Handler } {
  const run =
    (work: Work): Handler =>
    async (req, ctx) => {
      let b: OutlineBackend;
      try {
        b = await backend();
      } catch (error) {
        fallbackLog.error('outline.unavailable', { reason: errorName(error) });
        return apiError(
          'provider_error',
          'Outlines are not available right now. Try again soon.',
          503,
        );
      }
      const scope: TeacherScope = { teacherId: ctx.principal.userId };
      try {
        return await work(b, scope, req);
      } catch (error) {
        if (error instanceof RepositoryError && error.kind === 'not_found') return notFound();
        if (error instanceof RepositoryError && error.kind === 'invalid') return validation();
        b.log.error('outline.failed', { error: errorName(error) });
        return apiError('provider_error', MSG.failed, 500);
      }
    };
  return { get: run(get), put: run(put), generate: run(generate) };
}
