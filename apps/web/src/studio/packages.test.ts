// Task 8.6 Phase C: the studio packages API over an in-memory backend (no database, no model;
// rule 4). The teacher is always the session's principal; the agent id comes from the repos, never
// the body; every response is `no-store`; repo errors map to fixed codes and an unknown error is a
// 500 logged by name only.
import type { ModelPolicy, PackageConfig, StyleCard } from '@edmate/contracts';
import {
  PACKAGES_MAX,
  RepositoryError,
  type Outline,
  type PackageDraft,
  type TeacherPackageRow,
} from '@edmate/db';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import type { Principal, RoleContext } from '../auth/guard';
import { monthlyEstimate } from './costEstimate';
import { createPackageHandlers, STYLE_CARD_LINK, type PackagesBackend } from './packages';
import { MAX_BODY_BYTES } from './routes';

const ASHA: Principal = { userId: 't_asha', role: 'teacher' };
const ctx: RoleContext = { principal: ASHA, params: Promise.resolve({}) };
const SCOPE = { teacherId: 't_asha' };
const PER_TURN = 21_000;
const POLICY = {
  small: { provider: 'anthropic', model: 'claude-haiku-4-5' },
  main: { provider: 'anthropic', model: 'claude-sonnet-5' },
} as unknown as ModelPolicy;

const CARD = { id: 'sc_1', teacherId: 't_asha', version: 1 } as unknown as StyleCard;
const OUTLINE: Outline = {
  courseId: 'c_1',
  outlineVersion: 1,
  modules: [
    { id: 'm_1', title: 'Algebra', order: 0, topics: [] },
    { id: 'm_2', title: 'Geometry', order: 1, topics: [] },
  ],
};

const BODY = {
  name: 'Free starter',
  moduleIds: ['m_1'],
  skills: ['explain', 'practice'],
  helpCeiling: 2,
  finalAnswers: 'after_attempt',
  dailyMessageLimit: 10,
  liveClassesPerMonth: 0,
  pricePerMonth: { amountMinor: 0 },
  lockedReply: 'name_package',
};
const PAID = {
  ...BODY,
  name: 'Full course',
  skills: ['explain', 'coach', 'practice', 'feedback', 'mock_interview', 'revision'],
  helpCeiling: 3,
  dailyMessageLimit: 20,
  liveClassesPerMonth: 2,
  pricePerMonth: { amountMinor: 2900 },
  trialDays: 7,
};

interface Opts {
  card?: StyleCard | null;
  outline?: Outline | null;
  rows?: TeacherPackageRow[];
  fail?: Partial<Record<string, unknown>>;
}

/** An in-memory backend recording every repo call (method + scope + input). */
function memoryBackend(opts: Opts = {}) {
  const rows: TeacherPackageRow[] = [...(opts.rows ?? [])];
  const calls: { method: string; scope: unknown; input?: unknown }[] = [];
  const log = { error: vi.fn() };
  let n = rows.length;
  const step = async (method: string, scope: unknown, input?: unknown) => {
    calls.push({ method, scope, input });
    const f = opts.fail?.[method];
    if (f !== undefined) throw f;
  };
  const config = (
    packageId: string,
    agentId: string,
    version: number,
    draft: PackageDraft,
  ): PackageConfig => ({ ...draft, id: packageId, version, teacherId: 't_asha', agentId });
  const backend: PackagesBackend = {
    repos: {
      courses: {
        ensureDefault: async (scope) => {
          await step('courses.ensureDefault', scope);
          return { id: 'c_1', title: 'My course', outlineVersion: 1 };
        },
      },
      outline: {
        getOutline: async (scope) => {
          await step('outline.getOutline', scope);
          return opts.outline === undefined ? OUTLINE : opts.outline;
        },
      },
      styleCards: {
        latest: async (scope) => {
          await step('styleCards.latest', scope);
          return opts.card === undefined ? CARD : opts.card;
        },
      },
      agents: {
        ensureDraft: async (scope, input) => {
          await step('agents.ensureDraft', scope, input);
          return { agentId: 'a_1', version: 1 };
        },
      },
      packages: {
        listForTeacher: async (scope) => {
          await step('packages.listForTeacher', scope);
          return rows.map((r) => ({ ...r }));
        },
        create: async (scope, input) => {
          await step('packages.create', scope, input);
          n += 1;
          const packageId = `p_${n}`;
          rows.push({
            packageId,
            agentId: input.agentId,
            liveVersion: null,
            config: config(packageId, input.agentId, 1, input.draft),
          });
          return { packageId, version: 1 };
        },
        saveVersion: async (scope, input) => {
          await step('packages.saveVersion', scope, input);
          const row = rows.find((r) => r.packageId === input.packageId)!;
          const version = row.config.version + 1;
          row.config = config(input.packageId, input.agentId, version, input.draft);
          return { packageId: input.packageId, version };
        },
      },
    },
    promptPackVersion: '1.2.0',
    modelPolicy: POLICY,
    perTurnMicroUsd: PER_TURN,
    log,
  };
  return { backend, calls, rows, log };
}

