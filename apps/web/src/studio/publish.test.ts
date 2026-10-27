// Task 8.7 Phase D: the studio publish API over an in-memory backend (no database, no queue, no
// model; rule 4). The teacher is always the session's principal (the body is a strict `{}`); every
// response is `no-store`; repo refusals map to fixed codes plus a `reason`; an enqueue failure
// ends the run `error` so it never sits queued. Written red before publish.ts.
import type { ModelPolicy, StyleCard } from '@edmate/contracts';
import {
  PublishRefusedError,
  RepositoryError,
  type FailedCase,
  type GateRunRow,
  type PublishRefusal,
  type TeacherPackageRow,
} from '@edmate/db';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import type { Principal, RoleContext } from '../auth/guard';
import { createPublishHandlers, type PublishBackend } from './publish';
import { MAX_BODY_BYTES } from './routes';

const ASHA: Principal = { userId: 't_asha', role: 'teacher' };
const ctx: RoleContext = { principal: ASHA, params: Promise.resolve({}) };
const SCOPE = { teacherId: 't_asha' };
const POLICY = { small: { provider: 'anthropic', model: 'm' } } as unknown as ModelPolicy;
const CARD = { id: 'sc_1', teacherId: 't_asha', version: 1 } as unknown as StyleCard;
const PKG = {
  packageId: 'pkg_1',
  agentId: 'agt_1',
  liveVersion: null,
} as unknown as TeacherPackageRow;

function run(over: Partial<GateRunRow> = {}): GateRunRow {
  return {
    id: 'run_1',
    agentId: 'agt_1',
    agentVersion: 2,
    status: 'queued',
    changes: ['first_publish'],
    judgeModel: 'anthropic:judge',
    basis: {} as GateRunRow['basis'],
    passRate: null,
    summary: null,
    scorecard: null,
    createdAt: '2026-10-22T10:00:00.000Z',
    finishedAt: null,
    publishedAt: null,
    ...over,
  };
}

interface Opts {
  rows?: TeacherPackageRow[];
  card?: StyleCard | null;
  latest?: GateRunRow | null;
  failed?: FailedCase[];
  changed?: boolean;
  fail?: Partial<Record<string, unknown>>;
  enqueueFails?: boolean;
  /** ISO timestamp for `b.now()`; defaults to the fixture's own `createdAt` (never stale). */
  now?: string;
  /** The agent row `agents.get` returns; `null` for "agent not found" (task 12.2f Phase D). */
  agent?: { status: 'draft' | 'live' | 'suspended' } | null;
}

function memoryBackend(opts: Opts = {}) {
  const calls: { method: string; scope?: unknown; input?: unknown }[] = [];
  const log = { error: vi.fn() };
  const step = async (method: string, scope?: unknown, input?: unknown) => {
    calls.push({ method, scope, input });
    const f = opts.fail?.[method];
    if (f !== undefined) throw f;
  };
  const backend: PublishBackend = {
    repos: {
      teacherProfiles: {
        assertVerifiedForPublish: async (scope) =>
          step('teacherProfiles.assertVerifiedForPublish', scope),
      },
      packages: {
        listForTeacher: async (scope) => {
          await step('packages.listForTeacher', scope);
          return opts.rows ?? [PKG];
        },
      },
      courses: {
        ensureDefault: async (scope) => {
          await step('courses.ensureDefault', scope);
          return { id: 'c_1', title: 'My course', outlineVersion: 1 };
        },
      },
      styleCards: {
        latest: async (scope) => {
          await step('styleCards.latest', scope);
          return opts.card === undefined ? CARD : opts.card;
        },
      },
      publish: {
        startRun: async (scope, pins) => {
          await step('publish.startRun', scope, pins);
          return run();
        },
        finishRun: async (scope, input) => step('publish.finishRun', scope, input),
        latestRun: async (scope) => {
          await step('publish.latestRun', scope);
          return opts.latest ?? null;
        },
        failedCases: async (scope, runId) => {
          await step('publish.failedCases', scope, runId);
          return opts.failed ?? [];
        },
        changedSinceLastPublish: async (scope) => {
          await step('publish.changedSinceLastPublish', scope);
          return opts.changed ?? false;
        },
      },
      agents: {
        get: async (scope, agentId) => {
          await step('agents.get', scope, agentId);
          const a = opts.agent === undefined ? { status: 'live' as const } : opts.agent;
          return a === null
            ? null
            : { id: agentId, teacherId: 't_asha', status: a.status, liveVersion: 2 };
        },
      },
    },
    promptPackVersion: 'pp-2026-10',
    modelPolicy: POLICY,
    judgeModel: 'anthropic:judge',
    enqueue: vi.fn(async (job) => {
      calls.push({ method: 'enqueue', input: job });
      if (opts.enqueueFails) throw new Error('redis down: host secret');
    }),
    log,
    now: () => new Date(opts.now ?? '2026-10-22T10:00:00.000Z'),
  };
  return { backend, calls, log };
}

