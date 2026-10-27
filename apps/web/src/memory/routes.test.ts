// Task 6.5 Phase B: the memory export and reset handlers over a fake backend (no database; rule
// 4). The scope always comes from the signed-in student's principal and the live agent's owner,
// never from the request body.
import type { EvidenceEvent, LearnerProfile } from '@edmate/contracts';
import { EVIDENCE_LIST_MAX, RepositoryError } from '@edmate/db';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Principal, RoleContext } from '../auth/guard';
import { createMemoryHandlers, memoryHandlers, type MemoryBackend } from './routes';

const shared = vi.hoisted(() => ({
  owner: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  reset: vi.fn(),
}));
vi.mock('../auth', () => ({
  serverDatabase: () => ({
    repos: {
      agents: { owner: shared.owner },
      learnerProfiles: { get: shared.get, reset: shared.reset },
      evidenceEvents: { list: shared.list },
    },
  }),
}));

const STUDENT: Principal = { userId: 'std_amy', role: 'student' };

const PROFILE: LearnerProfile = {
  studentId: 'std_amy',
  teacherId: 'tch_asha',
  lang: 'en',
  mastery: { top_1: { p: 0.8, n: 4, updatedAt: '2026-10-01T00:00:00.000Z' } },
  mistakes: [{ tag: 'sign_error', count: 2, lastSeen: '2026-10-01T00:00:00.000Z' }],
  lastSummary: 'Worked on fractions.',
};

const EVIDENCE: EvidenceEvent[] = [
  {
    studentId: 'std_amy',
    teacherId: 'tch_asha',
    topicId: 'top_1',
    correct: true,
    source: 'check',
    weight: 1,
    ts: '2026-10-01T00:00:00.000Z',
  },
];

function ctxFor(principal: Principal, agentId: string | undefined): RoleContext {
  return { principal, params: Promise.resolve(agentId === undefined ? {} : { agentId }) };
}

