// Task 9.6 Phase D: `createPlanHandlers(backend).patch` over a fake backend (no database; rule
// 4). The scope is always the session's own principal plus the live agent's teacher; the URL's
// `[id]` must match the scope's own live subscription, and `packageId` is always mapped to a
// real `packageVersionId` server-side.
import type { PackageConfig } from '@edmate/contracts';
import { RepositoryError, type LivePackage, type LiveSubscription } from '@edmate/db';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import type { Principal, RoleContext } from '../auth/guard';
import { createPlanHandlers, MAX_BODY_BYTES, type PlanBackend } from './change';

const STUDENT: Principal = { userId: 'std_amy', role: 'student' };

const PAID_PKG: LivePackage = {
  packageVersionId: 'pv_paid_1',
  offer: {
    packageId: 'pkg_paid',
    name: 'Full Course',
    skills: ['explain'],
    dailyMessageLimit: 50,
    liveClassesPerMonth: 1,
    pricePerMonth: { amountMinor: 1999, currency: 'USD' },
    trialDays: 0,
  },
};

const FREE_PKG: LivePackage = {
  packageVersionId: 'pv_free_1',
  offer: {
    ...PAID_PKG.offer,
    packageId: 'pkg_free',
    pricePerMonth: { amountMinor: 0, currency: 'USD' },
  },
};

const SUBSCRIPTION: LiveSubscription = {
  id: 'sub_1',
  packageVersionId: PAID_PKG.packageVersionId,
  status: 'active',
  periodEnd: '2026-11-21T00:00:00.000Z',
};

const PAID_CONFIG = { id: 'pkg_paid' } as unknown as PackageConfig;
const FREE_CONFIG = { id: 'pkg_free' } as unknown as PackageConfig;

function ctxFor(principal: Principal, id: string): RoleContext {
  return { principal, params: Promise.resolve({ id }) };
}

function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost:8080/api/subscriptions/sub_1', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

interface Overrides {
  owner?: (scope: { agentId: string }) => Promise<{ teacherId: string } | null>;
  liveForAgent?: (scope: { agentId: string }) => Promise<LivePackage[]>;
  getById?: (scope: unknown, id: string) => Promise<PackageConfig | null>;
  findLive?: (scope: unknown) => Promise<LiveSubscription | null>;
  changePackage?: (scope: unknown, input: unknown) => Promise<LiveSubscription>;
  pause?: (scope: unknown, input: unknown) => Promise<LiveSubscription>;
  resume?: (scope: unknown, input: unknown) => Promise<LiveSubscription>;
  cancel?: (scope: unknown, input: unknown) => Promise<LiveSubscription>;
}

function fakeBackend(overrides: Overrides = {}) {
  const calls: { method: string; scope?: unknown; input?: unknown }[] = [];
  const backend: PlanBackend = {
    agents: {
      owner: async (scope) => {
        calls.push({ method: 'owner', scope });
        if (overrides.owner) return overrides.owner(scope);
        return { teacherId: 'tch_asha' };
      },
    },
    packageVersions: {
      liveForAgent: async (scope) => {
        calls.push({ method: 'liveForAgent', scope });
        if (overrides.liveForAgent) return overrides.liveForAgent(scope);
        return [FREE_PKG, PAID_PKG];
      },
      getById: async (scope, id) => {
        calls.push({ method: 'getById', scope, input: id });
        if (overrides.getById) return overrides.getById(scope, id);
        if (id === FREE_PKG.packageVersionId) return FREE_CONFIG;
        return PAID_CONFIG;
      },
    },
    subscriptions: {
      findLive: async (scope) => {
        calls.push({ method: 'findLive', scope });
        if (overrides.findLive) return overrides.findLive(scope);
        return SUBSCRIPTION;
      },
      changePackage: async (scope, input) => {
        calls.push({ method: 'changePackage', scope, input });
        if (overrides.changePackage) return overrides.changePackage(scope, input);
        return { ...SUBSCRIPTION, packageVersionId: FREE_PKG.packageVersionId };
      },
      pause: async (scope, input) => {
        calls.push({ method: 'pause', scope, input });
        if (overrides.pause) return overrides.pause(scope, input);
        return { ...SUBSCRIPTION, status: 'paused' };
      },
      resume: async (scope, input) => {
        calls.push({ method: 'resume', scope, input });
        if (overrides.resume) return overrides.resume(scope, input);
        return { ...SUBSCRIPTION, status: 'active' };
      },
      cancel: async (scope, input) => {
        calls.push({ method: 'cancel', scope, input });
        if (overrides.cancel) return overrides.cancel(scope, input);
        return { ...SUBSCRIPTION, status: 'ended' };
      },
    },
  };
  return { backend, calls };
}