function handlers(opts: Opts = {}) {
  const m = memoryBackend(opts);
  const fallback = { error: vi.fn() };
  return { ...m, fallback, h: createPublishHandlers(async () => m.backend, fallback) };
}

const URL_ = 'http://localhost/api/studio/publish';
const post = (body: unknown = {}, headers: Record<string, string> = {}) =>
  new NextRequest(URL_, {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });
const get = () => new NextRequest(URL_, { method: 'GET' });

async function expectError(res: Response, status: number, code: string, reason?: string) {
  expect(res.status).toBe(status);
  expect(res.headers.get('cache-control')).toBe('no-store');
  const body = (await res.json()) as { error: { code: string; message: string }; reason?: string };
  expect(body.error.code).toBe(code);
  expect(body.reason).toBe(reason);
  return body;
}

describe('POST /api/studio/publish', () => {
  it('starts a run with the pins and enqueues it after startRun: 202 {runId}', async () => {
    const { h, calls } = handlers();
    const res = await h.start(post(), ctx);
    expect(res.status).toBe(202);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ runId: 'run_1' });
    expect(calls.map((c) => c.method)).toEqual([
      'teacherProfiles.assertVerifiedForPublish',
      'packages.listForTeacher',
      'styleCards.latest',
      'courses.ensureDefault',
      'publish.startRun',
      'enqueue',
    ]);
    for (const c of calls.filter((c) => c.scope !== undefined)) expect(c.scope).toEqual(SCOPE);
    expect(calls.find((c) => c.method === 'publish.startRun')?.input).toEqual({
      agentId: 'agt_1',
      courseId: 'c_1',
      styleCardId: 'sc_1',
      promptPackVersion: 'pp-2026-10',
      modelPolicy: POLICY,
      judgeModel: 'anthropic:judge',
    });
    expect(calls.at(-1)?.input).toEqual({ runId: 'run_1', teacherId: 't_asha' });
  });

  it.each([
    ['a teacher id', { teacherId: 't_other' }],
    ['an agent id', { agentId: 'agt_x' }],
    ['any key', { force: true }],
  ])('refuses a body with %s: 400, nothing called', async (_n, body) => {
    const { h, calls } = handlers();
    await expectError(await h.start(post(body), ctx), 400, 'validation');
    expect(calls).toEqual([]);
  });

  it('refuses a body that is not JSON or not an object: 400', async () => {
    const { h } = handlers();
    await expectError(await h.start(post('nope'), ctx), 400, 'validation');
    await expectError(await h.start(post([]), ctx), 400, 'validation');
  });

  it('refuses a body over the cap: 413, by content-length or by bytes read', async () => {
    const { h, calls } = handlers();
    await expectError(
      await h.start(post({}, { 'content-length': String(MAX_BODY_BYTES + 1) }), ctx),
      413,
      'input_too_large',
    );
    await expectError(
      await h.start(post('x'.repeat(MAX_BODY_BYTES + 1)), ctx),
      413,
      'input_too_large',
    );
    expect(calls).toEqual([]);
  });

  it('an unverified teacher is 403 not_verified, before any other read', async () => {
    const { h, calls } = handlers({
      fail: { 'teacherProfiles.assertVerifiedForPublish': new RepositoryError('scope', 'x') },
    });
    await expectError(await h.start(post(), ctx), 403, 'forbidden', 'not_verified');
    expect(calls.map((c) => c.method)).toEqual(['teacherProfiles.assertVerifiedForPublish']);
  });

  it('no packages is 409 no_packages, nothing started', async () => {
    const { h, calls } = handlers({ rows: [] });
    await expectError(await h.start(post(), ctx), 409, 'validation', 'no_packages');
    expect(calls.map((c) => c.method)).not.toContain('publish.startRun');
  });

  it('no style card is 409 style_card_required, nothing started', async () => {
    const { h, calls } = handlers({ card: null });
    await expectError(await h.start(post(), ctx), 409, 'validation', 'style_card_required');
    expect(calls.map((c) => c.method)).not.toContain('publish.startRun');
  });

  it.each<[PublishRefusal, number, string]>([
    ['gate_running', 409, 'validation'],
    ['nothing_to_publish', 409, 'validation'],
    ['no_packages', 409, 'validation'],
    ['suspended', 409, 'validation'],
  ])(
    'startRun refusing %s is %i with that reason; nothing enqueued',
    async (reason, status, code) => {
      const kind = reason === 'gate_running' ? 'integrity' : 'invalid';
      const { h, calls } = handlers({
        fail: { 'publish.startRun': new PublishRefusedError(kind, 'publish.startRun', reason) },
      });
      await expectError(await h.start(post(), ctx), status, code, reason);
      expect(calls.map((c) => c.method)).not.toContain('enqueue');
    },
  );

  it('startRun scope (verification lost in the race) is 403 not_verified', async () => {
    const { h } = handlers({ fail: { 'publish.startRun': new RepositoryError('scope', 'x') } });
    await expectError(await h.start(post(), ctx), 403, 'forbidden', 'not_verified');
  });

  it('a plain invalid or integrity from startRun is 409 conflict; not_found is 404', async () => {
    let r = handlers({ fail: { 'publish.startRun': new RepositoryError('invalid', 'x') } });
    await expectError(await r.h.start(post(), ctx), 409, 'validation', 'conflict');
    r = handlers({ fail: { 'publish.startRun': new RepositoryError('integrity', 'x') } });
    await expectError(await r.h.start(post(), ctx), 409, 'validation', 'conflict');
    r = handlers({ fail: { 'publish.startRun': new RepositoryError('not_found', 'x') } });
    await expectError(await r.h.start(post(), ctx), 404, 'not_found');
  });

  it('a repo that is down is 503 unavailable, logged by code', async () => {
    const { h, log } = handlers({
      fail: { 'packages.listForTeacher': new RepositoryError('failed', 'x') },
    });
    await expectError(await h.start(post(), ctx), 503, 'provider_error', 'unavailable');
    expect(log.error).toHaveBeenCalledWith('studio.publish_failed', { reason: 'failed' });
  });

  it('an unknown error is 500 internal, logged by error name only', async () => {
    const { h, log } = handlers({ fail: { 'styleCards.latest': new TypeError('secret text') } });
    const body = await expectError(await h.start(post(), ctx), 500, 'provider_error', 'internal');
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(log.error).toHaveBeenCalledWith('studio.publish_failed', {
      reason: 'internal',
      error: 'TypeError',
    });
  });

  it('an enqueue failure ends the run error (enqueue_failed) and is 503; never the error text', async () => {
    const { h, calls, log } = handlers({ enqueueFails: true });
    const body = await expectError(
      await h.start(post(), ctx),
      503,
      'provider_error',
      'unavailable',
    );
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(calls.at(-1)).toEqual({
      method: 'publish.finishRun',
      scope: SCOPE,
      input: {
        runId: 'run_1',
        status: 'error',
        summary: { groups: [], errorCode: 'enqueue_failed' },
      },
    });
    expect(log.error).toHaveBeenCalledWith('studio.publish_enqueue_failed', { error: 'Error' });
    expect(JSON.stringify(log.error.mock.calls)).not.toContain('secret');
  });

  it('an enqueue failure whose finishRun also fails is still 503 and logged', async () => {
    const { h, log } = handlers({
      enqueueFails: true,
      fail: { 'publish.finishRun': new RepositoryError('failed', 'x') },
    });
    await expectError(await h.start(post(), ctx), 503, 'provider_error', 'unavailable');
    expect(log.error).toHaveBeenCalledWith('studio.publish_finish_failed', {
      error: 'RepositoryError',
    });
  });

  it('a backend that cannot be built is 503, logged by reason code', async () => {
    const fallback = { error: vi.fn() };
    const err = Object.assign(new Error('x'), { reason: 'judge_model' });
    const h = createPublishHandlers(async () => Promise.reject(err), fallback);
    await expectError(await h.start(post(), ctx), 503, 'provider_error', 'unavailable');
    await expectError(await h.latest(get(), ctx), 503, 'provider_error', 'unavailable');
    expect(fallback.error).toHaveBeenCalledWith('studio.publish_unavailable', {
      reason: 'judge_model',
    });
    const h2 = createPublishHandlers(async () => Promise.reject(new RangeError('y')), fallback);
    await h2.start(post(), ctx);
    expect(fallback.error).toHaveBeenCalledWith('studio.publish_unavailable', {
      reason: 'RangeError',
    });
  });
});

