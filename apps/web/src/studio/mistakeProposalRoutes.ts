// Task 6.3a Phase B: the studio mistake-proposal API. A teacher's proposed mistake tags
// (classifyMistakeTags, 6.3c, persisted by mistakeProposalsRepo.record, 6.3a Phase A) are listed
// for that teacher only, and decided (approved into a new style-card version, or rejected) by
// them. Decided vs. the plan's recommendation (Q2): one endpoint for both decisions, but POST
// rather than PATCH — ROUTE_POLICY's `/api/studio/**` row allows GET/POST/PUT/DELETE, not PATCH,
// and this task is out of bounds to change `src/auth/policy.ts` (see the handoff decision).
//
//   GET  /api/studio/mistake-proposals  -> { proposals: MistakeProposalRow[] } (the teacher's own)
//   POST /api/studio/mistake-proposals  -> { tag, action } -> { approved, card } | { rejected }
import {
  RepositoryError,
  STYLE_CARD_LIMITS,
  type Repositories,
  type TeacherScope,
} from '@edmate/db';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiError } from '../auth/errors';
import type { RoleContext } from '../auth/guard';
import type { ServerLog } from '../turn/routes';
import { readJson, TOO_LARGE } from './routes';

/** Everything the mistake-proposal routes need; built once per process (src/studio/index.ts). */
export interface MistakeProposalBackend {
  repos(): Pick<Repositories, 'mistakeProposals'>;
}

const MSG = {
  validation: 'Check the request and try again.',
  bodyTooLarge: 'The request is too large.',
  forbidden: 'These proposed tags are not yours to review.',
  notFound: 'That style card was not found.',
  limit: 'You have reached the limit of stored proposed tags.',
  failed: 'Something went wrong. Try again.',
} as const;

// Mirrors the repository's own tag shape (task 6.3f fix 5: the cap itself, not a copy of its
// value); an overlong or empty tag is refused before any call.
const Tag = z.string().trim().min(1).max(STYLE_CARD_LIMITS.tagMaxChars);

const DecideSchema = z.strictObject({ tag: Tag, action: z.enum(['approve', 'reject']) });

const ok = (body: unknown, status: number) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const validation = () => apiError('validation', MSG.validation, 400);

function fromRepositoryError(error: unknown): Response {
  if (error instanceof RepositoryError) {
    switch (error.kind) {
      case 'scope':
        return apiError('forbidden', MSG.forbidden, 403);
      case 'not_found':
        return apiError('not_found', MSG.notFound, 404);
      case 'invalid':
      case 'integrity':
        return validation();
      case 'limit':
        return apiError('limit_reached', MSG.limit, 409);
      case 'failed':
        return apiError('provider_error', MSG.failed, 500);
    }
  }
  return apiError('provider_error', MSG.failed, 500);
}

type Handler = (req: NextRequest, ctx: RoleContext) => Promise<Response>;

/** The body as JSON, or the fixed 413 / 400 response. */
async function body(req: NextRequest): Promise<unknown> {
  const raw = await readJson(req);
  if (raw === TOO_LARGE) return apiError('input_too_large', MSG.bodyTooLarge, 413);
  if (raw === undefined) return validation();
  return raw;
}

const scopeOf = (ctx: RoleContext): TeacherScope => ({ teacherId: ctx.principal.userId });

// `log` is accepted for parity with every other studio handler factory (and a future error log
// without a signature change); nothing here is logged yet — every failure already maps to a
// typed, scrubbed error response (RepositoryError never carries row content or student text).
export function createMistakeProposalHandlers(
  backend: MistakeProposalBackend,
  _log: ServerLog,
): { list: Handler; decide: Handler } {
  return {
    list: async (_req, ctx) => {
      try {
        const proposals = await backend.repos().mistakeProposals.listPending(scopeOf(ctx));
        return ok({ proposals }, 200);
      } catch (error) {
        return fromRepositoryError(error);
      }
    },

    decide: async (req, ctx) => {
      const input = await body(req);
      if (input instanceof Response) return input;
      const parsed = DecideSchema.safeParse(input);
      if (!parsed.success) return validation();
      const scope = scopeOf(ctx);
      try {
        if (parsed.data.action === 'approve') {
          const result = await backend.repos().mistakeProposals.approve(scope, parsed.data.tag);
          return ok(result, 200);
        }
        const result = await backend.repos().mistakeProposals.reject(scope, parsed.data.tag);
        return ok(result, 200);
      } catch (error) {
        return fromRepositoryError(error);
      }
    },
  };
}