function req(method: string, agentId: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost:8080/api/me/memory/${agentId}`, {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  });
}

function fakeBackend(
  overrides: {
    owner?: (scope: { agentId: string }) => Promise<{ teacherId: string } | null>;
    get?: (scope: unknown) => Promise<LearnerProfile | null>;
    list?: (
      scope: unknown,
      options: unknown,
    ) => Promise<{ events: EvidenceEvent[]; truncated: boolean }>;
    reset?: (scope: unknown) => Promise<{ reset: boolean }>;
  } = {},
) {
  const calls: { method: string; scope?: unknown; options?: unknown }[] = [];
  const owner = vi.fn(async (scope: { agentId: string }) => {
    calls.push({ method: 'owner' });
    if (overrides.owner) return overrides.owner(scope);
    return { teacherId: 'tch_asha' };
  });
  const get = vi.fn(async (scope: unknown) => {
    calls.push({ method: 'get', scope });
    if (overrides.get) return overrides.get(scope);
    return PROFILE;
  });
  const list = vi.fn(async (scope: unknown, options: unknown) => {
    calls.push({ method: 'list', scope, options });
    if (overrides.list) return overrides.list(scope, options);
    return { events: EVIDENCE, truncated: false };
  });
  const reset = vi.fn(async (scope: unknown) => {
    calls.push({ method: 'reset', scope });
    if (overrides.reset) return overrides.reset(scope);
    return { reset: true };
  });
  const backend: MemoryBackend = {
    agents: { owner },
    learnerProfiles: { get, reset },
    evidenceEvents: { list },
  };
  return { backend, calls, owner, get, list, reset };
}

describe('GET /api/me/memory/:agentId (export)', () => {
  it('returns the profile, evidence and truncation shape with attachment headers and no-store', async () => {
    const { backend } = fakeBackend();
    const { export: exportMemory } = createMemoryHandlers(backend);
    const res = await exportMemory(req('GET', 'agt_1'), ctxFor(STUDENT, 'agt_1'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-disposition')).toBe(
      'attachment; filename="edmate-memory.json"',
    );
    expect(await res.json()).toEqual({ profile: PROFILE, evidence: EVIDENCE, truncated: false });
  });

  it('a missing profile is { profile: null, evidence: [], truncated: false } with 200', async () => {
    const { backend } = fakeBackend({
      get: async () => null,
      list: async () => ({ events: [], truncated: false }),
    });
    const { export: exportMemory } = createMemoryHandlers(backend);
    const res = await exportMemory(req('GET', 'agt_1'), ctxFor(STUDENT, 'agt_1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ profile: null, evidence: [], truncated: false });
  });

  it('reports truncation from evidenceEvents.list', async () => {
    const { backend } = fakeBackend({ list: async () => ({ events: EVIDENCE, truncated: true }) });
    const { export: exportMemory } = createMemoryHandlers(backend);
    const res = await exportMemory(req('GET', 'agt_1'), ctxFor(STUDENT, 'agt_1'));
    expect((await res.json()).truncated).toBe(true);
  });

  it('a non-live or malformed agent gives 404 and calls no repository', async () => {
    const { backend, get, list } = fakeBackend({ owner: async () => null });
    const { export: exportMemory } = createMemoryHandlers(backend);
    const res = await exportMemory(req('GET', 'agt_1'), ctxFor(STUDENT, 'agt_1'));
    expect(res.status).toBe(404);
    expect(get).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });

  it('a malformed agentId path param gives 404', async () => {
    const { backend } = fakeBackend();
    const { export: exportMemory } = createMemoryHandlers(backend);
    const res = await exportMemory(req('GET', 'x'), ctxFor(STUDENT, ''));
    expect(res.status).toBe(404);
  });

  it('a RepositoryError gives a fixed response, never the raw message', async () => {
    const { backend } = fakeBackend({
      get: async () => {
        throw new RepositoryError('failed', 'learnerProfiles.get');
      },
    });
    const { export: exportMemory } = createMemoryHandlers(backend);
    const res = await exportMemory(req('GET', 'agt_1'), ctxFor(STUDENT, 'agt_1'));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).not.toMatch(/learnerProfiles\.get/);
  });

  it('a scope RepositoryError gives 404', async () => {
    const { backend } = fakeBackend({
      list: async () => {
        throw new RepositoryError('scope', 'evidenceEvents.list');
      },
    });
    const { export: exportMemory } = createMemoryHandlers(backend);
    const res = await exportMemory(req('GET', 'agt_1'), ctxFor(STUDENT, 'agt_1'));
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/me/memory/:agentId (reset)', () => {
  it('calls reset with the signed-in student scope, even when the body names another student', async () => {
    const { backend, reset } = fakeBackend();
    const { reset: resetHandler } = createMemoryHandlers(backend);
    const res = await resetHandler(
      req('DELETE', 'agt_1', { studentId: 'std_someone_else', teacherId: 'tch_other' }),
      ctxFor(STUDENT, 'agt_1'),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reset: true });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(reset).toHaveBeenCalledWith({ studentId: 'std_amy', teacherId: 'tch_asha' });
  });

  it('a non-live or malformed agent gives 404 and never calls reset', async () => {
    const { backend, reset } = fakeBackend({ owner: async () => null });
    const { reset: resetHandler } = createMemoryHandlers(backend);
    const res = await resetHandler(req('DELETE', 'agt_1'), ctxFor(STUDENT, 'agt_1'));
    expect(res.status).toBe(404);
    expect(reset).not.toHaveBeenCalled();
  });

  it('a RepositoryError gives a fixed response', async () => {
    const { backend } = fakeBackend({
      reset: async () => {
        throw new RepositoryError('failed', 'learnerProfiles.reset');
      },
    });
    const { reset: resetHandler } = createMemoryHandlers(backend);
    const res = await resetHandler(req('DELETE', 'agt_1'), ctxFor(STUDENT, 'agt_1'));
    expect(res.status).toBe(500);
  });
});

describe('memoryHandlers (the wired export, over a mocked serverDatabase)', () => {
  beforeEach(() => {
    shared.owner.mockReset();
    shared.get.mockReset();
    shared.list.mockReset();
    shared.reset.mockReset();
  });

  it('export resolves the scope through serverDatabase().repos and returns the shape', async () => {
    shared.owner.mockResolvedValueOnce({ teacherId: 'tch_asha' });
    shared.get.mockResolvedValueOnce(PROFILE);
    shared.list.mockResolvedValueOnce({ events: EVIDENCE, truncated: false });
    const res = await memoryHandlers.export(req('GET', 'agt_1'), ctxFor(STUDENT, 'agt_1'));
    expect(res.status).toBe(200);
    expect(shared.owner).toHaveBeenCalledWith({ agentId: 'agt_1' });
    expect(shared.get).toHaveBeenCalledWith({ studentId: 'std_amy', teacherId: 'tch_asha' });
    expect(shared.list).toHaveBeenCalledWith(
      { studentId: 'std_amy', teacherId: 'tch_asha' },
      { limit: EVIDENCE_LIST_MAX },
    );
    expect(await res.json()).toEqual({ profile: PROFILE, evidence: EVIDENCE, truncated: false });
  });

  it('reset resolves the scope through serverDatabase().repos and returns the shape', async () => {
    shared.owner.mockResolvedValueOnce({ teacherId: 'tch_asha' });
    shared.reset.mockResolvedValueOnce({ reset: true });
    const res = await memoryHandlers.reset(req('DELETE', 'agt_1'), ctxFor(STUDENT, 'agt_1'));
    expect(res.status).toBe(200);
    expect(shared.owner).toHaveBeenCalledWith({ agentId: 'agt_1' });
    expect(shared.reset).toHaveBeenCalledWith({ studentId: 'std_amy', teacherId: 'tch_asha' });
    expect(await res.json()).toEqual({ reset: true });
  });
});
