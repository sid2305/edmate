// Task 6.4a Phase B: POST /api/sessions/:id/end over a memory agents+sessions+messages backend
// (no database; rule 4) and a scripted gateway (no real model call; rule 4). The memory sessions
// repo keeps `get`/`end`'s real rules: another student's or teacher's session, or a mismatched
// agent, reads as missing; an already-ended session's `end` is a no-op.
import { RepositoryError, type Repositories } from '@edmate/db';
import type { Message, ModelGateway } from '@edmate/contracts';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import {
  createGuard,
  type CookieReader,
  type Principal,
  type RoleContext,
} from '../../../../../src/auth/guard';
import { MAX_BODY_BYTES } from '../../../../../src/turn/routes';
import type { AgentOwners } from '../../../../../src/turn/scope';
import { createSessionEndHandlers, SUMMARY_HISTORY_LIMIT, type SessionEndBackend } from './route';

const ORIGIN = 'http://localhost:8080';
const PATH = '/api/sessions/ses_1/end';
const STUDENT: Principal = { userId: 'stu_1', role: 'student' };
const WHO: Record<string, Principal> = {
  student: STUDENT,
  teacher: { userId: 'tch_1', role: 'teacher' },
  staff: { userId: 'stf_1', role: 'staff' },
};

interface SessionRow {
  studentId: string;
  teacherId: string;
  agentId: string;
  endedAt: string | null;
  summary: string | null;
}

function message(role: Message['role'], text: string): Message {
  return { id: `msg_${role}_${text}`, role, text, createdAt: new Date().toISOString() };
}

