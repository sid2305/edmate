// Task 11.1b Phase B: the teacher studio's live-classes API, over 11.1a's `liveClasses`
// repository (`create`, `listForTeacher`). A new, separate composition root (this `liveClasses/`
// folder), not an extension of `studio/{routes,runtime}.ts`, same precedent as 8.9's `questions/`
// folder. The teacher is always the session's principal (`ctx.principal.userId`), never a body
// field; the repository re-checks that every package id is the teacher's own (`not_found`
// otherwise, nothing written).
//
//   GET    /api/studio/live-classes       the teacher's own scheduled classes, soonest first
//   POST   /api/studio/live-classes       schedule one, attached to 1..20 of the teacher's own packages
//   PUT    /api/studio/live-classes/:id   edit title/link/startsAt of one of the teacher's own
//                                         classes, before it starts (task 11.1d Phase B)
//   DELETE /api/studio/live-classes/:id   cancel (soft) one of the teacher's own classes (11.1d)
import type { CreateLiveClassInput, Repositories, TeacherLiveClassRow, TeacherScope } from '@edmate/db';
import { RepositoryError } from '@edmate/db';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiError } from '../../auth/errors';
import type { RoleContext } from '../../auth/guard';
import { MAX_BODY_BYTES, readJson, TOO_LARGE, type ServerLog } from '../routes';

/** Everything the live-classes routes need: 11.1a/11.1d's repository (create/list/update/cancel). */
export interface LiveClassesBackend {
  liveClasses: Pick<
    Repositories['liveClasses'],
    'create' | 'listForTeacher' | 'update' | 'cancel'
  >;
  log: ServerLog;
}

export { MAX_BODY_BYTES };

const MSG = {
  validation: 'Check the class details and try again.',
  notFound: 'One of those packages was not found.',
  bodyTooLarge: 'The request is too large.',
  failed: 'Something went wrong. Try again.',
} as const;

const validation = (message: string = MSG.validation) => apiError('validation', message, 400);
const notFound = () => apiError('not_found', MSG.notFound, 404);
const ok = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

/** An error's name only (never its message, which may quote a title or a link). */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

// Package ids and the `:id` path param: same shape as the other studio routes' own `Id` (the
// repository's id format).
const Id = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/)
  .max(122);
const ParamsSchema = z.object({ id: Id });

/** Shared title/link/startsAt field schemas, used by `create` and `update` (11.1d Phase B). */
const TitleSchema = z.string().trim().min(1).max(200);
const LinkSchema = z.string().trim().min(1).max(2048);
const StartsAtSchema = z.string();

const CreateSchema = z.strictObject({
  title: TitleSchema,
  link: LinkSchema,
  startsAt: StartsAtSchema,
  packageIds: z.array(Id).min(1).max(20),
});

const UpdateSchema = z.strictObject({
  title: TitleSchema,
  link: LinkSchema,
  startsAt: StartsAtSchema,
});

async function parseBody<S extends z.ZodType>(
  req: Request,
  schema: S,
): Promise<z.infer<S> | Response> {
  const raw = await readJson(req);
  if (raw === TOO_LARGE) return apiError('input_too_large', MSG.bodyTooLarge, 413);
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : validation();
}

/** The `:id` path param, or `null` when it doesn't match the id shape (mirrors `docId` in `../routes`). */
async function classId(ctx: RoleContext): Promise<string | null> {
  const parsed = ParamsSchema.safeParse(await ctx.params);
  return parsed.success ? parsed.data.id : null;
}

const HTTPS_MESSAGE = 'The join link must start with https://.';

type Handler = (req: NextRequest, ctx: RoleContext) => Promise<Response>;
type Work = (
  b: LiveClassesBackend,
  scope: TeacherScope,
  req: NextRequest,
  ctx: RoleContext,
) => Promise<Response>;

const list: Work = async (b, scope) => {
  const classes: TeacherLiveClassRow[] = await b.liveClasses.listForTeacher(scope);
  return ok({ classes });
};

const create: Work = async (b, scope, req) => {
  const body = await parseBody(req, CreateSchema);
  if (body instanceof Response) return body;
  if (!/^https:\/\//.test(body.link)) return validation(HTTPS_MESSAGE);
  const input: CreateLiveClassInput = {
    title: body.title,
    link: body.link,
    startsAt: body.startsAt,
    packageIds: body.packageIds,
  };
  const result = await b.liveClasses.create(scope, input);
  return ok(result, 201);
};

const update: Work = async (b, scope, req, ctx) => {
  const id = await classId(ctx);
  if (!id) return validation();
  const body = await parseBody(req, UpdateSchema);
  if (body instanceof Response) return body;
  if (!/^https:\/\//.test(body.link)) return validation(HTTPS_MESSAGE);
  const result = await b.liveClasses.update(scope, id, {
    title: body.title,
    link: body.link,
    startsAt: body.startsAt,
  });
  return ok(result);
};

const cancel: Work = async (b, scope, _req, ctx) => {
  const id = await classId(ctx);
  if (!id) return validation();
  const result = await b.liveClasses.cancel(scope, id);
  return ok(result);
};

/**
 * The two handlers over a lazily built backend (`runtime.ts`); a backend that can't be built is
 * 503, a repository `not_found` is 404, `invalid` is 400 and anything else is a logged 500 --
 * same mapping as `createQuestionsHandlers`. The logged field is always the error's name, never a
 * title or a link.
 */
export function createLiveClassesHandlers(
  backend: () => Promise<LiveClassesBackend>,
  fallbackLog: ServerLog,
): { list: Handler; create: Handler; update: Handler; cancel: Handler } {
  const run =
    (work: Work): Handler =>
    async (req, ctx) => {
      let b: LiveClassesBackend;
      try {
        b = await backend();
      } catch (error) {
        fallbackLog.error('liveClasses.unavailable', { reason: errorName(error) });
        return apiError(
          'provider_error',
          'Live classes are not available right now. Try again soon.',
          503,
        );
      }
      const scope: TeacherScope = { teacherId: ctx.principal.userId };
      try {
        return await work(b, scope, req, ctx);
      } catch (error) {
        if (error instanceof RepositoryError && error.kind === 'not_found') return notFound();
        if (error instanceof RepositoryError && error.kind === 'invalid') return validation();
        b.log.error('liveClasses.failed', { error: errorName(error) });
        return apiError('provider_error', MSG.failed, 500);
      }
    };
  return { list: run(list), create: run(create), update: run(update), cancel: run(cancel) };
}