function handlersFor(b: PackagesBackend) {
  const fallbackLog = { error: vi.fn() };
  return { h: createPackageHandlers(async () => b, fallbackLog), fallbackLog };
}

function req(method: string, body?: unknown, raw?: string): NextRequest {
  return new NextRequest('http://localhost:8080/api/studio/packages', {
    method,
    ...(method === 'GET'
      ? {}
      : {
          body: raw ?? JSON.stringify(body),
          headers: { 'content-type': 'application/json' },
        }),
  });
}

const writes = (calls: { method: string }[]) =>
  calls.filter((c) =>
    ['packages.create', 'packages.saveVersion', 'agents.ensureDraft', 'courses.ensureDefault'].includes(
      c.method,
    ),
  );

function existingRow(packageId = 'p_1', agentId = 'a_1'): TeacherPackageRow {
  const { pricePerMonth, ...rest } = BODY;
  return {
    packageId,
    agentId,
    liveVersion: null,
    config: {
      ...(rest as Omit<PackageDraft, 'pricePerMonth'>),
      pricePerMonth: { ...pricePerMonth, currency: 'USD' },
      id: packageId,
      version: 1,
      teacherId: 't_asha',
      agentId,
    } as PackageConfig,
  };
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

describe('GET /api/studio/packages', () => {
  it('no agent yet: no packages, the modules, setup and the per-turn cost', async () => {
    const { backend, calls } = memoryBackend({ card: null });
    const { h } = handlersFor(backend);
    const res = await h.list(req('GET'), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await json(res)).toEqual({
      packages: [],
      modules: [
        { id: 'm_1', title: 'Algebra' },
        { id: 'm_2', title: 'Geometry' },
      ],
      setup: { styleCard: false, styleCardLink: STYLE_CARD_LINK },
      perTurnMicroUsd: PER_TURN,
    });
    expect(calls.every((c) => JSON.stringify(c.scope) === JSON.stringify(SCOPE))).toBe(true);
  });

  it('lists each package with its newest settings and its estimate', async () => {
    const { backend } = memoryBackend({ rows: [existingRow()] });
    const { h } = handlersFor(backend);
    const body = await json(await h.list(req('GET'), ctx));
    expect(body.setup).toEqual({ styleCard: true, styleCardLink: STYLE_CARD_LINK });
    expect(body.packages).toEqual([
      {
        packageId: 'p_1',
        version: 1,
        liveVersion: null,
        draft: { ...BODY, pricePerMonth: { amountMinor: 0, currency: 'USD' } },
        estimate: monthlyEstimate(PER_TURN, 10, 0),
      },
    ]);
  });

  it('no outline: an empty module list', async () => {
    const { backend } = memoryBackend({ outline: null });
    const { h } = handlersFor(backend);
    expect((await json(await h.list(req('GET'), ctx))).modules).toEqual([]);
  });
});

describe('POST /api/studio/packages', () => {
  it('first package: makes the agent from the course, style card and mix, then the package', async () => {
    const { backend, calls } = memoryBackend();
    const { h } = handlersFor(backend);
    const res = await h.create(req('POST', BODY), ctx);
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(calls.map((c) => c.method)).toEqual([
      'packages.listForTeacher',
      'styleCards.latest',
      'courses.ensureDefault',
      'agents.ensureDraft',
      'packages.create',
    ]);
    expect(calls.find((c) => c.method === 'agents.ensureDraft')!.input).toEqual({
      courseId: 'c_1',
      styleCardId: 'sc_1',
      promptPackVersion: '1.2.0',
      modelPolicy: POLICY,
    });
    expect(calls.find((c) => c.method === 'packages.create')!.input).toEqual({
      agentId: 'a_1',
      draft: { ...BODY, pricePerMonth: { amountMinor: 0, currency: 'USD' } },
    });
    expect(await json(res)).toEqual({
      package: {
        packageId: 'p_1',
        version: 1,
        liveVersion: null,
        draft: { ...BODY, pricePerMonth: { amountMinor: 0, currency: 'USD' } },
        estimate: monthlyEstimate(PER_TURN, 10, 0),
      },
    });
  });

  it('a later package reuses the teacher agent from the list; never one from the body', async () => {
    const { backend, calls } = memoryBackend({ rows: [existingRow('p_1', 'a_existing')] });
    const { h } = handlersFor(backend);
    const res = await h.create(req('POST', PAID), ctx);
    expect(res.status).toBe(201);
    expect(calls.some((c) => c.method === 'agents.ensureDraft')).toBe(false);
    const create = calls.find((c) => c.method === 'packages.create')!;
    expect(create.input).toEqual({
      agentId: 'a_existing',
      draft: { ...PAID, pricePerMonth: { amountMinor: 2900, currency: 'USD' } },
    });
    const body = await json(res);
    expect((body.package as { estimate: unknown }).estimate).toEqual(
      monthlyEstimate(PER_TURN, 20, 2900),
    );
  });

  it('no style card: 409 style_card_required with the link, nothing written', async () => {
    const { backend, calls } = memoryBackend({ card: null });
    const { h } = handlersFor(backend);
    const res = await h.create(req('POST', BODY), ctx);
    expect(res.status).toBe(409);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await json(res);
    expect(body.reason).toBe('style_card_required');
    expect(body.link).toBe(STYLE_CARD_LINK);
    expect((body.error as { code: string }).code).toBe('validation');
    expect(writes(calls)).toEqual([]);
  });

  it(`at ${PACKAGES_MAX} packages: 409 package_limit, nothing written`, async () => {
    const rows = Array.from({ length: PACKAGES_MAX }, (_, i) => existingRow(`p_${i + 1}`));
    const { backend, calls } = memoryBackend({ rows });
    const { h } = handlersFor(backend);
    const res = await h.create(req('POST', BODY), ctx);
    expect(res.status).toBe(409);
    const body = await json(res);
    expect(body.reason).toBe('package_limit');
    expect((body.error as { code: string }).code).toBe('limit_reached');
    expect(writes(calls)).toEqual([]);
  });

  it('the repo refusing the cap in a race is also 409 package_limit', async () => {
    const { backend } = memoryBackend({
      fail: { 'packages.create': new RepositoryError('invalid', 'packages.create') },
    });
    const { h } = handlersFor(backend);
    const res = await h.create(req('POST', BODY), ctx);
    expect(res.status).toBe(409);
    expect((await json(res)).reason).toBe('package_limit');
  });

  it.each([
    ['teacherId in the body', { ...BODY, teacherId: 't_other' }],
    ['agentId in the body', { ...BODY, agentId: 'a_other' }],
    ['currency in the price', { ...BODY, pricePerMonth: { amountMinor: 0, currency: 'EUR' } }],
    ['id in the body', { ...BODY, id: 'p_x' }],
    ['empty name', { ...BODY, name: '   ' }],
    ['name over 80', { ...BODY, name: 'x'.repeat(81) }],
    ['no module', { ...BODY, moduleIds: [] }],
    ['a repeated module', { ...BODY, moduleIds: ['m_1', 'm_1'] }],
    ['a bad module id', { ...BODY, moduleIds: ['m 1'] }],
    ['no skill', { ...BODY, skills: [] }],
    ['study_plan', { ...BODY, skills: ['study_plan'] }],
    ['a repeated skill', { ...BODY, skills: ['explain', 'explain'] }],
    ['help ceiling 5', { ...BODY, helpCeiling: 5 }],
    ['help ceiling 0', { ...BODY, helpCeiling: 0 }],
    ['a bad finalAnswers', { ...BODY, finalAnswers: 'sometimes' }],
    ['daily limit 0', { ...BODY, dailyMessageLimit: 0 }],
    ['daily limit 101', { ...BODY, dailyMessageLimit: 101 }],
    ['daily limit 2.5', { ...BODY, dailyMessageLimit: 2.5 }],
    ['live classes 9', { ...BODY, liveClassesPerMonth: 9 }],
    ['live classes -1', { ...BODY, liveClassesPerMonth: -1 }],
    ['price 99 cents', { ...BODY, pricePerMonth: { amountMinor: 99 } }],
    ['price over $1,000', { ...BODY, pricePerMonth: { amountMinor: 100_001 } }],
    ['negative price', { ...BODY, pricePerMonth: { amountMinor: -100 } }],
    ['trial on a free package', { ...BODY, trialDays: 7 }],
    ['trial 31 days', { ...PAID, trialDays: 31 }],
    ['a bad locked reply', { ...BODY, lockedReply: 'custom' }],
    ['a missing field', { ...BODY, lockedReply: undefined }],
    ['not an object', ['x']],
    ['null', null],
  ])('400 with no write: %s', async (_name, body) => {
    const { backend, calls } = memoryBackend();
    const { h } = handlersFor(backend);
    const res = await h.create(req('POST', body), ctx);
    expect(res.status).toBe(400);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(((await json(res)).error as { code: string }).code).toBe('validation');
    expect(calls).toEqual([]);
  });

  it('400 for a body that is not JSON', async () => {
    const { backend, calls } = memoryBackend();
    const { h } = handlersFor(backend);
    const res = await h.create(req('POST', undefined, '{not json'), ctx);
    expect(res.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('a free package with trialDays 0 stores no trial; a paid one keeps 0', async () => {
    const free = memoryBackend();
    await handlersFor(free.backend).h.create(req('POST', { ...BODY, trialDays: 0 }), ctx);
    expect(free.rows[0]!.config).not.toHaveProperty('trialDays');
    const paid = memoryBackend();
    await handlersFor(paid.backend).h.create(req('POST', { ...PAID, trialDays: 0 }), ctx);
    expect(paid.rows[0]!.config.trialDays).toBe(0);
  });

  it('the name is stored trimmed', async () => {
    const { backend, rows } = memoryBackend();
    await handlersFor(backend).h.create(req('POST', { ...BODY, name: '  Starter  ' }), ctx);
    expect(rows[0]!.config.name).toBe('Starter');
  });

  it('413 before parsing a body over the cap', async () => {
    const { backend, calls } = memoryBackend();
    const { h } = handlersFor(backend);
    const big = JSON.stringify({ ...BODY, name: 'x'.repeat(MAX_BODY_BYTES) });
    const res = await h.create(req('POST', undefined, big), ctx);
    expect(res.status).toBe(413);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(((await json(res)).error as { code: string }).code).toBe('input_too_large');
    expect(calls).toEqual([]);
  });

  it.each([
    ['scope', 404, 'not_found'],
    ['not_found', 404, 'not_found'],
    ['integrity', 409, 'validation'],
    ['failed', 503, 'provider_error'],
  ] as const)('a repo %s error is %i %s', async (kind, status, code) => {
    const { backend, log } = memoryBackend({
      fail: { 'agents.ensureDraft': new RepositoryError(kind, 'agents.ensureDraft') },
    });
    const { h } = handlersFor(backend);
    const res = await h.create(req('POST', BODY), ctx);
    expect(res.status).toBe(status);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(((await json(res)).error as { code: string }).code).toBe(code);
    if (kind === 'failed') {
      expect(log.error).toHaveBeenCalledWith('studio.packages_failed', { reason: 'failed' });
    }
  });

  it('a foreign module (repo scope) is 404', async () => {
    const { backend } = memoryBackend({
      fail: { 'packages.create': new RepositoryError('scope', 'packages.create') },
    });
    const res = await handlersFor(backend).h.create(req('POST', BODY), ctx);
    expect(res.status).toBe(404);
  });

  it('an unknown error is 500 internal, logged by name only, never its message or the body', async () => {
    const { backend, log } = memoryBackend({
      fail: { 'packages.create': new TypeError('secret student text Asha') },
    });
    const { h } = handlersFor(backend);
    const res = await h.create(req('POST', { ...BODY, name: 'Private name' }), ctx);
    expect(res.status).toBe(500);
    const body = await json(res);
    expect(body.reason).toBe('internal');
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(log.error.mock.calls).toEqual([
      ['studio.packages_failed', { reason: 'internal', error: 'TypeError' }],
    ]);
    expect(JSON.stringify(log.error.mock.calls)).not.toMatch(/secret|Private|Asha/);
  });

  it('a thrown non-Error is logged by its type', async () => {
    const { backend, log } = memoryBackend({ fail: { 'packages.create': 'boom' } });
    const res = await handlersFor(backend).h.create(req('POST', BODY), ctx);
    expect(res.status).toBe(500);
    expect(log.error).toHaveBeenCalledWith('studio.packages_failed', {
      reason: 'internal',
      error: 'string',
    });
  });
});

describe('PUT /api/studio/packages', () => {
  it('saves a new version on the package agent, never one from the body', async () => {
    const { backend, calls } = memoryBackend({ rows: [existingRow('p_1', 'a_7')] });
    const { h } = handlersFor(backend);
    const res = await h.update(req('PUT', { packageId: 'p_1', ...PAID }), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(calls.find((c) => c.method === 'packages.saveVersion')!.input).toEqual({
      packageId: 'p_1',
      agentId: 'a_7',
      draft: { ...PAID, pricePerMonth: { amountMinor: 2900, currency: 'USD' } },
    });
    expect(calls.some((c) => c.method === 'agents.ensureDraft')).toBe(false);
    expect(await json(res)).toEqual({
      package: {
        packageId: 'p_1',
        version: 2,
        liveVersion: null,
        draft: { ...PAID, pricePerMonth: { amountMinor: 2900, currency: 'USD' } },
        estimate: monthlyEstimate(PER_TURN, 20, 2900),
      },
    });
  });

  it('a package not in the teacher list is 404, nothing written', async () => {
    const { backend, calls } = memoryBackend({ rows: [existingRow('p_1')] });
    const res = await handlersFor(backend).h.update(
      req('PUT', { packageId: 'p_other', ...BODY }),
      ctx,
    );
    expect(res.status).toBe(404);
    expect(writes(calls)).toEqual([]);
  });

  it.each([
    ['no packageId', BODY],
    ['agentId in the body', { packageId: 'p_1', agentId: 'a_x', ...BODY }],
    ['a bad packageId', { ...BODY, packageId: 'p 1' }],
  ])('400 with no call: %s', async (_name, body) => {
    const { backend, calls } = memoryBackend({ rows: [existingRow()] });
    const res = await handlersFor(backend).h.update(req('PUT', body), ctx);
    expect(res.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('a repo not_found on save (raced away) is 404', async () => {
    const { backend } = memoryBackend({
      rows: [existingRow()],
      fail: { 'packages.saveVersion': new RepositoryError('not_found', 'packages.saveVersion') },
    });
    const res = await handlersFor(backend).h.update(req('PUT', { packageId: 'p_1', ...BODY }), ctx);
    expect(res.status).toBe(404);
  });

  it('a repo invalid on save is 400', async () => {
    const { backend } = memoryBackend({
      rows: [existingRow()],
      fail: { 'packages.saveVersion': new RepositoryError('invalid', 'packages.saveVersion') },
    });
    const res = await handlersFor(backend).h.update(req('PUT', { packageId: 'p_1', ...BODY }), ctx);
    expect(res.status).toBe(400);
  });
});

describe('an unavailable backend', () => {
  it('is 503 on every handler, logged by reason code only', async () => {
    const fallbackLog = { error: vi.fn() };
    const err = Object.assign(new Error('no signed set in /secret/path'), {
      name: 'StudioUnavailableError',
      reason: 'prompt_packs',
    });
    const h = createPackageHandlers(() => Promise.reject(err), fallbackLog);
    for (const [handler, method] of [
      [h.list, 'GET'],
      [h.create, 'POST'],
      [h.update, 'PUT'],
    ] as const) {
      const res = await handler(req(method, BODY), ctx);
      expect(res.status).toBe(503);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect((await json(res)).reason).toBe('unavailable');
    }
    expect(fallbackLog.error).toHaveBeenCalledWith('studio.packages_unavailable', {
      reason: 'prompt_packs',
    });
    expect(JSON.stringify(fallbackLog.error.mock.calls)).not.toContain('secret');
  });

  it('an error without a reason is logged by its name', async () => {
    const fallbackLog = { error: vi.fn() };
    const h = createPackageHandlers(() => Promise.reject(new RangeError('x')), fallbackLog);
    expect((await h.list(req('GET'), ctx)).status).toBe(503);
    expect(fallbackLog.error).toHaveBeenCalledWith('studio.packages_unavailable', {
      reason: 'RangeError',
    });
  });

  it('a list failure is also mapped (not_found -> 404)', async () => {
    const { backend } = memoryBackend({
      fail: { 'packages.listForTeacher': new RepositoryError('not_found', 'packages.listForTeacher') },
    });
    expect((await handlersFor(backend).h.list(req('GET'), ctx)).status).toBe(404);
  });
});
