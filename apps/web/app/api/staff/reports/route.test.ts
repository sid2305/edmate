// Task 12.2d: the staff report queue API over a memory `reports` repo (no database; rule 4). The
// memory repo keeps the real one's rules (staff-only reads and writes, a report reviewed once,
// a `report.review` audit row per decision), so the role boundary, the error mapping and the audit
// write are all checked here; route.int.test.ts re-runs the same handlers over a real Postgres.
// The staff id always comes from the session, never the body.
import { RepositoryError, type Repositories, type StaffReportRow } from '@edmate/db';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { createGuard, type CookieReader, type Principal, type RoleContext } from '../../../../src/auth/guard';
import { MAX_BODY_BYTES } from '../../../../src/studio/routes';
import { createStaffReportsHandlers, MAX_NOTE_CHARS } from './handlers';

const ORIGIN = 'http://localhost:8080';
const PATH = '/api/staff/reports';
const STAFF: Principal = { userId: 'stf_1', role: 'staff' };
const WHO: Record<string, Principal> = {
  staff: STAFF,
  student: { userId: 'stu_1', role: 'student' },
  teacher: { userId: 'tch_a', role: 'teacher' },
};

interface Audit {
  reportId: string;
  actor: string;
  action: string;
  note?: string;
  before: string;
  after: string;
}

function row(id: string): StaffReportRow {
  return {
    id,
    category: 'harmful',
    status: 'open',
    createdAt: '2026-10-22T00:00:00.000Z',
    messageId: `msg_${id}`,
    teacherId: 'tch_a',
    agentId: 'agt_a',
    teacherSlug: 'asha-math',
    message: { role: 'agent', text: 'reported reply', createdAt: '2026-10-22T00:00:00.000Z' },
    citedDocuments: [],
  };
}

/** A memory `reports` repo with the real one's role, open-once and audit rules. */
function memory() {
  const roles = new Map<string, string>([
    ['stf_1', 'staff'],
    ['stf_2', 'staff'],
    ['stu_1', 'student'],
    ['tch_a', 'teacher'],
  ]);
  const open = new Map<string, StaffReportRow>([['rp_a', row('rp_a')], ['rp_b', row('rp_b')]]);
  const audits: Audit[] = [];
  const reports = {
    listOpenForStaff: vi.fn(async (by: unknown): Promise<StaffReportRow[]> => {
      if (typeof by !== 'string' || by === '') {
        throw new RepositoryError('invalid', 'reports.listOpenForStaff');
      }
      if (roles.get(by) !== 'staff') throw new RepositoryError('scope', 'reports.listOpenForStaff');
      return [...open.values()].sort((a, b) => a.id.localeCompare(b.id));
    }),
    review: vi.fn(
      async (
        by: unknown,
        reportId: unknown,
        input: { decision: 'dismissed' | 'actioned'; note?: string },
      ): Promise<{ id: string; status: typeof input.decision }> => {
        const method = 'reports.review';
        if (typeof by !== 'string' || by === '') throw new RepositoryError('invalid', method);
        if (roles.get(by) !== 'staff') throw new RepositoryError('scope', method);
        if (typeof reportId !== 'string' || reportId === '') {
          throw new RepositoryError('invalid', method);
        }
        const found = open.get(reportId);
        if (!found) throw new RepositoryError('not_found', method);
        open.delete(reportId);
        audits.push({
          reportId,
          actor: by,
          action: 'report.review',
          ...(input.note === undefined ? {} : { note: input.note }),
          before: 'open',
          after: input.decision,
        });
        return { id: reportId, status: input.decision };
      },
    ),
  };
  const logs: string[] = [];
  const repos = { reports } as unknown as Pick<Repositories, 'reports'>;
  const h = createStaffReportsHandlers({ repos: () => repos, log: (line) => logs.push(line) });
  return { h, roles, open, audits, logs, reports };
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

describe('GET: the open queue', () => {
  it('lists open reports for the session staff user, no-store', async () => {
    const m = memory();
    const res = await m.h.list(get(), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as { reports: StaffReportRow[] };
    expect(body.reports.map((r) => r.id)).toEqual(['rp_a', 'rp_b']);
    expect(m.reports.listOpenForStaff).toHaveBeenCalledWith('stf_1');
  });

  it('a report never carries a reporter id, name, email or session id', async () => {
    const m = memory();
    const text = await (await m.h.list(get(), ctx())).text();
    expect(text).not.toContain('reporter');
    expect(text).not.toContain('sessionId');
    expect(text).not.toContain('@example');
  });

  it('ignores any query string: the staff id is only the session', async () => {
    const m = memory();
    await m.h.list(new NextRequest(`${ORIGIN}${PATH}?by=tch_a`, { method: 'GET' }), ctx());
    expect(m.reports.listOpenForStaff).toHaveBeenCalledWith('stf_1');
  });

  it.each([
    ['scope', 403, 'forbidden'],
    ['invalid', 403, 'forbidden'],
    ['not_found', 500, 'provider_error'],
    ['integrity', 500, 'provider_error'],
    ['failed', 500, 'provider_error'],
  ] as const)('a repository %s is %i %s, with no raw error text', async (kind, status, code) => {
    const m = memory();
    m.reports.listOpenForStaff.mockRejectedValueOnce(new RepositoryError(kind, 'reports.listOpenForStaff'));
    const res = await m.h.list(get(), ctx());
    expect(res.status).toBe(status);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ error: { code } });
    expect(text).not.toContain('reports.listOpenForStaff');
  });

  it('an unexpected throw is 500 and logs only the error name', async () => {
    const m = memory();
    m.reports.listOpenForStaff.mockRejectedValueOnce(new TypeError('secret detail person@example.test'));
    const res = await m.h.list(get(), ctx());
    expect(res.status).toBe(500);
    expect(await codeOf(res)).toBe('provider_error');
    expect(m.logs).toEqual(['[staff] reports.list failed: TypeError']);
  });

  it('a former staff user (role changed after sign-in) is 403', async () => {
    const m = memory();
    m.roles.set('stf_1', 'student');
    const res = await m.h.list(get(), ctx());
    expect(res.status).toBe(403);
  });
});

