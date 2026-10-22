// Task 12.4c: the staff regulated-subject API over a memory `regulatedSubjects` repo (no database;
// rule 4). The memory repo keeps the real one's rules (staff-only reads and writes, same value is
// a no-op, a subject change clears the approval, approving an unflagged agent is `invalid`, one
// audit row per change), so the role boundary, the strict bodies and the error mapping are all
// checked here; route.int.test.ts re-runs the same handlers over a real Postgres. The staff id
// always comes from the session, never the body, and the note is never logged.
import { RepositoryError, REGULATED_NOTE_MAX, type RegulatedAgentRow, type Repositories } from '@edmate/db';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { createGuard, type CookieReader, type Principal, type RoleContext } from '../../../../src/auth/guard';
import { MAX_BODY_BYTES } from '../../../../src/studio/routes';
import { createStaffAgentHandlers } from './handlers';

const ORIGIN = 'http://localhost:8080';
const PATH = '/api/staff/agents';
const STAFF: Principal = { userId: 'stf_1', role: 'staff' };
const WHO: Record<string, Principal> = {
  staff: STAFF,
  student: { userId: 'stu_1', role: 'student' },
  teacher: { userId: 'tch_a', role: 'teacher' },
};

interface Audit {
  agentId: string;
  actor: string;
  action: string;
  reason?: string;
}

/** A memory regulatedSubjects repo with the real one's role, no-op, clear and audit rules. */
function memory() {
  const roles = new Map<string, string>([
    ['stf_1', 'staff'],
    ['stf_2', 'staff'],
    ['tch_a', 'teacher'],
  ]);
  const rows = new Map<string, RegulatedAgentRow>();
  for (const [agentId, slug] of [
    ['agt_2', 'ben-physics'],
    ['agt_1', 'asha-math'],
  ] as const) {
    rows.set(agentId, {
      agentId,
      teacherSlug: slug,
      status: 'draft',
      liveVersion: null,
      regulatedSubject: null,
      approvedAt: null,
      approvedBy: null,
    });
  }
  const audits: Audit[] = [];
  const staffOnly = (by: string, m: string) => {
    if (roles.get(by) !== 'staff') throw new RepositoryError('scope', m);
  };
  const regulatedSubjects = {
    listForStaff: vi.fn(async (by: string): Promise<RegulatedAgentRow[]> => {
      staffOnly(by, 'regulatedSubjects.listForStaff');
      return [...rows.values()];
    }),
    setSubject: vi.fn(
      async (
        by: string,
        input: { agentId: string; subject: RegulatedAgentRow['regulatedSubject']; note?: string },
      ): Promise<{ changed: boolean }> => {
        const m = 'regulatedSubjects.setSubject';
        staffOnly(by, m);
        const row = rows.get(input.agentId);
        if (!row) throw new RepositoryError('not_found', m);
        if (row.regulatedSubject === input.subject) return { changed: false };
        rows.set(input.agentId, { ...row, regulatedSubject: input.subject, approvedAt: null, approvedBy: null });
        audits.push({
          agentId: input.agentId,
          actor: by,
          action: 'agent.regulated_flag',
          ...(input.note === undefined ? {} : { reason: input.note }),
        });
        return { changed: true };
      },
    ),
    setApproval: vi.fn(
      async (
        by: string,
        input: { agentId: string; approved: boolean; note?: string },
      ): Promise<{ changed: boolean }> => {
        const m = 'regulatedSubjects.setApproval';
        staffOnly(by, m);
        const row = rows.get(input.agentId);
        if (!row) throw new RepositoryError('not_found', m);
        if ((row.approvedAt !== null) === input.approved) return { changed: false };
        if (input.approved && row.regulatedSubject === null) throw new RepositoryError('invalid', m);
        rows.set(input.agentId, {
          ...row,
          approvedAt: input.approved ? '2026-10-22T10:00:00.000Z' : null,
          approvedBy: input.approved ? by : null,
        });
        audits.push({
          agentId: input.agentId,
          actor: by,
          action: 'agent.regulated_approval',
          ...(input.note === undefined ? {} : { reason: input.note }),
        });
        return { changed: true };
      },
    ),
  };
  const logs: string[] = [];
  const repos = { regulatedSubjects } as unknown as Pick<Repositories, 'regulatedSubjects'>;
  const h = createStaffAgentHandlers({ repos: () => repos, log: (line) => logs.push(line) });
  return { h, roles, rows, audits, logs, regulatedSubjects };
}

