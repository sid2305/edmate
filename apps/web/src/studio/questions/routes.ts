// Task 8.9 Phase B: the teacher questions inbox API, over 5.10's `teacherQuestions` repository
// (grouped list, group-wide answer) and 8.9a's `dismiss` (single row). A new, separate
// composition root (8.9's own `questions/` folder), not an extension of `studio/{routes,
// runtime}.ts` (8.3b is editing those) — same precedent as 8.4a's style card API. The teacher is
// always the session's principal (`ctx.principal.userId`), never a body/query field; the module
// picker reuses `outlineRepo().getOutline(scope).modules` read-only (plan Q2).
//
//   GET  /api/studio/questions           the teacher's open groups + their modules (for the
//                                        picker), one response
//   POST /api/studio/questions/answer    answer a whole group by one of its question ids
//   POST /api/studio/questions/dismiss   close one question only (never its group — plan Q1)
import type { Repositories, TeacherQuestionGroup, TeacherScope } from '@edmate/db';
import { RepositoryError } from '@edmate/db';
import { LIMITS } from '@edmate/contracts';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiError } from '../../auth/errors';
import type { RoleContext } from '../../auth/guard';
import { MAX_BODY_BYTES, readJson, TOO_LARGE, type ServerLog } from '../routes';

/** Everything the questions routes need: 5.10's repository (list/answer) plus 8.9a's `dismiss`,
 * and the outline's modules, read-only, for the picker. */
export interface QuestionsBackend {
  teacherQuestions: Pick<
    Repositories['teacherQuestions'],
    'listGroupsForTeacher' | 'answer' | 'dismiss'
  >;
  modules: Pick<Repositories['outline'], 'getOutline'>;
  log: ServerLog;
}

export { MAX_BODY_BYTES };

/** Most groups one `list` call returns (plan Q3: one inbox per teacher, all their agents). */
export const QUESTIONS_LIST_LIMIT = 100;

const MSG = {
  validation: 'Check the request and try again.',
  notFound: 'That question was not found.',
  forbidden: 'That is outside your scope.',
  bodyTooLarge: 'The request is too large.',
  failed: 'Something went wrong. Try again.',
} as const;

const validation = (message: string = MSG.validation) => apiError('validation', message, 400);
const notFound = () => apiError('not_found', MSG.notFound, 404);
const ok = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

/** An error's name only (never its message, which may quote a question's or an answer's text). */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

// Question/module ids: same shape as `studio/routes.ts`'s own `Id` (the repository's id format).
const Id = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/)
  .max(122);

const AnswerSchema = z.strictObject({
  questionId: Id,
  moduleId: Id,
  answer: z
    .string()
    .max(LIMITS.turnTextMaxLength)
    .refine((t) => t.trim().length > 0, 'not empty'),
  noteQuestion: z.string().max(LIMITS.turnTextMaxLength).optional(),
});
const DismissSchema = z.strictObject({ questionId: Id });

async function parseBody<S extends z.ZodType>(
  req: Request,
  schema: S,
): Promise<z.infer<S> | Response> {
  const raw = await readJson(req);
  if (raw === TOO_LARGE) return apiError('input_too_large', MSG.bodyTooLarge, 413);
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : validation();
}

/** What the inbox shows: groups and the modules the picker offers (no student id anywhere —
 * `listGroupsForTeacher` never selects one). */
function view(groups: TeacherQuestionGroup[], modules: { id: string; title: string }[]) {
  return { groups, modules: modules.map((m) => ({ id: m.id, title: m.title })) };
}

type Handler = (req: NextRequest, ctx: RoleContext) => Promise<Response>;
type Work = (b: QuestionsBackend, scope: TeacherScope, req: NextRequest) => Promise<Response>;

const list: Work = async (b, scope) => {
  const [groups, outline] = await Promise.all([
    b.teacherQuestions.listGroupsForTeacher(scope, { limit: QUESTIONS_LIST_LIMIT }),
    b.modules.getOutline(scope),
  ]);
  return ok(view(groups, outline?.modules ?? []));
};

const answer: Work = async (b, scope, req) => {
  const body = await parseBody(req, AnswerSchema);
  if (body instanceof Response) return body;
  const result = await b.teacherQuestions.answer(scope, {
    questionId: body.questionId,
    moduleId: body.moduleId,
    answer: body.answer,
    ...(body.noteQuestion === undefined ? {} : { noteQuestion: body.noteQuestion }),
  });
  return ok(result);
};

const dismiss: Work = async (b, scope, req) => {
  const body = await parseBody(req, DismissSchema);
  if (body instanceof Response) return body;
  await b.teacherQuestions.dismiss(scope, body.questionId);
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
};

/**
 * A thrown `RepositoryError`'s kind mapped to a fixed response, every kind named explicitly (no
 * default case falls through silently): `scope` is 403, `not_found` is 404, `invalid` and
 * `integrity` are 400, `failed` is a logged 500. Anything that is not a `RepositoryError` is also
 * a logged 500. The logged field is always the error's name, never a question's or an answer's
 * text. Same shape as `studio/profile.ts`'s `fromError`.
 */
function fromError(log: ServerLog, error: unknown): Response {
  if (error instanceof RepositoryError) {
    switch (error.kind) {
      case 'scope':
        return apiError('forbidden', MSG.forbidden, 403);
      case 'not_found':
        return notFound();
      case 'invalid':
      case 'integrity':
        return validation();
      case 'failed':
        log.error('questions.failed', { error: errorName(error) });
        return apiError('provider_error', MSG.failed, 500);
    }
  }
  log.error('questions.failed', { error: errorName(error) });
  return apiError('provider_error', MSG.failed, 500);
}

/**
 * The three handlers over a lazily built backend (`runtime.ts`); a backend that can't be built
 * is 503, every `RepositoryError` kind is mapped by `fromError` and anything else is a logged
 * 500 — same mapping shape as `createStudioHandlers`/`createOutlineHandlers`'s sibling routes.
 */
export function createQuestionsHandlers(
  backend: () => Promise<QuestionsBackend>,
  fallbackLog: ServerLog,
): { list: Handler; answer: Handler; dismiss: Handler } {
  const run =
    (work: Work): Handler =>
    async (req, ctx) => {
      let b: QuestionsBackend;
      try {
        b = await backend();
      } catch (error) {
        fallbackLog.error('questions.unavailable', { reason: errorName(error) });
        return apiError(
          'provider_error',
          'Questions are not available right now. Try again soon.',
          503,
        );
      }
      const scope: TeacherScope = { teacherId: ctx.principal.userId };
      try {
        return await work(b, scope, req);
      } catch (error) {
        return fromError(b.log, error);
      }
    };
  return { list: run(list), answer: run(answer), dismiss: run(dismiss) };
}
