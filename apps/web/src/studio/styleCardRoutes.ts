// Task 8.4a: the studio style card API. A teacher drafts a card from the style interview (the
// model's draft is returned for preview and editing, never stored), edits it, and saves it as a new
// immutable version. The scope is always the session's own principal, never a body field.
//
//   GET  /api/studio/style-card        -> { card: StyleCard | null } (the newest saved version)
//   POST /api/studio/style-card/draft  -> { draft: { text, mistakeTags } } (nothing written)
//   PUT  /api/studio/style-card        -> 201 { card: StyleCard } (a new version)
import { type ModelGateway, StyleCardSchema } from '@edmate/contracts';
import { RepositoryError, type Repositories, type TeacherScope } from '@edmate/db';
import { draftStyleCard, IngestError } from '@edmate/ingest';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiError } from '../auth/errors';
import type { RoleContext } from '../auth/guard';
import { errorName, type ServerLog } from '../turn/routes';
import { readJson, TOO_LARGE } from './routes';
import { INTERVIEW_LIMITS, QUESTION_TOPICS, STYLE_CARD_QUESTIONS } from './styleCardQuestions';

/** Everything the style card routes need; built once per process (styleCardRuntime.ts). */
export interface StyleCardBackend {
  repos(): Pick<Repositories, 'styleCards'>;
  /** The drafter's model gateway; rejects when none can be built (no provider key). */
  gateway(): Promise<Pick<ModelGateway, 'generateObject'>>;
}

const MSG = {
  validation: 'Check the request and try again.',
  bodyTooLarge: 'The request is too large.',
  forbidden: 'This style card is not yours to edit.',
  notFound: 'That style card was not found.',
  draftFailed: 'The draft could not be made. Try again.',
  unavailable: 'Drafting is not available right now.',
  failed: 'Something went wrong. Try again.',
} as const;

// Tag caps mirror the repository's (STYLE_CARD_LIMITS): a candidate the save would refuse is
// refused here first, before any model call.
const Candidate = z.string().trim().min(1).max(60);

const answerShape = Object.fromEntries(
  STYLE_CARD_QUESTIONS.map((k) => [k, z.string().max(INTERVIEW_LIMITS.answerMaxChars).optional()]),
) as Record<(typeof STYLE_CARD_QUESTIONS)[number], z.ZodOptional<z.ZodString>>;

/** The interview: answers keyed by question slug, up to 3 samples, the teacher's own tags. */
const InterviewSchema = z.strictObject({
  answers: z.strictObject(answerShape),
  sampleExplanations: z
    .array(z.string().max(INTERVIEW_LIMITS.sampleMaxChars))
    .max(INTERVIEW_LIMITS.samplesMax),
  mistakeCandidates: z.array(Candidate).max(20),
});

/** What a save carries: only the card text and its tags (the contract's own word limit). */
const SaveSchema = StyleCardSchema.pick({ text: true, mistakeTags: true });

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

export function createStyleCardHandlers(
  backend: StyleCardBackend,
  log: ServerLog,
): { get: Handler; draft: Handler; save: Handler } {
  return {
    get: async (_req, ctx) => {
      try {
        return ok({ card: await backend.repos().styleCards.latest(scopeOf(ctx)) }, 200);
      } catch (error) {
        return fromRepositoryError(error);
      }
    },

    // Drafting reads nothing of the teacher's and writes nothing, so it needs no scope.
    draft: async (req) => {
      const input = await body(req);
      if (input instanceof Response) return input;
      const parsed = InterviewSchema.safeParse(input);
      if (!parsed.success) return validation();
      const answers = STYLE_CARD_QUESTIONS.flatMap((key) => {
        const answer = parsed.data.answers[key]?.trim() ?? '';
        return answer === '' ? [] : [{ question: QUESTION_TOPICS[key], answer }];
      });
      const sampleExplanations = parsed.data.sampleExplanations
        .map((s) => s.trim())
        .filter((s) => s !== '');
      if (answers.length === 0 && sampleExplanations.length === 0) return validation();
      let gateway: Pick<ModelGateway, 'generateObject'>;
      try {
        gateway = await backend.gateway();
      } catch (error) {
        log.error('studio.style_card_draft_failed', { code: errorName(error) });
        return apiError('provider_error', MSG.unavailable, 503);
      }
      try {
        const draft = await draftStyleCard(gateway, {
          answers,
          sampleExplanations,
          mistakeCandidates: [...new Set(parsed.data.mistakeCandidates)],
        });
        return ok({ draft }, 200);
      } catch (error) {
        const code = error instanceof IngestError ? error.code : errorName(error);
        log.error('studio.style_card_draft_failed', { code });
        return apiError('provider_error', MSG.draftFailed, 502);
      }
    },

    save: async (req, ctx) => {
      const input = await body(req);
      if (input instanceof Response) return input;
      const parsed = SaveSchema.safeParse(input);
      if (!parsed.success) return validation();
      try {
        const card = await backend.repos().styleCards.create(scopeOf(ctx), parsed.data);
        return ok({ card }, 201);
      } catch (error) {
        return fromRepositoryError(error);
      }
    },
  };
}