/** A memory agents + sessions + messages backend with the real rules, plus a stub drafter. */
function memory(options: { summary?: string; gatewayFails?: boolean; history?: Message[] } = {}) {
  const liveAgents = new Map<string, string>([['agt_1', 'tch_1']]);
  const sessions = new Map<string, SessionRow>([
    [
      'ses_1',
      { studentId: 'stu_1', teacherId: 'tch_1', agentId: 'agt_1', endedAt: null, summary: null },
    ],
  ]);
  const history = options.history ?? [message('student', 'Hi'), message('agent', 'Hello')];

  const agents: AgentOwners = {
    owner: vi.fn(async ({ agentId }: { agentId: string }) => {
      const teacherId = liveAgents.get(agentId);
      return teacherId ? { teacherId } : null;
    }),
  };

  const get = vi.fn(
    async (
      scope: { studentId: string; teacherId: string },
      sessionId: string,
    ): Promise<{ agentId: string; endedAt: string | null } | null> => {
      const row = sessions.get(sessionId);
      if (!row || row.studentId !== scope.studentId || row.teacherId !== scope.teacherId) {
        return null;
      }
      return { agentId: row.agentId, endedAt: row.endedAt };
    },
  );

  const end = vi.fn(
    async (
      scope: { studentId: string; teacherId: string },
      sessionId: string,
      summary: string | undefined,
    ): Promise<{ ended: boolean }> => {
      const m = 'sessions.end';
      const row = sessions.get(sessionId);
      if (!row || row.studentId !== scope.studentId || row.teacherId !== scope.teacherId) {
        throw new RepositoryError('not_found', m);
      }
      if (row.endedAt !== null) return { ended: false };
      row.endedAt = new Date().toISOString();
      row.summary = summary ?? null;
      return { ended: true };
    },
  );

  const historyFn = vi.fn(async (): Promise<Message[]> => history);

  const repos = { sessions: { get, end }, messages: { history: historyFn } } as unknown as Pick<
    Repositories,
    'sessions' | 'messages'
  >;

  const gateway = vi.fn(async (): Promise<Pick<ModelGateway, 'generateObject'>> => {
    if (options.gatewayFails === true) throw new Error('no provider key');
    return {
      generateObject: async (_req, schema) =>
        schema.parse({ summary: options.summary ?? 'A short recap.' }),
    };
  });

  const logs: { event: string; fields?: Record<string, string> }[] = [];
  const backend: SessionEndBackend = {
    agents,
    repos: () => repos,
    gateway,
    log: { error: (event, fields) => logs.push({ event, ...(fields ? { fields } : {}) }) },
  };
  const h = createSessionEndHandlers(backend);
  return { h, agents, get, end, historyFn, gateway, sessions, logs };
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

const VALID = { agentId: 'agt_1' };

describe('POST: end a session', () => {
  it('ends an open session: 200, { ok: true }, stores the summary', async () => {
    const m = memory({ summary: 'Covered fractions.' });
    const res = await m.h.end(post(VALID), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ ok: true });
    expect(m.historyFn).toHaveBeenCalledWith(
      { studentId: 'stu_1', teacherId: 'tch_1' },
      'ses_1',
      SUMMARY_HISTORY_LIMIT,
    );
    expect(m.end).toHaveBeenCalledWith(
      { studentId: 'stu_1', teacherId: 'tch_1' },
      'ses_1',
      'Covered fractions.',
    );
    expect(m.sessions.get('ses_1')?.summary).toBe('Covered fractions.');
  });

  it('an empty transcript never calls the gateway and ends with no summary', async () => {
    const m = memory({ history: [] });
    const res = await m.h.end(post(VALID), ctx());
    expect(res.status).toBe(200);
    expect(m.gateway).not.toHaveBeenCalled();
    expect(m.end).toHaveBeenCalledWith(
      { studentId: 'stu_1', teacherId: 'tch_1' },
      'ses_1',
      undefined,
    );
  });

  it('a gateway failure never blocks ending the session: ends with no summary, logs only the name', async () => {
    const m = memory({ gatewayFails: true });
    const res = await m.h.end(post(VALID), ctx());
    expect(res.status).toBe(200);
    expect(m.end).toHaveBeenCalledWith(
      { studentId: 'stu_1', teacherId: 'tch_1' },
      'ses_1',
      undefined,
    );
    expect(m.logs).toEqual([
      { event: 'sessions.end.summarize_failed', fields: { error: 'Error' } },
    ]);
  });

  it('an already-ended session is a no-op success: no summarise, no re-end, summary unchanged', async () => {
    const m = memory({ summary: 'new one' });
    m.sessions.set('ses_1', {
      studentId: 'stu_1',
      teacherId: 'tch_1',
      agentId: 'agt_1',
      endedAt: '2026-01-01T00:00:00.000Z',
      summary: 'old one',
    });
    const res = await m.h.end(post(VALID), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(m.gateway).not.toHaveBeenCalled();
    expect(m.end).not.toHaveBeenCalled();
    expect(m.sessions.get('ses_1')?.summary).toBe('old one');
  });

  it('an agent that is not live (suspended, draft or unknown) is 404, nothing ended', async () => {
    const m = memory();
    const res = await m.h.end(post({ agentId: 'agt_missing' }), ctx());
    expect(res.status).toBe(404);
    expect(m.end).not.toHaveBeenCalled();
  });

  it('an unknown session id is 404, nothing ended', async () => {
    const m = memory();
    const res = await m.h.end(post(VALID), ctx(STUDENT, 'ses_missing'));
    expect(res.status).toBe(404);
    expect(m.end).not.toHaveBeenCalled();
  });

  it("another student's session id is 404, nothing ended", async () => {
    const m = memory();
    const res = await m.h.end(post(VALID), ctx({ userId: 'stu_2', role: 'student' }));
    expect(res.status).toBe(404);
    expect(m.end).not.toHaveBeenCalled();
  });

  it('a session belonging to a different agent is 404, nothing ended', async () => {
    const m = memory();
    m.sessions.set('ses_1', {
      studentId: 'stu_1',
      teacherId: 'tch_1',
      agentId: 'agt_other',
      endedAt: null,
      summary: null,
    });
    const res = await m.h.end(post(VALID), ctx());
    expect(res.status).toBe(404);
    expect(m.end).not.toHaveBeenCalled();
  });

  it.each([
    ['missing agentId', {}],
    ['empty agentId', { agentId: '' }],
    ['not an object', ['agt_1']],
    ['null', null],
    ['an extra key', { ...VALID, sessionId: 'ses_2' }],
  ])('%s is 400 validation, nothing ended', async (_label, body) => {
    const m = memory();
    const res = await m.h.end(post(body), ctx());
    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe('validation');
    expect(m.end).not.toHaveBeenCalled();
  });

  it('malformed JSON is 400; an oversize body is 413; neither reaches the repo', async () => {
    const m = memory();
    expect((await m.h.end(post(null, '{not json'), ctx())).status).toBe(400);
    const big = post({ agentId: 'agt_1', pad: 'x'.repeat(MAX_BODY_BYTES) });
    const res = await m.h.end(big, ctx());
    expect(res.status).toBe(413);
    expect(await codeOf(res)).toBe('input_too_large');
    expect(m.end).not.toHaveBeenCalled();
  });

  it.each([
    ['scope', 403, 'forbidden'],
    ['not_found', 404, 'not_found'],
    ['invalid', 400, 'validation'],
    ['integrity', 400, 'validation'],
    ['failed', 500, 'provider_error'],
  ] as const)('a repository %s is %i %s, no raw text, no-store', async (kind, status, code) => {
    const m = memory();
    m.end.mockRejectedValueOnce(new RepositoryError(kind, 'sessions.end'));
    const res = await m.h.end(post(VALID), ctx());
    expect(res.status).toBe(status);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ error: { code } });
    expect(text).not.toContain('sessions.end');
  });

  it('an unexpected throw is 500 and logs only the error name (a non-Error too)', async () => {
    const m = memory();
    m.end.mockRejectedValueOnce(new Error('pg says person@example.test'));
    expect((await m.h.end(post(VALID), ctx())).status).toBe(500);
    m.end.mockRejectedValueOnce('nope');
    expect((await m.h.end(post(VALID), ctx())).status).toBe(500);
    expect(m.logs.filter((l) => l.event === 'sessions.end.failed')).toEqual([
      { event: 'sessions.end.failed', fields: { error: 'Error' } },
      { event: 'sessions.end.failed', fields: { error: 'string' } },
    ]);
  });

  it('the default logger writes to console.error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const repos = {
      sessions: {
        get: async () => Promise.reject(new RangeError('x')),
        end: async () => ({ ended: true }),
      },
      messages: { history: async () => [] },
    } as unknown as Pick<Repositories, 'sessions' | 'messages'>;
    const h = createSessionEndHandlers({
      agents: { owner: async () => ({ teacherId: 'tch_1' }) },
      repos: () => repos,
      gateway: async () => ({
        generateObject: async (_req, schema) => schema.parse({ summary: 'x' }),
      }),
    });
    expect((await h.end(post(VALID), ctx())).status).toBe(500);
    expect(spy).toHaveBeenCalledWith('sessions.end.failed', { error: 'RangeError' });
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
    return { ...m, POST: guard.withRole(['student'], m.h.end) };
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
  ])('as %s is %i, nothing ended', async (who, status) => {
    const g = guarded();
    const res = await g.POST(call(who), routeCtx);
    expect(res.status).toBe(status);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(g.end).not.toHaveBeenCalled();
  });

  it('a student is 200 and ends the session', async () => {
    const g = guarded();
    const res = await g.POST(call('student'), routeCtx);
    expect(res.status).toBe(200);
    expect(g.end).toHaveBeenCalledTimes(1);
  });

  it('a cross-site student POST is 403 and ends nothing', async () => {
    const g = guarded();
    const res = await g.POST(call('student', 'https://evil.example'), routeCtx);
    expect(res.status).toBe(403);
    expect(g.end).not.toHaveBeenCalled();
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
