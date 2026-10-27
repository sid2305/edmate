// Task 12.2c: POST /api/sessions/:id/reports over a memory agents+reports backend (no database;
// rule 4). The memory agents repo keeps `owner`'s real rule (live agents only); the memory reports
// repo keeps `file`'s real shape (`{ id, created }`, a second call on the same message is
// `created: false`). The student id always comes from the session, never the body.
import { RepositoryError, type Repositories } from '@edmate/db';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import {
  createGuard,
  type CookieReader,
  type Principal,
  type RoleContext,
} from '../../../../../src/auth/guard';
import { MAX_BODY_BYTES } from '../../../../../src/studio/routes';
import type { AgentOwners } from '../../../../../src/turn/scope';
import { createSessionReportsHandlers } from './handlers';

const ORIGIN = 'http://localhost:8080';
const PATH = '/api/sessions/ses_1/reports';
const STUDENT: Principal = { userId: 'stu_1', role: 'student' };
const WHO: Record<string, Principal> = {
  student: STUDENT,
  teacher: { userId: 'tch_1', role: 'teacher' },
  staff: { userId: 'stf_1', role: 'staff' },
};

/** A memory agents + reports backend with the real rules: a live-only owner lookup, a reply-only,
 * own-session file, idempotent on a second call. */
function memory() {
  const liveAgents = new Map<string, string>([['agt_1', 'tch_1']]);
  const filed: { id: string; reporterId: string; messageId: string; category: string }[] = [];
  const sessions = new Map<string, { studentId: string; agentId: string }>([
    ['ses_1', { studentId: 'stu_1', agentId: 'agt_1' }],
  ]);
  const replies = new Set(['msg_1']);

  const agents: AgentOwners = {
    owner: vi.fn(async ({ agentId }: { agentId: string }) => {
      const teacherId = liveAgents.get(agentId);
      return teacherId ? { teacherId } : null;
    }),
  };

  const file = vi.fn(
    async (
      scope: { studentId: string; teacherId: string },
      input: { sessionId: string; messageId: string; category: string },
    ): Promise<{ id: string; created: boolean }> => {
      const m = 'reports.file';
      const session = sessions.get(input.sessionId);
      if (!session || session.studentId !== scope.studentId || session.agentId !== 'agt_1') {
        throw new RepositoryError('not_found', m);
      }
      if (!replies.has(input.messageId)) throw new RepositoryError('not_found', m);
      const id = `rp_${scope.studentId}_${input.messageId}`;
      const already = filed.some((f) => f.id === id);
      if (already) return { id, created: false };
      filed.push({
        id,
        reporterId: scope.studentId,
        messageId: input.messageId,
        category: input.category,
      });
      return { id, created: true };
    },
  );

  const logs: { event: string; fields?: Record<string, string> }[] = [];
  const record = vi.fn(async () => ({ written: true }));
  const repos = { reports: { file }, safetyAlerts: { record } } as unknown as Pick<
    Repositories,
    'reports' | 'safetyAlerts'
  >;
  const h = createSessionReportsHandlers({
    agents,
    repos: () => repos,
    log: { error: (event, fields) => logs.push({ event, ...(fields ? { fields } : {}) }) },
  });
  return { h, agents, file, filed, record, logs };
}

const ctx = (principal: Principal = STUDENT, id = 'ses_1'): RoleContext => ({
  principal,
  params: Promise.resolve({ id }),
});

