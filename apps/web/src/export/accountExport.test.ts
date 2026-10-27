// Task 13.4b/13.4d: `buildAccountExport` aggregates every subscription pair the student has ever
// had (live or ended, task 13.4d) plus the student's own identity fields and consent history
// (13.4d). No real database (rule 4): a fake backend.
import type { ConsentRow, StudentScope } from '@edmate/db';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import {
  buildAccountExport,
  createAccountExportHandler,
  TEACHER_PAIRS_MAX,
  type AccountExportBackend,
  type SubscriptionPair,
} from './accountExport';

const STUDENT = 'std_amy';
const PAIRS: SubscriptionPair[] = [
  {
    agentId: 'agt_1',
    teacherId: 'tch_asha',
    status: 'active',
    periodEnd: '2026-12-01T00:00:00.000Z',
  },
  {
    agentId: 'agt_2',
    teacherId: 'tch_bea',
    status: 'trial',
    periodEnd: '2026-12-01T00:00:00.000Z',
  },
];
const CONSENTS: ConsentRow[] = [
  {
    kind: 'privacy_notice',
    version: 'v1',
    grantedBy: 'self',
    ts: '2026-01-01T00:00:00.000Z',
    withdrawnAt: null,
  },
  {
    kind: 'parental',
    version: 'v1',
    grantedBy: 'parent',
    ts: '2026-02-01T00:00:00.000Z',
    withdrawnAt: '2026-03-01T00:00:00.000Z',
  },
];

function fakeBackend(
  options: {
    pairs?: SubscriptionPair[];
    consents?: ConsentRow[];
    truncateFor?: string;
    name?: string;
    email?: string | null;
    user?: null;
  } = {},
): AccountExportBackend {
  const pairs = options.pairs ?? PAIRS;
  const consents = options.consents ?? CONSENTS;
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
    subscriptionPairs: { listAllForStudent: async () => pairs },
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
      listConsentsForStudent: async () => consents,
    },
  };
}

