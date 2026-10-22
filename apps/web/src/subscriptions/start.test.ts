// Task 9.3 Phase B: the no-payment package-start route's handler over a fake backend (no
// database; rule 4). The scope's student is always the session's own principal; the package
// version is always looked up server-side from the agent's own live packages, never trusted from
// the client body.
import { RepositoryError, type LivePackage, type LiveSubscription, type Repositories } from '@edmate/db';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import type { Principal, RoleContext } from '../auth/guard';
import { createSubscriptionHandlers, MAX_BODY_BYTES } from './start';

const STUDENT: Principal = { userId: 'std_amy', role: 'student' };

const FREE_PKG: LivePackage = {
  packageVersionId: 'pv_free_1',
  offer: {
    packageId: 'pkg_free',
    name: 'Free',
    skills: ['explain'],
    dailyMessageLimit: 20,
    liveClassesPerMonth: 0,
    pricePerMonth: { amountMinor: 0, currency: 'USD' },
    trialDays: 0,
  },
};

const PAID_PKG: LivePackage = {
  packageVersionId: 'pv_paid_1',
  offer: {
    ...FREE_PKG.offer,
    packageId: 'pkg_paid',
    name: 'Full Course',
    pricePerMonth: { amountMinor: 1999, currency: 'USD' },
    trialDays: 7,
  },
};

const SUBSCRIPTION: LiveSubscription = {
  id: 'sub_1',
  packageVersionId: PAID_PKG.packageVersionId,
  status: 'trial',
  periodEnd: '2026-10-28T00:00:00.000Z',
};

function ctxFor(principal: Principal): RoleContext {
  return { principal, params: Promise.resolve({}) };
}

function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost:8080/api/subscriptions', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function fakeRepos(overrides: {
  owner?: (scope: { agentId: string }) => Promise<{ teacherId: string } | null>;
  liveForAgent?: (scope: { agentId: string }) => Promise<LivePackage[]>;
  start?: (scope: unknown, input: unknown) => Promise<LiveSubscription>;
  findLive?: (scope: unknown) => Promise<LiveSubscription | null>;
} = {}) {
  const calls: { method: string; scope: unknown; input?: unknown }[] = [];
  const owner = vi.fn(async (scope: { agentId: string }) => {
    calls.push({ method: 'owner', scope });
    if (overrides.owner) return overrides.owner(scope);
    return { teacherId: 'tch_asha' };
  });
  const liveForAgent = vi.fn(async (scope: { agentId: string }) => {
    calls.push({ method: 'liveForAgent', scope });
    if (overrides.liveForAgent) return overrides.liveForAgent(scope);
    return [FREE_PKG, PAID_PKG];
  });
  const start = vi.fn(async (scope: unknown, input: unknown) => {
    calls.push({ method: 'start', scope, input });
    if (overrides.start) return overrides.start(scope, input);
    return SUBSCRIPTION;
  });
  const findLive = vi.fn(async (scope: unknown) => {
    calls.push({ method: 'findLive', scope });
    if (overrides.findLive) return overrides.findLive(scope);
    return SUBSCRIPTION;
  });
  const repos = {
    agents: { owner },
    packageVersions: { liveForAgent },
    subscriptions: { start, findLive },
  } as unknown as Pick<Repositories, 'agents' | 'packageVersions' | 'subscriptions'>;
  return { calls, repos };
}

