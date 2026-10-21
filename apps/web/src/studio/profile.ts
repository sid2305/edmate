// Task 8.1a: the onboarding profile route. Thin -- the input validation is `teacherProfiles`'s own
// `CreateInput`/`UpdateInput` (8.1), not duplicated here. The scope is always the session's own
// principal (`ctx.principal.userId`), never a body field: a body that tries to set `teacherId` or
// `userId` is simply not read, so it can't change whose row is touched.
import type {
  Repositories,
  TeacherProfileCreate,
  TeacherProfileUpdate,
  TeacherScope,
} from '@edmate/db';
import { RepositoryError } from '@edmate/db';
import type { NextRequest } from 'next/server';
import { serverDatabase } from '../auth';
import { apiError } from '../auth/errors';
import type { RoleContext } from '../auth/guard';
import { MAX_BODY_BYTES, readJson, TOO_LARGE } from './routes';

/** Everything the profile route needs: the teacher-profiles repo, built once per process. */
export interface ProfileBackend {
  repos(): Pick<Repositories, 'teacherProfiles'>;
}

const MSG = {
  validation: 'Check the request and try again.',
  bodyTooLarge: 'The request is too large.',
  forbidden: 'This profile is not yours to edit.',
  notFound: 'That profile was not found.',
  failed: 'Something went wrong. Try again.',
} as const;

const ok = (body: unknown, status: number) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const validation = () => apiError('validation', MSG.validation, 400);
const tooLarge = () => apiError('input_too_large', MSG.bodyTooLarge, 413);

/** A thrown `RepositoryError`'s kind mapped to this route's fixed response; anything else is 500. */
function fromError(error: unknown): Response {
  if (error instanceof RepositoryError) {
    switch (error.kind) {
      case 'scope':
        return apiError('forbidden', MSG.forbidden, 403);
      case 'not_found':
        return apiError('not_found', MSG.notFound, 404);
      case 'invalid':
      case 'integrity':
        return validation();
      case 'failed':
        return apiError('provider_error', MSG.failed, 500);
    }
  }
  return apiError('provider_error', MSG.failed, 500);
}

type Handler = (req: NextRequest, ctx: RoleContext) => Promise<Response>;

/**
 * The create/update handlers over an injected backend (no database in tests; rule 4). Each reads
 * the body through the size-capped reader (413 before parsing), builds the scope from the
 * session's own principal, and forwards the body as-is to the repo -- the repo's own
 * `CreateInput`/`UpdateInput` (strict objects, no `verificationStatus` key) does the validation.
 */
export function createProfileHandlers(backend: ProfileBackend): {
  create: Handler;
  update: Handler;
} {
  async function body(req: NextRequest): Promise<unknown | Response> {
    const raw = await readJson(req);
    if (raw === TOO_LARGE) return tooLarge();
    if (raw === undefined) return validation();
    return raw;
  }

  function scopeOf(ctx: RoleContext): TeacherScope {
    return { teacherId: ctx.principal.userId };
  }

  return {
    create: async (req, ctx) => {
      const input = await body(req);
      if (input instanceof Response) return input;
      try {
        // The body is forwarded as-is (never validated here): the repo's own CreateInput (a
        // strict zod object) re-checks it at runtime, and throws `invalid` for anything that
        // doesn't fit -- including a stray `verificationStatus` key. This cast is type-level only.
        const profile = await backend
          .repos()
          .teacherProfiles.create(scopeOf(ctx), input as TeacherProfileCreate);
        return ok({ profile }, 201);
      } catch (error) {
        return fromError(error);
      }
    },
    update: async (req, ctx) => {
      const input = await body(req);
      if (input instanceof Response) return input;
      try {
        // Same as create: the repo's own UpdateInput validates the forwarded body at runtime.
        const profile = await backend
          .repos()
          .teacherProfiles.update(scopeOf(ctx), input as TeacherProfileUpdate);
        return ok({ profile }, 200);
      } catch (error) {
        return fromError(error);
      }
    },
  };
}

export { MAX_BODY_BYTES };

/** Wired to the shared auth runtime's database (same memoised pool the chat routes use). */
export const profileHandlers = createProfileHandlers({
  repos: () => serverDatabase().repos,
});