describe('createPlanHandlers.patch', () => {
  it('downgrades: maps packageId to packageVersionId server-side and returns status + packageId', async () => {
    const { backend, calls } = fakeBackend();
    const { patch } = createPlanHandlers(backend);
    const res = await patch(
      req({ agentId: 'agt_demo', action: 'change', packageId: 'pkg_free' }),
      ctxFor(STUDENT, 'sub_1'),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'active', packageId: 'pkg_free' });
    const change = calls.find((c) => c.method === 'changePackage');
    expect(change?.scope).toEqual({ studentId: 'std_amy', teacherId: 'tch_asha' });
    expect(change?.input).toEqual({ subscriptionId: 'sub_1', packageVersionId: 'pv_free_1' });
  });

  it('pauses the live subscription, calling only the subscription repo methods', async () => {
    const { backend, calls } = fakeBackend();
    const { patch } = createPlanHandlers(backend);
    const res = await patch(req({ agentId: 'agt_demo', action: 'pause' }), ctxFor(STUDENT, 'sub_1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'paused', packageId: 'pkg_paid' });
    expect(calls.some((c) => c.method === 'pause')).toBe(true);
    expect(calls.some((c) => c.method === 'changePackage')).toBe(false);
  });

  it('resumes a paused subscription', async () => {
    const { backend } = fakeBackend({ findLive: async () => ({ ...SUBSCRIPTION, status: 'paused' }) });
    const { patch } = createPlanHandlers(backend);
    const res = await patch(req({ agentId: 'agt_demo', action: 'resume' }), ctxFor(STUDENT, 'sub_1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'active', packageId: 'pkg_paid' });
  });

  it('cancels a live subscription', async () => {
    const { backend } = fakeBackend();
    const { patch } = createPlanHandlers(backend);
    const res = await patch(req({ agentId: 'agt_demo', action: 'cancel' }), ctxFor(STUDENT, 'sub_1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ended', packageId: 'pkg_paid' });
  });

  it('rejects a client-given packageVersionId, status or studentId (strict body)', async () => {
    const { backend, calls } = fakeBackend();
    const { patch } = createPlanHandlers(backend);
    const res = await patch(
      req({ agentId: 'agt_demo', action: 'pause', packageVersionId: 'pv_evil' }),
      ctxFor(STUDENT, 'sub_1'),
    );
    expect(res.status).toBe(400);
    expect(calls).toEqual([]);

    const res2 = await patch(
      req({ agentId: 'agt_demo', action: 'change', packageId: 'pkg_free', status: 'active' }),
      ctxFor(STUDENT, 'sub_1'),
    );
    expect(res2.status).toBe(400);

    const res3 = await patch(
      req({ agentId: 'agt_demo', action: 'cancel', studentId: 'std_evil' }),
      ctxFor(STUDENT, 'sub_1'),
    );
    expect(res3.status).toBe(400);
  });

  it('a malformed body is 400 before any repo call', async () => {
    const { backend, calls } = fakeBackend();
    const { patch } = createPlanHandlers(backend);
    const res = await patch(req({ agentId: 'agt_demo', action: 'nope' }), ctxFor(STUDENT, 'sub_1'));
    expect(res.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('a body over the size cap is 413', async () => {
    const { backend, calls } = fakeBackend();
    const { patch } = createPlanHandlers(backend);
    const res = await patch(
      req({ agentId: 'agt_demo', action: 'change', packageId: 'x'.repeat(MAX_BODY_BYTES + 1) }),
      ctxFor(STUDENT, 'sub_1'),
    );
    expect(res.status).toBe(413);
    expect(calls).toEqual([]);
  });

  it('an unknown or not-live agent is 404, before any subscription lookup', async () => {
    const { backend, calls } = fakeBackend({ owner: async () => null });
    const { patch } = createPlanHandlers(backend);
    const res = await patch(req({ agentId: 'agt_missing', action: 'pause' }), ctxFor(STUDENT, 'sub_1'));
    expect(res.status).toBe(404);
    expect(calls.some((c) => c.method === 'findLive')).toBe(false);
  });

  it('no live subscription for the pair is 404', async () => {
    const { backend } = fakeBackend({ findLive: async () => null });
    const { patch } = createPlanHandlers(backend);
    const res = await patch(req({ agentId: 'agt_demo', action: 'pause' }), ctxFor(STUDENT, 'sub_1'));
    expect(res.status).toBe(404);
  });

  it('the URL id not matching the scope\'s own live subscription is 404', async () => {
    const { backend } = fakeBackend();
    const { patch } = createPlanHandlers(backend);
    const res = await patch(req({ agentId: 'agt_demo', action: 'pause' }), ctxFor(STUDENT, 'sub_other'));
    expect(res.status).toBe(404);
  });

  it('an unknown packageId on change is 404, never reaching changePackage', async () => {
    const { backend, calls } = fakeBackend();
    const { patch } = createPlanHandlers(backend);
    const res = await patch(
      req({ agentId: 'agt_demo', action: 'change', packageId: 'pkg_unknown' }),
      ctxFor(STUDENT, 'sub_1'),
    );
    expect(res.status).toBe(404);
    expect(calls.some((c) => c.method === 'changePackage')).toBe(false);
  });

  it('a not_found or scope error from the write is 404, not a 500', async () => {
    const { backend } = fakeBackend({
      pause: () => {
        throw new RepositoryError('scope', 'subscriptions.pause');
      },
    });
    const { patch } = createPlanHandlers(backend);
    const res = await patch(req({ agentId: 'agt_demo', action: 'pause' }), ctxFor(STUDENT, 'sub_1'));
    expect(res.status).toBe(404);
  });

  it('an invalid-kind error from the write is a fixed 409 per action', async () => {
    const { backend } = fakeBackend({
      cancel: () => {
        throw new RepositoryError('invalid', 'subscriptions.cancel');
      },
    });
    const { patch } = createPlanHandlers(backend);
    const res = await patch(req({ agentId: 'agt_demo', action: 'cancel' }), ctxFor(STUDENT, 'sub_1'));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe("This plan can't be cancelled right now.");
  });

  it('a resume refused because the pause was not the student\'s own is a fixed 409', async () => {
    const { backend } = fakeBackend({
      findLive: async () => ({ ...SUBSCRIPTION, status: 'paused' }),
      resume: () => {
        throw new RepositoryError('invalid', 'subscriptions.resume');
      },
    });
    const { patch } = createPlanHandlers(backend);
    const res = await patch(req({ agentId: 'agt_demo', action: 'resume' }), ctxFor(STUDENT, 'sub_1'));
    expect(res.status).toBe(409);
  });

  it('an integrity error from the write is a 400, not a 500', async () => {
    const { backend } = fakeBackend({
      pause: () => {
        throw new RepositoryError('integrity', 'subscriptions.pause');
      },
    });
    const { patch } = createPlanHandlers(backend);
    const res = await patch(req({ agentId: 'agt_demo', action: 'pause' }), ctxFor(STUDENT, 'sub_1'));
    expect(res.status).toBe(400);
  });

  it('a failed-kind error from the write is a 500', async () => {
    const { backend } = fakeBackend({
      pause: () => {
        throw new RepositoryError('failed', 'subscriptions.pause');
      },
    });
    const { patch } = createPlanHandlers(backend);
    const res = await patch(req({ agentId: 'agt_demo', action: 'pause' }), ctxFor(STUDENT, 'sub_1'));
    expect(res.status).toBe(500);
  });

  it('an unexpected error is a logged-shape 500, not a thrown exception', async () => {
    const { backend } = fakeBackend({
      pause: () => {
        throw new Error('boom');
      },
    });
    const { patch } = createPlanHandlers(backend);
    const res = await patch(req({ agentId: 'agt_demo', action: 'pause' }), ctxFor(STUDENT, 'sub_1'));
    expect(res.status).toBe(500);
  });

  it('a getById miss after a successful write fails closed (never an empty packageId)', async () => {
    const { backend } = fakeBackend({ getById: async () => null });
    const { patch } = createPlanHandlers(backend);
    const res = await patch(req({ agentId: 'agt_demo', action: 'pause' }), ctxFor(STUDENT, 'sub_1'));
    expect(res.status).toBe(400);
    expect(await res.json()).not.toMatchObject({ packageId: '' });
  });
});