describe('GET /api/studio/publish', () => {
  it('no run yet is {run: null}', async () => {
    const { h, calls } = handlers();
    const res = await h.latest(get(), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ run: null });
    expect(calls).toEqual([{ method: 'publish.latestRun', scope: SCOPE, input: undefined }]);
  });

  it('a running run has no failed cases and is not asked for them', async () => {
    const { h, calls } = handlers({ latest: run({ status: 'running' }) });
    const body = (await (await h.latest(get(), ctx)).json()) as { run: Record<string, unknown> };
    expect(body.run).toEqual({
      runId: 'run_1',
      status: 'running',
      changes: ['first_publish'],
      groups: [],
      errorCode: null,
      failedCases: [],
      scorecard: null,
      startedAt: '2026-10-22T10:00:00.000Z',
      finishedAt: null,
      publishedAt: null,
      changedSincePublish: false,
    });
    expect(calls.map((c) => c.method)).toEqual([
      'publish.latestRun',
      'publish.changedSinceLastPublish',
      'agents.get',
    ]);
  });

  it('carries the agent status (task 12.2f Phase D): live by default, suspended after a takedown', async () => {
    let r = handlers({ latest: run({ status: 'passed' }) });
    let body = (await (await r.h.latest(get(), ctx)).json()) as { agentStatus: unknown };
    expect(body.agentStatus).toBe('live');
    expect(r.calls).toContainEqual({ method: 'agents.get', scope: SCOPE, input: 'agt_1' });

    r = handlers({ latest: run({ status: 'passed' }), agent: { status: 'suspended' } });
    body = (await (await r.h.latest(get(), ctx)).json()) as { agentStatus: unknown };
    expect(body.agentStatus).toBe('suspended');
  });

  it('a changed-since-publish run round-trips the flag', async () => {
    const { h } = handlers({ latest: run({ status: 'passed' }), changed: true });
    const body = (await (await h.latest(get(), ctx)).json()) as { run: Record<string, unknown> };
    expect(body.run.changedSincePublish).toBe(true);
  });

  it('a failed run lists its failed cases (teacher-scoped) and groups with reasons', async () => {
    const groups = [
      {
        origin: 'platform',
        group: 'accuracy',
        total: 0,
        passed: 0,
        minPercent: 0,
        pass: false,
        reason: 'empty_group',
      },
    ] as const;
    const failed: FailedCase[] = [
      {
        caseId: 'acc-1',
        details: {
          origin: 'agent',
          group: 'accuracy',
          suite: 'accuracy',
          failedChecks: ['expected_answer'],
          question: 'What is 2+2?',
        },
      },
    ];
    const { h, calls } = handlers({
      latest: run({
        status: 'failed',
        finishedAt: '2026-10-22T10:05:00.000Z',
        summary: { groups: [...groups], costMicroUsd: 120 },
      }),
      failed,
    });
    const body = (await (await h.latest(get(), ctx)).json()) as { run: Record<string, unknown> };
    expect(body.run.groups).toEqual(groups);
    expect(body.run.failedCases).toEqual([
      {
        caseId: 'acc-1',
        origin: 'agent',
        group: 'accuracy',
        suite: 'accuracy',
        failedChecks: ['expected_answer'],
        question: 'What is 2+2?',
      },
    ]);
    expect(calls).toContainEqual({ method: 'publish.failedCases', scope: SCOPE, input: 'run_1' });
  });

  it('an error run carries its code; a passed run its scorecard and published time', async () => {
    let r = handlers({
      latest: run({ status: 'error', summary: { groups: [], errorCode: 'gate_unavailable' } }),
    });
    let body = (await (await r.h.latest(get(), ctx)).json()) as { run: Record<string, unknown> };
    expect(body.run.errorCode).toBe('gate_unavailable');
    const scorecard = {
      pass: true,
      changes: ['first_publish' as const],
      categories: [
        {
          key: 'accuracy' as const,
          measured: true,
          total: 10,
          passed: 9,
          percent: 90,
          pass: true,
          byOrigin: [],
        },
      ],
    };
    r = handlers({
      latest: run({
        status: 'passed',
        scorecard,
        publishedAt: '2026-10-22T10:06:00.000Z',
        finishedAt: '2026-10-22T10:05:59.000Z',
      }),
    });
    body = (await (await r.h.latest(get(), ctx)).json()) as { run: Record<string, unknown> };
    expect(body.run.scorecard).toEqual(scorecard);
    expect(body.run.publishedAt).toBe('2026-10-22T10:06:00.000Z');
    expect(r.calls.map((c) => c.method)).toEqual([
      'publish.latestRun',
      'publish.changedSinceLastPublish',
      'agents.get',
    ]);
  });

  it('a queued run past the stale deadline is status error, errorCode stale (never queued)', async () => {
    const { h } = handlers({
      latest: run({ status: 'queued' }),
      now: '2026-10-22T10:02:00.001Z', // one ms past the 2-minute stale deadline
    });
    const body = (await (await h.latest(get(), ctx)).json()) as { run: Record<string, unknown> };
    expect(body.run.status).toBe('error');
    expect(body.run.errorCode).toBe('stale');
  });

  it('a running run past the stale deadline is status error, errorCode stale (never running)', async () => {
    const { h } = handlers({
      latest: run({ status: 'running' }),
      now: '2026-10-22T10:02:00.001Z',
    });
    const body = (await (await h.latest(get(), ctx)).json()) as { run: Record<string, unknown> };
    expect(body.run.status).toBe('error');
    expect(body.run.errorCode).toBe('stale');
  });

  it('a fresh queued run (within the deadline) stays queued', async () => {
    const { h, calls } = handlers({
      latest: run({ status: 'queued' }),
      now: '2026-10-22T10:01:59.999Z', // one ms inside the deadline
    });
    const body = (await (await h.latest(get(), ctx)).json()) as { run: Record<string, unknown> };
    expect(body.run.status).toBe('queued');
    expect(body.run.errorCode).toBeNull();
    expect(calls.map((c) => c.method)).not.toContain('publish.failedCases');
  });

  it('repo errors map like POST: failed is 503, unknown is 500', async () => {
    let r = handlers({ fail: { 'publish.latestRun': new RepositoryError('failed', 'x') } });
    await expectError(await r.h.latest(get(), ctx), 503, 'provider_error', 'unavailable');
    r = handlers({ fail: { 'publish.latestRun': new Error('boom') } });
    await expectError(await r.h.latest(get(), ctx), 500, 'provider_error', 'internal');
    r = handlers({ fail: { 'publish.latestRun': new RepositoryError('scope', 'x') } });
    await expectError(await r.h.latest(get(), ctx), 403, 'forbidden', 'not_verified');
  });
});
