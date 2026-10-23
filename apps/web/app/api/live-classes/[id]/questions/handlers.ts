// Task 11.2b (build plan § 11.2 Phase B): POST /api/live-classes/[id]/questions -- a student
// feeds the teacher's pre-class question queue. `class_questions`' own repository
// (`classQuestionsRepo.submit`, 11.2a) scopes by `{ studentId, teacherId }`, but this route only
// has the live class's id from the URL -- no repository method maps a `liveClassId` to its
// teacher, and `packages/db` is untouched this phase (plan "Files out of bounds"). This route
// resolves it the same way `/home` already does for its own live-classes list
// (`homeLiveClasses`, 11.1c; task 9.4d): the distinct teachers of the signed-in student's own
// live subscriptions (`subscriptions.listLiveForStudent(principal.userId)`, never a client id),
// tried in turn, keeping the first one `submit` accepts. `EDMATE_CHAT_AGENTS` plays no part, so
// every class /home lists can be asked. A mismatched teacher, an unentitled
// student and a class that has already started all read alike (`not_found`): nothing is written
// for any of them, and the route never reveals which reason applied.
import { LIMITS } from '@edmate/contracts';
import { RepositoryError, studentScope, type Repositories, type StudentScope } from '@edmate/db';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiError } from '../../../../../src/auth/errors';
import type { RoleContext } from '../../../../../src/auth/guard';

export interface AskQuestionBackend {
  classQuestions: Pick<Repositories['classQuestions'], 'submit'>;
  /** The student's own not-ended subscriptions (the same query `/home` uses). */
  subscriptions: Pick<Repositories['subscriptions'], 'listLiveForStudent'>;
}

const BodySchema = z.strictObject({
  text: z
    .string()
    .max(LIMITS.turnTextMaxLength)
    .refine((t) => t.trim().length > 0, 'not empty'),
});

const LiveClassIdSchema = z.string().min(1).max(200);

/** The largest body this route reads (bytes); the JSON body here is tiny. */
export const MAX_BODY_BYTES = 64 * 1024;
export const TOO_LARGE = Symbol('too large');

/** The body's bytes, or TOO_LARGE as soon as more than the cap has been read. */
async function readCapped(body: ReadableStream<Uint8Array>): Promise<Uint8Array | typeof TOO_LARGE> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      void reader.cancel().catch(() => undefined);
      return TOO_LARGE;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  return bytes;
}

/** The body as JSON, `undefined` when it is not JSON or can't be read, or TOO_LARGE. */
async function readJson(req: Request): Promise<unknown> {
  if (Number(req.headers.get('content-length') ?? '0') > MAX_BODY_BYTES) return TOO_LARGE;
  if (req.body === null) return undefined;
  try {
    const bytes = await readCapped(req.body);
    if (bytes === TOO_LARGE) return TOO_LARGE;
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return undefined;
  }
}

const MSG = {
  validation: 'Check the request and try again.',
  notFound: 'That class was not found, or you cannot ask it a question right now.',
  bodyTooLarge: 'The request is too large.',
  failed: 'Something went wrong. Try again.',
} as const;

const validation = () => apiError('validation', MSG.validation, 400);
const notFound = () => apiError('not_found', MSG.notFound, 404);
const tooLarge = () => apiError('input_too_large', MSG.bodyTooLarge, 413);
const failed = () => apiError('provider_error', MSG.failed, 500);
const ok = (body: unknown) =>
  Response.json(body, { status: 200, headers: { 'cache-control': 'no-store' } });

/** The distinct teachers of the student's own live subscriptions, in order, deduped. */
async function liveTeacherIds(
  subscriptions: AskQuestionBackend['subscriptions'],
  studentId: string,
): Promise<string[]> {
  const live = await subscriptions.listLiveForStudent(studentId);
  const seen = new Set<string>();
  for (const row of live) if (row.status !== 'ended') seen.add(row.teacherId);
  return [...seen];
}

type Handler = (req: NextRequest, ctx: RoleContext) => Promise<Response>;

/** The POST handler over an injected backend (no database in tests; rule 4). */
export function createAskQuestionHandlers(backend: AskQuestionBackend): { post: Handler } {
  const post: Handler = async (req, ctx) => {
    const rawParams = (await ctx.params) as { id?: unknown } | undefined;
    const idParsed = LiveClassIdSchema.safeParse(rawParams?.id);
    if (!idParsed.success) return notFound();
    const liveClassId = idParsed.data;

    const raw = await readJson(req);
    if (raw === TOO_LARGE) return tooLarge();
    const body = BodySchema.safeParse(raw);
    if (!body.success) return validation();
    const text = body.data.text.trim();

    try {
      const teacherIds = await liveTeacherIds(backend.subscriptions, ctx.principal.userId);
      for (const teacherId of teacherIds) {
        const scope: StudentScope = studentScope(
          { studentId: ctx.principal.userId, teacherId },
          'askQuestion',
        );
        try {
          const result = await backend.classQuestions.submit(scope, { liveClassId, text });
          return ok(result);
        } catch (error) {
          if (error instanceof RepositoryError && error.kind === 'not_found') continue;
          throw error;
        }
      }
      return notFound();
    } catch {
      return failed();
    }
  };
  return { post };
}