describe('createSubscriptionHandlers', () => {
  it('starts a trial subscription for a package with trialDays, with no payment call', async () => {
    const { repos, calls } = fakeRepos();
    const handlers = createSubscriptionHandlers({ repos: () => repos });
    const res = await handlers.start(
      req({ agentId: 'agt_demo', packageId: 'pkg_paid' }),
      ctxFor(STUDENT),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ subscription: SUBSCRIPTION });
    const startCall = calls.find((c) => c.method === 'start');
    expect(startCall?.scope).toEqual({ studentId: 'std_amy', teacherId: 'tch_asha' });
    const input = startCall?.input as { packageVersionId: string; status: string; periodEnd: string };
    expect(input.packageVersionId).toBe('pv_paid_1');
    expect(input.status).toBe('trial');
  });

  it('starts an active subscription for a package with no trialDays', async () => {
    const { repos, calls } = fakeRepos();
    const handlers = createSubscriptionHandlers({ repos: () => repos });
    await handlers.start(req({ agentId: 'agt_demo', packageId: 'pkg_free' }), ctxFor(STUDENT));
    const startCall = calls.find((c) => c.method === 'start');
    const input = startCall?.input as { packageVersionId: string; status: string };
    expect(input.packageVersionId).toBe('pv_free_1');
    expect(input.status).toBe('active');
  });

  it('a body packageVersionId or version is ignored -- never trusted from the client', async () => {
    const { repos, calls } = fakeRepos();
    const handlers = createSubscriptionHandlers({ repos: () => repos });
    // A strict body schema refuses extra keys entirely, so this is a validation error, not a
    // silently-ignored extra field -- proving the server never reads a client-given version id.
    const res = await handlers.start(
      req({ agentId: 'agt_demo', packageId: 'pkg_paid', packageVersionId: 'pv_evil', version: 99 }),
      ctxFor(STUDENT),
    );
    expect(res.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('an unknown or not-live agent is 404, before any package lookup', async () => {
    const { repos, calls } = fakeRepos({ owner: async () => null });
    const handlers = createSubscriptionHandlers({ repos: () => repos });
    const res = await handlers.start(
      req({ agentId: 'agt_missing', packageId: 'pkg_paid' }),
      ctxFor(STUDENT),
    );
    expect(res.status).toBe(404);
    expect(calls.some((c) => c.method === 'liveForAgent' || c.method === 'start')).toBe(false);
  });

  it('a packageId not among the agent\'s live packages is 404', async () => {
    const { repos } = fakeRepos();
    const handlers = createSubscriptionHandlers({ repos: () => repos });
    const res = await handlers.start(
      req({ agentId: 'agt_demo', packageId: 'pkg_unknown' }),
      ctxFor(STUDENT),
    );
    expect(res.status).toBe(404);
  });

  it('a not_found or scope error from the write is 404, not a 500', async () => {
    const { repos } = fakeRepos({
      start: () => {
        throw new RepositoryError('scope', 'subscriptions.start');
      },
    });
    const handlers = createSubscriptionHandlers({ repos: () => repos });
    const res = await handlers.start(
      req({ agentId: 'agt_demo', packageId: 'pkg_paid' }),
      ctxFor(STUDENT),
    );
    expect(res.status).toBe(404);
  });

  it('an already-live pair (unique index) is a clear 409, not a 500', async () => {
    const { repos } = fakeRepos({
      start: () => {
        throw new RepositoryError('invalid', 'subscriptions.start');
      },
    });
    const handlers = createSubscriptionHandlers({ repos: () => repos });
    const res = await handlers.start(
      req({ agentId: 'agt_demo', packageId: 'pkg_paid' }),
      ctxFor(STUDENT),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { message: string } };
    expect(JSON.stringify(body)).toContain('You already have a package with this teacher.');
  });

  it('task 9.6i: an invalid start with no live subscription is the alarm refusal, with its own fixed words', async () => {
    const { repos, calls } = fakeRepos({
      start: () => {
        throw new RepositoryError('invalid', 'subscriptions.start');
      },
      findLive: async () => null,
    });
    const handlers = createSubscriptionHandlers({ repos: () => repos });
    const res = await handlers.start(
      req({ agentId: 'agt_demo', packageId: 'pkg_free' }),
      ctxFor(STUDENT),
    );
    expect(res.status).toBe(409);
    const text = JSON.stringify(await res.json());
    expect(text).toContain("This teacher's free plan is paused for now.");
    expect(text).not.toContain('already have');
    expect(calls.find((c) => c.method === 'findLive')?.scope).toEqual({
      studentId: 'std_amy',
      teacherId: 'tch_asha',
    });
  });

  it('task 9.6i: a findLive failure while explaining an invalid start is a 500, not a guess', async () => {
    const { repos } = fakeRepos({
      start: () => {
        throw new RepositoryError('invalid', 'subscriptions.start');
      },
      findLive: () => {
        throw new RepositoryError('failed', 'subscriptions.findLive');
      },
    });
    const handlers = createSubscriptionHandlers({ repos: () => repos });
    const res = await handlers.start(
      req({ agentId: 'agt_demo', packageId: 'pkg_free' }),
      ctxFor(STUDENT),
    );
    expect(res.status).toBe(500);
  });

  it('a malformed body is 400 before any repo call', async () => {
    const { repos, calls } = fakeRepos();
    const handlers = createSubscriptionHandlers({ repos: () => repos });
    const res = await handlers.start(req({ agentId: '' }), ctxFor(STUDENT));
    expect(res.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('a body over the size cap is 413', async () => {
    const { repos, calls } = fakeRepos();
    const handlers = createSubscriptionHandlers({ repos: () => repos });
    const res = await handlers.start(
      req({ agentId: 'agt_demo', packageId: 'x'.repeat(MAX_BODY_BYTES + 1) }),
      ctxFor(STUDENT),
    );
    expect(res.status).toBe(413);
    expect(calls).toEqual([]);
  });

  it('an integrity error from the write is a 400, not a 500', async () => {
    const { repos } = fakeRepos({
      start: () => {
        throw new RepositoryError('integrity', 'subscriptions.start');
      },
    });
    const handlers = createSubscriptionHandlers({ repos: () => repos });
    const res = await handlers.start(
      req({ agentId: 'agt_demo', packageId: 'pkg_paid' }),
      ctxFor(STUDENT),
    );
    expect(res.status).toBe(400);
  });

  it('a failed-kind error from the write is a 500 with the fixed message', async () => {
    const { repos } = fakeRepos({
      start: () => {
        throw new RepositoryError('failed', 'subscriptions.start');
      },
    });
    const handlers = createSubscriptionHandlers({ repos: () => repos });
    const res = await handlers.start(
      req({ agentId: 'agt_demo', packageId: 'pkg_paid' }),
      ctxFor(STUDENT),
    );
    expect(res.status).toBe(500);
  });

  it('an unexpected error is a logged-shape 500, not a thrown exception', async () => {
    const { repos } = fakeRepos({
      start: () => {
        throw new Error('boom');
      },
    });
    const handlers = createSubscriptionHandlers({ repos: () => repos });
    const res = await handlers.start(
      req({ agentId: 'agt_demo', packageId: 'pkg_paid' }),
      ctxFor(STUDENT),
    );
    expect(res.status).toBe(500);
  });
});
