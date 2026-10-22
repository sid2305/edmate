// Task 8.4a: the style card API (get, draft, save) over a fake styleCards repo and the scripted
// gateway (no database, no real model; rule 4). Drafting never writes; saving writes one new
// version; the teacher is always the session's own principal.
import type { ModelRequest, StyleCard } from '@edmate/contracts';
import { RepositoryError, type Repositories } from '@edmate/db';
import { manualClock, ScriptedGateway, ScriptedProviderError } from '@edmate/harness/testing';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import type { Principal, RoleContext } from '../auth/guard';
import { createStyleCardHandlers, type StyleCardBackend } from './styleCardRoutes';
import { INTERVIEW_LIMITS, QUESTION_TOPICS } from './styleCardQuestions';

const ASHA: Principal = { userId: 't_asha', role: 'teacher' };
const ctx: RoleContext = { principal: ASHA, params: Promise.resolve({}) };
const URL_BASE = 'http://localhost:8080/api/studio/style-card';

function req(body: unknown, path = '', method = 'POST'): NextRequest {
  return new NextRequest(`${URL_BASE}${path}`, {
    method,
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}
const getReq = () => new NextRequest(URL_BASE, { method: 'GET' });

/** An in-memory styleCards repo: versions per teacher, like the real one. */
function memoryRepo() {
  const rows: StyleCard[] = [];
  const latest = vi.fn(async (scope: { teacherId: string }) => {
    const mine = rows.filter((r) => r.teacherId === scope.teacherId);
    return mine.at(-1) ?? null;
  });
  const create = vi.fn(
    async (scope: { teacherId: string }, d: { text: string; mistakeTags: string[] }) => {
      const version = rows.filter((r) => r.teacherId === scope.teacherId).length + 1;
      const card: StyleCard = { id: `sty_${rows.length + 1}`, teacherId: scope.teacherId, version, ...d };
      rows.push(card);
      return card;
    },
  );
  const repos = { styleCards: { latest, create } } as unknown as Pick<Repositories, 'styleCards'>;
  return { rows, latest, create, repos };
}

const DRAFT = { text: 'Warm and brief. Ask before telling.', mistakeTags: ['units'] };
const INTERVIEW = {
  answers: { tone: 'Warm, a little playful.', stuckStudent: 'I ask what they tried first.' },
  sampleExplanations: ['To add fractions, first make the bottoms match.'],
  mistakeCandidates: ['units', 'sign-error'],
};

function setup(
  opts: {
    objects?: { value: unknown }[];
    gateway?: StyleCardBackend['gateway'];
    repo?: ReturnType<typeof memoryRepo>;
  } = {},
) {
  const repo = opts.repo ?? memoryRepo();
  const scripted = new ScriptedGateway(
    { generateObject: opts.objects ?? [{ value: DRAFT }] },
    manualClock(),
  );
  const generate = vi.spyOn(scripted, 'generateObject');
  const log = { error: vi.fn() };
  const handlers = createStyleCardHandlers(
    { repos: () => repo.repos, gateway: opts.gateway ?? (async () => scripted) },
    log,
  );
  return { repo, handlers, generate, log };
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}
const errorCode = async (res: Response) =>
  ((await json(res)).error as { code: string; retryable: boolean }).code;

describe('style card API: get', () => {
  it('returns null before the first save, scoped to the session teacher', async () => {
    const { handlers, repo } = setup();
    const res = await handlers.get(getReq(), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await json(res)).toEqual({ card: null });
    expect(repo.latest).toHaveBeenCalledWith({ teacherId: 't_asha' });
  });

  it('maps a repository failure to a fixed 500', async () => {
    const repo = memoryRepo();
    repo.latest.mockRejectedValueOnce(new RepositoryError('failed', 'styleCards.latest'));
    const { handlers } = setup({ repo });
    const res = await handlers.get(getReq(), ctx);
    expect(res.status).toBe(500);
    expect(await errorCode(res)).toBe('provider_error');
  });
});

describe('style card API: draft', () => {
  it('drafts over the scripted gateway and writes nothing', async () => {
    const { handlers, repo, generate } = setup();
    const res = await handlers.draft(req(INTERVIEW, '/draft'), ctx);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ draft: DRAFT });
    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.rows).toEqual([]);
    // The model gets each answer under its topic, the samples and the teacher's own candidates.
    const sent = JSON.parse((generate.mock.calls[0]![0] as ModelRequest).messages[0]!.content) as {
      answers: { question: string; answer: string }[];
      sampleExplanations: string[];
      mistakeCandidates: string[];
    };
    expect(sent.answers).toEqual([
      { question: QUESTION_TOPICS.tone, answer: 'Warm, a little playful.' },
      { question: QUESTION_TOPICS.stuckStudent, answer: 'I ask what they tried first.' },
    ]);
    expect(sent.sampleExplanations).toEqual(INTERVIEW.sampleExplanations);
    expect(sent.mistakeCandidates).toEqual(['units', 'sign-error']);
  });

  it('drops blank answers and samples, and trims and de-duplicates candidates', async () => {
    const { handlers, generate } = setup();
    const res = await handlers.draft(
      req(
        {
          answers: { tone: '  ', pacing: ' Slow at first. ' },
          sampleExplanations: ['', 'One sample.'],
          mistakeCandidates: [' units ', 'units'],
        },
        '/draft',
      ),
      ctx,
    );
    expect(res.status).toBe(200);
    const sent = JSON.parse((generate.mock.calls[0]![0] as ModelRequest).messages[0]!.content) as {
      answers: unknown[];
      sampleExplanations: string[];
      mistakeCandidates: string[];
    };
    expect(sent.answers).toEqual([{ question: QUESTION_TOPICS.pacing, answer: 'Slow at first.' }]);
    expect(sent.sampleExplanations).toEqual(['One sample.']);
    expect(sent.mistakeCandidates).toEqual(['units']);
  });

  it.each([
    ['not JSON', '{not json'],
    ['an empty interview', { answers: {}, sampleExplanations: [], mistakeCandidates: [] }],
    ['only blank answers', { answers: { tone: ' ' }, sampleExplanations: [], mistakeCandidates: [] }],
    ['an unknown question key', { ...INTERVIEW, answers: { shoeSize: '9' } }],
    [
      'a too-long answer',
      { ...INTERVIEW, answers: { tone: 'x'.repeat(INTERVIEW_LIMITS.answerMaxChars + 1) } },
    ],
    [
      'too many samples',
      { ...INTERVIEW, sampleExplanations: Array.from({ length: INTERVIEW_LIMITS.samplesMax + 1 }, () => 's') },
    ],
    [
      'a too-long sample',
      { ...INTERVIEW, sampleExplanations: ['x'.repeat(INTERVIEW_LIMITS.sampleMaxChars + 1)] },
    ],
    ['too many candidates', { ...INTERVIEW, mistakeCandidates: Array.from({ length: 21 }, (_, i) => `t${i}`) }],
    ['an empty candidate', { ...INTERVIEW, mistakeCandidates: [''] }],
    ['a stray teacherId', { ...INTERVIEW, teacherId: 't_other' }],
    ['a missing field', { answers: INTERVIEW.answers }],
  ])('%s is a 400 validation and calls no model', async (_label, body) => {
    const { handlers, generate } = setup();
    const res = await handlers.draft(req(body, '/draft'), ctx);
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('validation');
    expect(generate).not.toHaveBeenCalled();
  });

  it('a body over the cap is 413', async () => {
    const { handlers, generate } = setup();
    const res = await handlers.draft(req({ ...INTERVIEW, pad: 'x'.repeat(20_000) }, '/draft'), ctx);
    expect(res.status).toBe(413);
    expect(await errorCode(res)).toBe('input_too_large');
    expect(generate).not.toHaveBeenCalled();
  });

  it('a provider failure is a retryable 502 and is logged by code', async () => {
    const failing = { generateObject: () => Promise.reject(new ScriptedProviderError('provider_error')) };
    const { handlers, log } = setup({ gateway: async () => failing });
    const res = await handlers.draft(req(INTERVIEW, '/draft'), ctx);
    expect(res.status).toBe(502);
    const body = (await json(res)).error as { code: string; retryable: boolean };
    expect(body).toMatchObject({ code: 'provider_error', retryable: true });
    expect(log.error).toHaveBeenCalledWith('studio.style_card_draft_failed', {
      code: 'provider_error',
    });
  });

  it('a draft using a tag outside the teacher’s list is a 502 and is logged', async () => {
    const { handlers, log, repo } = setup({
      objects: [{ value: { text: 'ok', mistakeTags: ['invented'] } }],
    });
    const res = await handlers.draft(req(INTERVIEW, '/draft'), ctx);
    expect(res.status).toBe(502);
    expect(log.error).toHaveBeenCalledWith('studio.style_card_draft_failed', {
      code: 'validation',
    });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('no model backend (for example no provider key) is a 503, logged by reason', async () => {
    const { handlers, log } = setup({
      gateway: () => Promise.reject(Object.assign(new Error('x'), { name: 'TurnUnavailableError' })),
    });
    const res = await handlers.draft(req(INTERVIEW, '/draft'), ctx);
    expect(res.status).toBe(503);
    expect(await errorCode(res)).toBe('provider_error');
    expect(log.error).toHaveBeenCalledWith('studio.style_card_draft_failed', {
      code: 'TurnUnavailableError',
    });
  });
});

describe('style card API: save', () => {
  it('stores a new version for the session teacher and returns it', async () => {
    const { handlers, repo } = setup();
    const res = await handlers.save(req(DRAFT, '', 'PUT'), ctx);
    expect(res.status).toBe(201);
    expect(await json(res)).toEqual({
      card: { id: 'sty_1', teacherId: 't_asha', version: 1, ...DRAFT },
    });
    expect(repo.create).toHaveBeenCalledWith({ teacherId: 't_asha' }, DRAFT);
  });

  it.each([
    ['not JSON', 'nope'],
    ['a card over 300 words', { text: Array.from({ length: 301 }, () => 'w').join(' '), mistakeTags: [] }],
    ['a missing mistakeTags', { text: 'ok' }],
    ['a client-set teacherId', { ...DRAFT, teacherId: 't_other' }],
    ['a client-set version', { ...DRAFT, version: 9 }],
  ])('%s is a 400 validation and writes nothing', async (_label, body) => {
    const { handlers, repo } = setup();
    const res = await handlers.save(req(body, '', 'PUT'), ctx);
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('validation');
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('a body over the cap is 413', async () => {
    const { handlers, repo } = setup();
    const res = await handlers.save(req({ ...DRAFT, text: 'x '.repeat(10_000) }, '', 'PUT'), ctx);
    expect(res.status).toBe(413);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid', 400, 'validation'],
    ['integrity', 400, 'validation'],
    ['scope', 403, 'forbidden'],
    ['not_found', 404, 'not_found'],
    ['failed', 500, 'provider_error'],
  ] as const)('a repository %s is %i %s', async (kind, status, code) => {
    const repo = memoryRepo();
    repo.create.mockRejectedValueOnce(new RepositoryError(kind, 'styleCards.create'));
    const { handlers } = setup({ repo });
    const res = await handlers.save(req(DRAFT, '', 'PUT'), ctx);
    expect(res.status).toBe(status);
    expect(await errorCode(res)).toBe(code);
  });

  it('any other error is a fixed 500 that names nothing', async () => {
    const repo = memoryRepo();
    repo.create.mockRejectedValueOnce(new Error('connection to db-host:5432 refused'));
    const { handlers } = setup({ repo });
    const res = await handlers.save(req(DRAFT, '', 'PUT'), ctx);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await json(res))).not.toContain('db-host');
  });
});

describe('style card API: preview and edit, end to end', () => {
  it('drafts, the teacher edits, saves, and the next read is the edited version', async () => {
    const { handlers, repo } = setup({
      objects: [{ value: DRAFT }, { value: { text: 'Second draft.', mistakeTags: [] } }],
    });
    const drafted = (await json(await handlers.draft(req(INTERVIEW, '/draft'), ctx))).draft as {
      text: string;
      mistakeTags: string[];
    };
    const edited = { text: `${drafted.text} Never give the final answer first.`, mistakeTags: ['units', 'sign-error'] };
    expect((await handlers.save(req(edited, '', 'PUT'), ctx)).status).toBe(201);
    const first = (await json(await handlers.get(getReq(), ctx))).card as StyleCard;
    expect(first).toMatchObject({ version: 1, ...edited });

    // A direct edit of the saved card, no interview: a new version, the old one untouched.
    const fix = { text: `${first.text} Use metric units.`, mistakeTags: first.mistakeTags };
    expect((await handlers.save(req(fix, '', 'PUT'), ctx)).status).toBe(201);
    const second = (await json(await handlers.get(getReq(), ctx))).card as StyleCard;
    expect(second).toMatchObject({ version: 2, ...fix });
    expect(repo.rows[0]).toMatchObject({ version: 1, ...edited });
  });
});