describe('POST: dismiss or action', () => {
  it('reviews with the session as `by`, one report.review audit row; the report leaves the queue', async () => {
    const m = memory();
    const res = await m.h.review(post({ reportId: 'rp_a', decision: 'dismissed' }), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ id: 'rp_a', status: 'dismissed' });
    expect(m.reports.review).toHaveBeenCalledWith('stf_1', 'rp_a', { decision: 'dismissed' });
    expect(m.audits).toEqual([
      { reportId: 'rp_a', actor: 'stf_1', action: 'report.review', before: 'open', after: 'dismissed' },
    ]);
    const body = (await (await m.h.list(get(), ctx())).json()) as { reports: StaffReportRow[] };
    expect(body.reports.map((r) => r.id)).toEqual(['rp_b']);
  });

  it('actions with a note (trimmed); the note lands in the audit row', async () => {
    const m = memory();
    const res = await m.h.review(
      post({ reportId: 'rp_b', decision: 'actioned', note: '  took down the document  ' }),
      ctx(),
    );
    expect(res.status).toBe(200);
    expect(m.audits).toEqual([
      {
        reportId: 'rp_b',
        actor: 'stf_1',
        action: 'report.review',
        note: 'took down the document',
        before: 'open',
        after: 'actioned',
      },
    ]);
  });

  it('a body `by` (or any unknown key) is 400 and never reaches the repo', async () => {
    const m = memory();
    for (const extra of [{ by: 'stf_2' }, { userId: 'stf_2' }, { status: 'open' }]) {
      const res = await m.h.review(post({ reportId: 'rp_a', decision: 'dismissed', ...extra }), ctx());
      expect(res.status).toBe(400);
      expect(await codeOf(res)).toBe('validation');
    }
    expect(m.reports.review).not.toHaveBeenCalled();
    expect(m.audits).toEqual([]);
  });

  it.each([
    ['open is not a decision', { reportId: 'rp_a', decision: 'open' }],
    ['missing decision', { reportId: 'rp_a' }],
    ['missing reportId', { decision: 'dismissed' }],
    ['empty reportId', { reportId: '', decision: 'dismissed' }],
    ['numeric reportId', { reportId: 7, decision: 'dismissed' }],
    ['blank note', { reportId: 'rp_a', decision: 'actioned', note: '   ' }],
    ['note too long', { reportId: 'rp_a', decision: 'actioned', note: 'x'.repeat(MAX_NOTE_CHARS + 1) }],
    ['not an object', ['rp_a', 'dismissed']],
    ['null', null],
  ])('%s is 400 validation', async (_label, body) => {
    const m = memory();
    const res = await m.h.review(post(body), ctx());
    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe('validation');
    expect(m.reports.review).not.toHaveBeenCalled();
  });

  it('a note at the cap is accepted', async () => {
    const m = memory();
    const res = await m.h.review(
      post({ reportId: 'rp_a', decision: 'actioned', note: 'x'.repeat(MAX_NOTE_CHARS) }),
      ctx(),
    );
    expect(res.status).toBe(200);
  });

  it('malformed JSON is 400; an oversize body is 413; neither reaches the repo', async () => {
    const m = memory();
    expect((await m.h.review(post(null, '{not json'), ctx())).status).toBe(400);
    const big = post({ reportId: 'rp_a', decision: 'actioned', note: 'x'.repeat(MAX_BODY_BYTES) });
    const res = await m.h.review(big, ctx());
    expect(res.status).toBe(413);
    expect(await codeOf(res)).toBe('input_too_large');
    expect(m.reports.review).not.toHaveBeenCalled();
  });

  it.each([
    ['scope', 403, 'forbidden'],
    ['not_found', 404, 'not_found'],
    ['invalid', 400, 'validation'],
    ['integrity', 400, 'validation'],
    ['failed', 500, 'provider_error'],
  ] as const)('a repository %s is %i %s, no raw text, no-store', async (kind, status, code) => {
    const m = memory();
    m.reports.review.mockRejectedValueOnce(new RepositoryError(kind, 'reports.review'));
    const res = await m.h.review(post({ reportId: 'rp_a', decision: 'dismissed' }), ctx());
    expect(res.status).toBe(status);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ error: { code } });
    expect(text).not.toContain('reports.review');
  });

  it('an already-reviewed report is 404', async () => {
    const m = memory();
    await m.h.review(post({ reportId: 'rp_a', decision: 'dismissed' }), ctx());
    const res = await m.h.review(post({ reportId: 'rp_a', decision: 'actioned' }), ctx());
    expect(res.status).toBe(404);
  });

  it('an unexpected throw is 500 and logs only the error name (a non-Error too)', async () => {
    const m = memory();
    m.reports.review.mockRejectedValueOnce(new Error('pg says person@example.test'));
    expect((await m.h.review(post({ reportId: 'rp_a', decision: 'dismissed' }), ctx())).status).toBe(500);
    m.reports.review.mockRejectedValueOnce('nope');
    expect((await m.h.review(post({ reportId: 'rp_a', decision: 'dismissed' }), ctx())).status).toBe(500);
    expect(m.logs).toEqual([
      '[staff] reports.review failed: Error',
      '[staff] reports.review failed: non-error',
    ]);
  });

  it('the default logger writes to console.error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const repos = {
      reports: { listOpenForStaff: async () => Promise.reject(new RangeError('x')) },
    } as unknown as Pick<Repositories, 'reports'>;
    const h = createStaffReportsHandlers({ repos: () => repos });
    expect((await h.list(get(), ctx())).status).toBe(500);
    expect(spy).toHaveBeenCalledWith('[staff] reports.list failed: RangeError');
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
    return {
      ...m,
      GET: guard.withRole(['staff'], m.h.list),
      POST: guard.withRole(['staff'], m.h.review),
    };
  }
  const call = (method: 'GET' | 'POST', who: string | null, origin = ORIGIN) =>
    new NextRequest(`${ORIGIN}${PATH}`, {
      method,
      headers: {
        ...(who ? { cookie: `who=${who}` } : {}),
        ...(method === 'POST' ? { origin, 'content-type': 'application/json' } : {}),
      },
      ...(method === 'POST' ? { body: JSON.stringify({ reportId: 'rp_a', decision: 'dismissed' }) } : {}),
    });

  it('signed-out is 401; student and teacher are 403 on GET and POST', async () => {
    const g = guarded();
    expect((await g.GET(call('GET', null))).status).toBe(401);
    expect((await g.POST(call('POST', null))).status).toBe(401);
    for (const who of ['student', 'teacher']) {
      expect((await g.GET(call('GET', who))).status).toBe(403);
      expect((await g.POST(call('POST', who))).status).toBe(403);
    }
    expect(g.audits).toEqual([]);
  });

  it('a cross-site POST is refused before the repo is touched', async () => {
    const g = guarded();
    const res = await g.POST(call('POST', 'staff', 'http://evil.test'));
    expect(res.status).toBe(403);
    expect(g.audits).toEqual([]);
  });

  it('staff can list and review through the real guard', async () => {
    const g = guarded();
    expect((await g.GET(call('GET', 'staff'))).status).toBe(200);
    expect((await g.POST(call('POST', 'staff'))).status).toBe(200);
    expect(g.audits).toHaveLength(1);
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