const ctx = (principal: Principal = STAFF): RoleContext => ({
  principal,
  params: Promise.resolve({}),
});

function post(body: unknown, raw?: string): NextRequest {
  return new NextRequest(`${ORIGIN}${PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: raw ?? JSON.stringify(body),
  });
}
const get = () => new NextRequest(`${ORIGIN}${PATH}`, { method: 'GET' });

async function codeOf(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

describe('GET: every agent with its flag', () => {
  it('lists agents for the session staff user, no-store', async () => {
    const m = memory();
    const res = await m.h.list(get(), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as { agents: RegulatedAgentRow[] };
    expect(body.agents.map((a) => a.agentId)).toEqual(['agt_2', 'agt_1']);
    expect(body.agents[1]).toEqual({
      agentId: 'agt_1',
      teacherSlug: 'asha-math',
      status: 'draft',
      liveVersion: null,
      regulatedSubject: null,
      approvedAt: null,
      approvedBy: null,
    });
    expect(m.regulatedSubjects.listForStaff).toHaveBeenCalledWith('stf_1');
  });

  it('ignores any query string: the staff id is only the session', async () => {
    const m = memory();
    await m.h.list(new NextRequest(`${ORIGIN}${PATH}?by=stf_2`, { method: 'GET' }), ctx());
    expect(m.regulatedSubjects.listForStaff).toHaveBeenCalledWith('stf_1');
  });

  it('passes only the known columns through (a stray extra field is dropped)', async () => {
    const m = memory();
    m.regulatedSubjects.listForStaff.mockResolvedValueOnce([
      { ...m.rows.get('agt_1')!, email: 'x@example.test' } as unknown as RegulatedAgentRow,
    ]);
    const text = await (await m.h.list(get(), ctx())).text();
    expect(text).not.toContain('example.test');
  });

  it.each([
    ['scope', 403, 'forbidden'],
    ['invalid', 403, 'forbidden'],
    ['not_found', 403, 'forbidden'],
    ['integrity', 500, 'provider_error'],
    ['failed', 500, 'provider_error'],
  ] as const)('a repository %s is %i %s, with no raw error text', async (kind, status, code) => {
    const m = memory();
    m.regulatedSubjects.listForStaff.mockRejectedValueOnce(
      new RepositoryError(kind, 'regulatedSubjects.listForStaff'),
    );
    const res = await m.h.list(get(), ctx());
    expect(res.status).toBe(status);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ error: { code } });
    expect(text).not.toContain('regulatedSubjects');
  });

  it('a former staff user (role changed after sign-in) is 403', async () => {
    const m = memory();
    m.roles.set('stf_1', 'student');
    expect((await m.h.list(get(), ctx())).status).toBe(403);
  });

  it('an unexpected throw is 500 and logs only the error name', async () => {
    const m = memory();
    m.regulatedSubjects.listForStaff.mockRejectedValueOnce(new TypeError('secret person@example.test'));
    const res = await m.h.list(get(), ctx());
    expect(res.status).toBe(500);
    expect(await codeOf(res)).toBe('provider_error');
    expect(m.logs).toEqual(['[staff] agents.list failed: TypeError']);
  });
});

describe('POST action subject', () => {
  it('flags an agent with the session as `by`; the note is trimmed and audited', async () => {
    const m = memory();
    const res = await m.h.update(
      post({ action: 'subject', agentId: 'agt_1', subject: 'health', note: '  covers symptoms  ' }),
      ctx(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ agentId: 'agt_1', changed: true });
    expect(m.regulatedSubjects.setSubject).toHaveBeenCalledWith('stf_1', {
      agentId: 'agt_1',
      subject: 'health',
      note: 'covers symptoms',
    });
    expect(m.audits).toEqual([
      { agentId: 'agt_1', actor: 'stf_1', action: 'agent.regulated_flag', reason: 'covers symptoms' },
    ]);
  });

  it('the same subject again is a no-op (changed false, no new audit row)', async () => {
    const m = memory();
    await m.h.update(post({ action: 'subject', agentId: 'agt_1', subject: 'law' }), ctx());
    const res = await m.h.update(post({ action: 'subject', agentId: 'agt_1', subject: 'law' }), ctx());
    expect(await res.json()).toEqual({ agentId: 'agt_1', changed: false });
    expect(m.audits).toHaveLength(1);
  });

  it('null clears the flag; no note means no note key', async () => {
    const m = memory();
    await m.h.update(post({ action: 'subject', agentId: 'agt_1', subject: 'investing' }), ctx());
    const res = await m.h.update(post({ action: 'subject', agentId: 'agt_1', subject: null }), ctx());
    expect(res.status).toBe(200);
    expect(m.regulatedSubjects.setSubject).toHaveBeenLastCalledWith('stf_1', { agentId: 'agt_1', subject: null });
    expect(m.rows.get('agt_1')?.regulatedSubject).toBeNull();
  });

  it('changing the subject clears an approval', async () => {
    const m = memory();
    await m.h.update(post({ action: 'subject', agentId: 'agt_1', subject: 'health' }), ctx());
    await m.h.update(post({ action: 'approval', agentId: 'agt_1', approved: true }), ctx());
    expect(m.rows.get('agt_1')?.approvedBy).toBe('stf_1');
    await m.h.update(post({ action: 'subject', agentId: 'agt_1', subject: 'law' }), ctx());
    expect(m.rows.get('agt_1')).toMatchObject({ regulatedSubject: 'law', approvedAt: null, approvedBy: null });
  });
});

describe('POST action approval', () => {
  it('approves a flagged agent, then revokes it; each is one audit row', async () => {
    const m = memory();
    await m.h.update(post({ action: 'subject', agentId: 'agt_2', subject: 'investing' }), ctx());
    const res = await m.h.update(
      post({ action: 'approval', agentId: 'agt_2', approved: true, note: 'reviewed' }),
      ctx(),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ agentId: 'agt_2', changed: true });
    expect(m.regulatedSubjects.setApproval).toHaveBeenCalledWith('stf_1', {
      agentId: 'agt_2',
      approved: true,
      note: 'reviewed',
    });
    const revoke = await m.h.update(post({ action: 'approval', agentId: 'agt_2', approved: false }), ctx());
    expect(await revoke.json()).toEqual({ agentId: 'agt_2', changed: true });
    expect(m.audits.map((a) => a.action)).toEqual([
      'agent.regulated_flag',
      'agent.regulated_approval',
      'agent.regulated_approval',
    ]);
  });

  it('approving an unflagged agent is 400 validation with its own message, nothing written', async () => {
    const m = memory();
    const res = await m.h.update(post({ action: 'approval', agentId: 'agt_1', approved: true }), ctx());
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('validation');
    expect(body.error.message).toMatch(/subject/i);
    expect(m.audits).toEqual([]);
  });

  it('an unknown agent is 404', async () => {
    const m = memory();
    const res = await m.h.update(post({ action: 'approval', agentId: 'agt_zz', approved: false }), ctx());
    expect(res.status).toBe(404);
    expect(await codeOf(res)).toBe('not_found');
  });
});

describe('POST: strict bodies', () => {
  it('a body `by` (or any unknown key) is 400 and never reaches the repo', async () => {
    const m = memory();
    for (const body of [
      { action: 'subject', agentId: 'agt_1', subject: 'health', by: 'stf_2' },
      { action: 'approval', agentId: 'agt_1', approved: true, by: 'stf_2' },
      { action: 'approval', agentId: 'agt_1', approved: true, approvedBy: 'stf_2' },
      { action: 'subject', agentId: 'agt_1', subject: 'health', approved: true },
    ]) {
      const res = await m.h.update(post(body), ctx());
      expect(res.status).toBe(400);
      expect(await codeOf(res)).toBe('validation');
    }
    expect(m.regulatedSubjects.setSubject).not.toHaveBeenCalled();
    expect(m.regulatedSubjects.setApproval).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown action', { action: 'delete', agentId: 'agt_1' }],
    ['missing action', { agentId: 'agt_1', subject: 'health' }],
    ['unknown subject', { action: 'subject', agentId: 'agt_1', subject: 'tax' }],
    ['missing subject', { action: 'subject', agentId: 'agt_1' }],
    ['approved not boolean', { action: 'approval', agentId: 'agt_1', approved: 'yes' }],
    ['missing approved', { action: 'approval', agentId: 'agt_1' }],
    ['missing agentId', { action: 'subject', subject: 'health' }],
    ['empty agentId', { action: 'subject', agentId: '', subject: 'health' }],
    ['long agentId', { action: 'subject', agentId: 'a'.repeat(201), subject: 'health' }],
    ['numeric agentId', { action: 'approval', agentId: 7, approved: true }],
    ['blank note', { action: 'subject', agentId: 'agt_1', subject: 'law', note: '   ' }],
    ['note too long', { action: 'subject', agentId: 'agt_1', subject: 'law', note: 'x'.repeat(REGULATED_NOTE_MAX + 1) }],
    ['not an object', ['subject', 'agt_1']],
    ['null', null],
  ])('%s is 400 validation', async (_label, body) => {
    const m = memory();
    const res = await m.h.update(post(body), ctx());
    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe('validation');
    expect(m.regulatedSubjects.setSubject).not.toHaveBeenCalled();
    expect(m.regulatedSubjects.setApproval).not.toHaveBeenCalled();
  });

  it('a note at the cap is accepted', async () => {
    const m = memory();
    const res = await m.h.update(
      post({ action: 'approval', agentId: 'agt_1', approved: false, note: 'x'.repeat(REGULATED_NOTE_MAX) }),
      ctx(),
    );
    expect(res.status).toBe(200);
  });

  it('malformed JSON is 400; an oversize body is 413; neither reaches the repo', async () => {
    const m = memory();
    expect((await m.h.update(post(null, '{not json'), ctx())).status).toBe(400);
    const res = await m.h.update(
      post({ action: 'subject', agentId: 'agt_1', subject: 'law', note: 'x'.repeat(MAX_BODY_BYTES) }),
      ctx(),
    );
    expect(res.status).toBe(413);
    expect(await codeOf(res)).toBe('input_too_large');
    expect(m.regulatedSubjects.setSubject).not.toHaveBeenCalled();
  });
});

describe('POST: repository errors', () => {
  it.each([
    ['scope', 403, 'forbidden'],
    ['not_found', 404, 'not_found'],
    ['integrity', 400, 'validation'],
    ['failed', 500, 'provider_error'],
  ] as const)('a repository %s is %i %s, no raw text, no-store', async (kind, status, code) => {
    const m = memory();
    m.regulatedSubjects.setSubject.mockRejectedValueOnce(new RepositoryError(kind, 'regulatedSubjects.setSubject'));
    const res = await m.h.update(post({ action: 'subject', agentId: 'agt_1', subject: 'law' }), ctx());
    expect(res.status).toBe(status);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ error: { code } });
    expect(text).not.toContain('regulatedSubjects');
  });

  it('a former staff user is 403 and writes nothing', async () => {
    const m = memory();
    m.roles.set('stf_1', 'teacher');
    const res = await m.h.update(post({ action: 'subject', agentId: 'agt_1', subject: 'law' }), ctx());
    expect(res.status).toBe(403);
    expect(m.audits).toEqual([]);
  });

  it('an unexpected throw is 500, logs only the error name, never the note', async () => {
    const m = memory();
    const note = 'private note about person@example.test';
    m.regulatedSubjects.setApproval.mockRejectedValueOnce(new Error(`pg says ${note}`));
    const r1 = await m.h.update(post({ action: 'approval', agentId: 'agt_1', approved: false, note }), ctx());
    expect(r1.status).toBe(500);
    expect(await r1.text()).not.toContain('person@example.test');
    m.regulatedSubjects.setSubject.mockRejectedValueOnce('nope');
    const r2 = await m.h.update(post({ action: 'subject', agentId: 'agt_1', subject: 'law', note }), ctx());
    expect(r2.status).toBe(500);
    expect(m.logs).toEqual(['[staff] agents.approval failed: Error', '[staff] agents.subject failed: non-error']);
    expect(m.logs.join('\n')).not.toContain('person@example.test');
  });

  it('the default logger writes to console.error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const repos = {
      regulatedSubjects: { listForStaff: async () => Promise.reject(new RangeError('x')) },
    } as unknown as Pick<Repositories, 'regulatedSubjects'>;
    const h = createStaffAgentHandlers({ repos: () => repos });
    expect((await h.list(get(), ctx())).status).toBe(500);
    expect(spy).toHaveBeenCalledWith('[staff] agents.list failed: RangeError');
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
    return { ...m, GET: guard.withRole(['staff'], m.h.list), POST: guard.withRole(['staff'], m.h.update) };
  }
  const call = (method: 'GET' | 'POST', who: string | null, origin = ORIGIN) =>
    new NextRequest(`${ORIGIN}${PATH}`, {
      method,
      headers: {
        ...(who ? { cookie: `who=${who}` } : {}),
        ...(method === 'POST' ? { origin, 'content-type': 'application/json' } : {}),
      },
      ...(method === 'POST'
        ? { body: JSON.stringify({ action: 'subject', agentId: 'agt_1', subject: 'health' }) }
        : {}),
    });

  it.each([
    [null, 401],
    ['student', 403],
    ['teacher', 403],
  ])('GET and POST as %s are %i, nothing read or written', async (who, status) => {
    const g = guarded();
    const got = await g.GET(call('GET', who));
    const posted = await g.POST(call('POST', who));
    expect(got.status).toBe(status);
    expect(posted.status).toBe(status);
    expect(got.headers.get('cache-control')).toBe('no-store');
    expect(posted.headers.get('cache-control')).toBe('no-store');
    expect(g.regulatedSubjects.listForStaff).not.toHaveBeenCalled();
    expect(g.regulatedSubjects.setSubject).not.toHaveBeenCalled();
    expect(g.audits).toEqual([]);
  });

  it('staff GET is 200 and staff POST writes the audit row', async () => {
    const g = guarded();
    expect((await g.GET(call('GET', 'staff'))).status).toBe(200);
    expect((await g.POST(call('POST', 'staff'))).status).toBe(200);
    expect(g.audits).toEqual([{ agentId: 'agt_1', actor: 'stf_1', action: 'agent.regulated_flag' }]);
  });

  it('a cross-site staff POST is 403 and writes nothing', async () => {
    const g = guarded();
    expect((await g.POST(call('POST', 'staff', 'https://evil.example'))).status).toBe(403);
    expect(g.audits).toEqual([]);
  });
});

describe('route.ts', () => {
  it('exports GET and POST guarded for staff only', async () => {
    const { GUARD } = await import('../../../../src/auth/guard');
    const route = await import('./route');
    expect((route.GET as unknown as Record<symbol, unknown>)[GUARD]).toEqual(['staff']);
    expect((route.POST as unknown as Record<symbol, unknown>)[GUARD]).toEqual(['staff']);
    expect(route.dynamic).toBe('force-dynamic');
  });
});
