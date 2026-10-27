// Task 13.4b: `buildAccountExport` aggregates every live subscription pair for the signed-in
// student plus their own identity fields. No real database (rule 4): a fake backend.
import type { StudentScope } from '@edmate/db';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import {
  buildAccountExport,
  createAccountExportHandler,
  type AccountExportBackend,
  type SubscriptionPair,
} from './accountExport';

const STUDENT = 'std_amy';
const PAIRS: SubscriptionPair[] = [
  { agentId: 'agt_1', teacherId: 'tch_asha', status: 'active' },
  { agentId: 'agt_2', teacherId: 'tch_bea', status: 'trial' },
];

function fakeBackend(
  options: {
    pairs?: SubscriptionPair[];
    truncateFor?: string;
    name?: string;
    email?: string | null;
    user?: null;
  } = {},
): AccountExportBackend {
  const pairs = options.pairs ?? PAIRS;
  return {
    agents: { owner: async () => null },
    sessions: { listForStudent: async () => ({ items: [], next: null }) },
    messages: { listForStudent: async () => ({ items: [], next: null }) },
    learnerProfiles: { get: async () => null },
    evidenceEvents: {
      list: async (scope: StudentScope) => ({
        events: [],
        truncated: options.truncateFor !== undefined && scope.teacherId === options.truncateFor,
      }),
    },
    teacherQuestions: { listForStudent: async () => [] },
    subscriptions: { findLive: async () => null },
    packageVersions: { getById: async () => null },
    outline: { getOutline: async () => null },
    subscriptionPairs: { listLiveForStudent: async () => pairs },
    identity: {
      getUser: async () =>
        options.user === null
          ? null
          : {
              id: STUDENT,
              role: 'student',
              email: options.email ?? 'amy@example.test',
              emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
              name: options.name ?? 'Amy',
            },
    },
  };
}

describe('buildAccountExport', () => {
  it("includes one teacher entry per live pair, with that pair's export", async () => {
    const backend = fakeBackend();
    const json = await buildAccountExport(backend, STUDENT, '2026-10-26T00:00:00.000Z');
    expect(
      json.teachers.map((t) => ({ teacherId: t.teacherId, agentId: t.agentId, status: t.status })),
    ).toEqual([
      { teacherId: 'tch_asha', agentId: 'agt_1', status: 'active' },
      { teacherId: 'tch_bea', agentId: 'agt_2', status: 'trial' },
    ]);
    for (const t of json.teachers) {
      expect(t.export.format).toBe('edmate-export');
      expect(t.export.agentId).toBe(t.agentId);
    }
  });

  it("carries the student's own account fields, minus internal ids", async () => {
    const backend = fakeBackend({ name: 'Amy R', email: 'amy@example.test' });
    const json = await buildAccountExport(backend, STUDENT, '2026-10-26T00:00:00.000Z');
    expect(json.account).toEqual({
      name: 'Amy R',
      email: 'amy@example.test',
      emailVerifiedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(JSON.stringify(json.account)).not.toContain(STUDENT);
  });

  it('a missing user row is account: null', async () => {
    const backend = fakeBackend({ user: null });
    const json = await buildAccountExport(backend, STUDENT, '2026-10-26T00:00:00.000Z');
    expect(json.account).toBeNull();
  });

  it('no pairs is an empty teachers list and complete:true', async () => {
    const backend = fakeBackend({ pairs: [] });
    const json = await buildAccountExport(backend, STUDENT, '2026-10-26T00:00:00.000Z');
    expect(json.teachers).toEqual([]);
    expect(json.complete).toBe(true);
    expect(json.truncated).toEqual([]);
  });

  it('a truncated section on one pair sets complete:false and names the teacher and section', async () => {
    const backend = fakeBackend({ truncateFor: 'tch_asha' });
    const json = await buildAccountExport(backend, STUDENT, '2026-10-26T00:00:00.000Z');
    expect(json.complete).toBe(false);
    expect(json.truncated).toEqual(['tch_asha:evidence']);
  });

  it('never reads or serialises help_state, helpState, mustNotReveal or answerKey', async () => {
    const backend = fakeBackend();
    const json = await buildAccountExport(backend, STUDENT, '2026-10-26T00:00:00.000Z');
    const text = JSON.stringify(json);
    expect(text).not.toMatch(/help_state|helpState|mustNotReveal|answerKey/);
  });

  it('calls listLiveForStudent and getUser with the given studentId only', async () => {
    const calls: string[] = [];
    const backend: AccountExportBackend = {
      ...fakeBackend({ pairs: [] }),
      subscriptionPairs: {
        listLiveForStudent: async (id: string) => {
          calls.push(`listLiveForStudent:${id}`);
          return [];
        },
      },
      identity: {
        getUser: async (id: string) => {
          calls.push(`getUser:${id}`);
          return null;
        },
      },
    };
    await buildAccountExport(backend, STUDENT, '2026-10-26T00:00:00.000Z');
    expect(calls.sort()).toEqual([`getUser:${STUDENT}`, `listLiveForStudent:${STUDENT}`]);
  });
});

describe('createAccountExportHandler', () => {
  const ctx = (userId = STUDENT) => ({
    principal: { userId, role: 'student' as const },
    params: Promise.resolve({}),
  });
  const req = () => new NextRequest('http://localhost:8080/api/me/export', { method: 'GET' });

  it('returns 200 application/json with an attachment disposition and no-store', async () => {
    const handler = createAccountExportHandler(fakeBackend());
    const res = await handler(req(), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(res.headers.get('content-disposition')).toBe(
      'attachment; filename="edmate-account-export.json"',
    );
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    const body = (await res.json()) as { format: string };
    expect(body.format).toBe('edmate-account-export');
  });

  it("uses the signed-in principal's own id, not any request-supplied id", async () => {
    const seen: string[] = [];
    const backend: AccountExportBackend = {
      ...fakeBackend({ pairs: [] }),
      subscriptionPairs: {
        listLiveForStudent: async (id: string) => {
          seen.push(id);
          return [];
        },
      },
    };
    const handler = createAccountExportHandler(backend);
    await handler(req(), ctx('std_amy'));
    expect(seen).toEqual(['std_amy']);
  });

  it('a repository failure gives 500 with only the error name logged, never a raw message', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const backend: AccountExportBackend = {
      ...fakeBackend(),
      subscriptionPairs: {
        listLiveForStudent: async () => {
          throw new Error('pg says something');
        },
      },
    };
    const handler = createAccountExportHandler(backend);
    const res = await handler(req(), ctx());
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toMatch(/pg says something/);
    expect(spy.mock.calls.flat().join(' ')).toContain('Error');
    expect(spy.mock.calls.flat().join(' ')).not.toMatch(/pg says something/);
    spy.mockRestore();
  });
});