describe('buildAccountExport', () => {
  it("includes one teacher entry per pair, with that pair's export", async () => {
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

  it('a pair whose status is ended still produces a teachers entry', async () => {
    const ended: SubscriptionPair[] = [
      {
        agentId: 'agt_3',
        teacherId: 'tch_cat',
        status: 'ended',
        periodEnd: '2026-06-01T00:00:00.000Z',
      },
    ];
    const backend = fakeBackend({ pairs: ended });
    const json = await buildAccountExport(backend, STUDENT, '2026-10-26T00:00:00.000Z');
    expect(json.teachers).toEqual([
      expect.objectContaining({ teacherId: 'tch_cat', agentId: 'agt_3', status: 'ended' }),
    ]);
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

  it("json.consents carries the backend's consent rows unchanged", async () => {
    const backend = fakeBackend();
    const json = await buildAccountExport(backend, STUDENT, '2026-10-26T00:00:00.000Z');
    expect(json.consents).toEqual(CONSENTS);
  });

  it('no consents is an empty list', async () => {
    const backend = fakeBackend({ consents: [] });
    const json = await buildAccountExport(backend, STUDENT, '2026-10-26T00:00:00.000Z');
    expect(json.consents).toEqual([]);
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

  it('two subscriptions to the same teacher/agent give one teachers entry, the later periodEnd', async () => {
    const pairs: SubscriptionPair[] = [
      {
        agentId: 'agt_1',
        teacherId: 'tch_asha',
        status: 'ended',
        periodEnd: '2026-01-01T00:00:00.000Z',
      },
      {
        agentId: 'agt_1',
        teacherId: 'tch_asha',
        status: 'active',
        periodEnd: '2026-12-01T00:00:00.000Z',
      },
    ];
    const backend = fakeBackend({ pairs });
    const json = await buildAccountExport(backend, STUDENT, '2026-10-26T00:00:00.000Z');
    expect(json.teachers).toHaveLength(1);
    expect(json.teachers[0]).toEqual(
      expect.objectContaining({ teacherId: 'tch_asha', agentId: 'agt_1', status: 'active' }),
    );
  });

  it('on an exact periodEnd tie, keeps the non-ended row (ended listed first)', async () => {
    const pairs: SubscriptionPair[] = [
      {
        agentId: 'agt_1',
        teacherId: 'tch_asha',
        status: 'ended',
        periodEnd: '2026-12-01T00:00:00.000Z',
      },
      {
        agentId: 'agt_1',
        teacherId: 'tch_asha',
        status: 'active',
        periodEnd: '2026-12-01T00:00:00.000Z',
      },
    ];
    const backend = fakeBackend({ pairs });
    const json = await buildAccountExport(backend, STUDENT, '2026-10-26T00:00:00.000Z');
    expect(json.teachers).toHaveLength(1);
    expect(json.teachers[0]).toEqual(
      expect.objectContaining({ teacherId: 'tch_asha', agentId: 'agt_1', status: 'active' }),
    );
  });

  it('on an exact periodEnd tie, keeps the non-ended row (active listed first)', async () => {
    const pairs: SubscriptionPair[] = [
      {
        agentId: 'agt_1',
        teacherId: 'tch_asha',
        status: 'active',
        periodEnd: '2026-12-01T00:00:00.000Z',
      },
      {
        agentId: 'agt_1',
        teacherId: 'tch_asha',
        status: 'ended',
        periodEnd: '2026-12-01T00:00:00.000Z',
      },
    ];
    const backend = fakeBackend({ pairs });
    const json = await buildAccountExport(backend, STUDENT, '2026-10-26T00:00:00.000Z');
    expect(json.teachers).toHaveLength(1);
    expect(json.teachers[0]).toEqual(
      expect.objectContaining({ teacherId: 'tch_asha', agentId: 'agt_1', status: 'active' }),
    );
  });

  it('more than TEACHER_PAIRS_MAX distinct pairs caps the list, sets complete:false, and truncated contains teachers', async () => {
    const pairs: SubscriptionPair[] = Array.from({ length: TEACHER_PAIRS_MAX + 5 }, (_, i) => ({
      agentId: `agt_${i}`,
      teacherId: `tch_${i}`,
      status: 'active',
      periodEnd: '2026-12-01T00:00:00.000Z',
    }));
    const backend = fakeBackend({ pairs });
    const json = await buildAccountExport(backend, STUDENT, '2026-10-26T00:00:00.000Z');
    expect(json.teachers).toHaveLength(TEACHER_PAIRS_MAX);
    expect(json.complete).toBe(false);
    expect(json.truncated).toContain('teachers');
  });

  it('never reads or serialises help_state, helpState, mustNotReveal or answerKey', async () => {
    const backend = fakeBackend();
    const json = await buildAccountExport(backend, STUDENT, '2026-10-26T00:00:00.000Z');
    const text = JSON.stringify(json);
    expect(text).not.toMatch(/help_state|helpState|mustNotReveal|answerKey/);
  });

  it('calls listAllForStudent, getUser and listConsentsForStudent with the given studentId only', async () => {
    const calls: string[] = [];
    const backend: AccountExportBackend = {
      ...fakeBackend({ pairs: [] }),
      subscriptionPairs: {
        listAllForStudent: async (id: string) => {
          calls.push(`listAllForStudent:${id}`);
          return [];
        },
      },
      identity: {
        getUser: async (id: string) => {
          calls.push(`getUser:${id}`);
          return null;
        },
        listConsentsForStudent: async (id: string) => {
          calls.push(`listConsentsForStudent:${id}`);
          return [];
        },
      },
    };
    await buildAccountExport(backend, STUDENT, '2026-10-26T00:00:00.000Z');
    expect(calls.sort()).toEqual(
      [
        `getUser:${STUDENT}`,
        `listAllForStudent:${STUDENT}`,
        `listConsentsForStudent:${STUDENT}`,
      ].sort(),
    );
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
        listAllForStudent: async (id: string) => {
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
        listAllForStudent: async () => {
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