function post(body: unknown, raw?: string): NextRequest {
  return new NextRequest(`${ORIGIN}${PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: raw ?? JSON.stringify(body),
  });
}

async function codeOf(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

const VALID = { agentId: 'agt_1', messageId: 'msg_1', category: 'harmful' };

describe('POST: file a report', () => {
  it('files once: 201, { ok: true }, no-store, the scope has the reply session teacher', async () => {
    const m = memory();
    const res = await m.h.file(post(VALID), ctx());
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ ok: true });
    expect(m.file).toHaveBeenCalledWith(
      { studentId: 'stu_1', teacherId: 'tch_1' },
      { sessionId: 'ses_1', messageId: 'msg_1', category: 'harmful' },
    );
  });

  it('a second report on the same message is 200, { ok: true }, not a new row', async () => {
    const m = memory();
    await m.h.file(post(VALID), ctx());
    const res = await m.h.file(post(VALID), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(m.filed).toHaveLength(1);
  });

  it('a new report also pages the trust inbox with a fixed, non-PII excerpt', async () => {
    const m = memory();
    const res = await m.h.file(post(VALID), ctx());
    expect(res.status).toBe(201);
    expect(m.record).toHaveBeenCalledTimes(1);
    expect(m.record).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'info',
        kind: 'other',
        studentId: 'stu_1',
        teacherId: 'tch_1',
        sessionId: 'ses_1',
        excerptRedacted: 'A student reported a harmful reply.',
      }),
    );
  });

  it('a duplicate report does not page the trust inbox a second time', async () => {
    const m = memory();
    await m.h.file(post(VALID), ctx());
    m.record.mockClear();
    const res = await m.h.file(post(VALID), ctx());
    expect(res.status).toBe(200);
    expect(m.record).not.toHaveBeenCalled();
  });

  it('a safetyAlerts.record failure still returns the report success and logs only the error name', async () => {
    const m = memory();
    m.record.mockRejectedValueOnce(new RangeError('boom'));
    const res = await m.h.file(post(VALID), ctx());
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    expect(m.logs).toEqual([
      { event: 'sessions.reports.alert_failed', fields: { error: 'RangeError' } },
    ]);
  });

  it('an agent that is not live (suspended, draft or unknown) is 404, nothing filed', async () => {
    const m = memory();
    const res = await m.h.file(post({ ...VALID, agentId: 'agt_missing' }), ctx());
    expect(res.status).toBe(404);
    expect(m.file).not.toHaveBeenCalled();
  });

  it('a student message (not a reply) is 404', async () => {
    const m = memory();
    const res = await m.h.file(post({ ...VALID, messageId: 'msg_student' }), ctx());
    expect(res.status).toBe(404);
  });

  it("another student's session id is 404, nothing filed", async () => {
    const m = memory();
    const res = await m.h.file(post(VALID), ctx(STUDENT, 'ses_other'));
    expect(res.status).toBe(404);
    expect(m.filed).toEqual([]);
  });

  it.each([
    ['a body `studentId` key', { ...VALID, studentId: 'stu_2' }],
    ['a body `teacherId` key', { ...VALID, teacherId: 'tch_2' }],
    ['a body `sessionId` key', { ...VALID, sessionId: 'ses_2' }],
    ['missing agentId', { messageId: 'msg_1', category: 'harmful' }],
    ['missing messageId', { agentId: 'agt_1', category: 'harmful' }],
    ['missing category', { agentId: 'agt_1', messageId: 'msg_1' }],
    ['an unknown category', { ...VALID, category: 'free_text' }],
    ['empty messageId', { ...VALID, messageId: '' }],
    ['not an object', ['agt_1', 'msg_1', 'harmful']],
    ['null', null],
  ])('%s is 400 validation, nothing filed', async (_label, body) => {
    const m = memory();
    const res = await m.h.file(post(body), ctx());
    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe('validation');
    expect(m.file).not.toHaveBeenCalled();
  });

  it('malformed JSON is 400; an oversize body is 413; neither reaches the repo', async () => {
    const m = memory();
    expect((await m.h.file(post(null, '{not json'), ctx())).status).toBe(400);
    const big = post({ ...VALID, category: 'x'.repeat(MAX_BODY_BYTES) });
    const res = await m.h.file(big, ctx());
    expect(res.status).toBe(413);
    expect(await codeOf(res)).toBe('input_too_large');
    expect(m.file).not.toHaveBeenCalled();
  });

  it.each([
    ['scope', 403, 'forbidden'],
    ['not_found', 404, 'not_found'],
    ['invalid', 400, 'validation'],
    ['integrity', 400, 'validation'],
    ['failed', 500, 'provider_error'],
  ] as const)('a repository %s is %i %s, no raw text, no-store', async (kind, status, code) => {
    const m = memory();
    m.file.mockRejectedValueOnce(new RepositoryError(kind, 'reports.file'));
    const res = await m.h.file(post(VALID), ctx());
    expect(res.status).toBe(status);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ error: { code } });
    expect(text).not.toContain('reports.file');
  });

  it('an unexpected throw is 500 and logs only the error name (a non-Error too)', async () => {
    const m = memory();
    m.file.mockRejectedValueOnce(new Error('pg says person@example.test'));
    expect((await m.h.file(post(VALID), ctx())).status).toBe(500);
    m.file.mockRejectedValueOnce('nope');
    expect((await m.h.file(post(VALID), ctx())).status).toBe(500);
    expect(m.logs).toEqual([
      { event: 'sessions.reports.file_failed', fields: { error: 'Error' } },
      { event: 'sessions.reports.file_failed', fields: { error: 'unknown' } },
    ]);
  });

  it('the default logger writes to console.error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const repos = {
      reports: { file: async () => Promise.reject(new RangeError('x')) },
      safetyAlerts: { record: async () => ({ written: true }) },
    } as unknown as Pick<Repositories, 'reports' | 'safetyAlerts'>;
    const h = createSessionReportsHandlers({
      agents: { owner: async () => ({ teacherId: 'tch_1' }) },
      repos: () => repos,
    });
    expect((await h.file(post(VALID), ctx())).status).toBe(500);
    expect(spy).toHaveBeenCalledWith('sessions.reports.file_failed', { error: 'RangeError' });
    spy.mockRestore();
  });
});

describe('through the real guard and ROUTE_POLICY', () => {
  function guarded() {
    const m = memory();
    const guard = createGuard(
      () => ({
        getPrincipal: async (c: CookieReader) => WHO[c.get('who')?.value ?? ''] ?? null,
        learnerStatus: async () => 'clear',
        allowedOrigin: ORIGIN,
      }),
      () => {
        throw new Error('not a page');
      },
    );
    return { ...m, POST: guard.withRole(['student'], m.h.file) };
  }
  const call = (who: string | null, origin = ORIGIN) =>
    new NextRequest(`${ORIGIN}${PATH}`, {
      method: 'POST',
      headers: {
        ...(who ? { cookie: `who=${who}` } : {}),
        origin,
        'content-type': 'application/json',
      },
      body: JSON.stringify(VALID),
    });

  const routeCtx = { params: Promise.resolve({ id: 'ses_1' }) };

  it.each([
    [null, 401],
    ['teacher', 403],
    ['staff', 403],
  ])('as %s is %i, nothing filed', async (who, status) => {
    const g = guarded();
    const res = await g.POST(call(who), routeCtx);
    expect(res.status).toBe(status);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(g.file).not.toHaveBeenCalled();
  });

  it('a student is 201 and files the report', async () => {
    const g = guarded();
    const res = await g.POST(call('student'), routeCtx);
    expect(res.status).toBe(201);
    expect(g.filed).toHaveLength(1);
  });

  it('a cross-site student POST is 403 and writes nothing', async () => {
    const g = guarded();
    const res = await g.POST(call('student', 'https://evil.example'), routeCtx);
    expect(res.status).toBe(403);
    expect(g.filed).toEqual([]);
  });
});

describe('route.ts', () => {
  it('exports POST guarded for student only', async () => {
    const { GUARD } = await import('../../../../../src/auth/guard');
    const route = await import('./route');
    expect((route.POST as unknown as Record<symbol, unknown>)[GUARD]).toEqual(['student']);
    expect(route.dynamic).toBe('force-dynamic');
  });
});
