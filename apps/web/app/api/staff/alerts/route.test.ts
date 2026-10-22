// Task 12.5c: the staff alert inbox API over a memory `safetyAlerts` repo (no database; rule 4).
// The memory repo keeps the real one's rules (staff-only reads and writes, an `acknowledge` that
// is a no-op once already acknowledged, one `safety_alert.ack` audit row per real ack), so the
// role boundary, the error mapping, the overdue backstop and the audit write are all checked
// here; route.int.test.ts re-runs the same handlers over a real Postgres. The staff id always
// comes from the session, never the body.
import { RepositoryError, type Repositories, type SafetyAlertRow } from '@edmate/db';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { createGuard, type CookieReader, type Principal, type RoleContext } from '../../../../src/auth/guard';
import { MAX_BODY_BYTES } from '../../../../src/studio/routes';
import { createStaffAlertHandlers } from './handlers';

const ORIGIN = 'http://localhost:8080';
const PATH = '/api/staff/alerts';
const STAFF: Principal = { userId: 'stf_1', role: 'staff' };
const WHO: Record<string, Principal> = {
  staff: STAFF,
  student: { userId: 'stu_1', role: 'student' },
  teacher: { userId: 'tch_a', role: 'teacher' },
};
const NOW = new Date('2026-10-22T11:00:00.000Z').getTime();
const FOURTEEN_MIN_AGO = new Date(NOW - 14 * 60_000).toISOString();
const SIXTEEN_MIN_AGO = new Date(NOW - 16 * 60_000).toISOString();

interface Audit {
  alertId: string;
  actor: string;
  action: string;
  note?: string;
}

function row(o: Partial<SafetyAlertRow> & { id: string }): SafetyAlertRow {
  return {
    level: 'alert',
    kind: 'distress',
    studentId: 'stu_1',
    teacherId: 'tch_a',
    sessionId: 'ses_1',
    teacherSlug: 'asha-math',
    excerptRedacted: 'synthetic excerpt',
    createdAt: FOURTEEN_MIN_AGO,
    receivedAt: FOURTEEN_MIN_AGO,
    escalatedAt: null,
    escalationRound: 0,
    lastPagedAt: null,
    acknowledgedAt: null,
    acknowledgedBy: null,
    ackNote: null,
    ...o,
  };
}

/** A memory safetyAlerts repo with the real one's role, ordering and audit rules. */
function memory() {
  const roles = new Map<string, string>([
    ['stf_1', 'staff'],
    ['stu_1', 'student'],
    ['tch_a', 'teacher'],
  ]);
  const rows = new Map<string, SafetyAlertRow>();
  const order: string[] = [];
  const add = (r: SafetyAlertRow) => {
    rows.set(r.id, r);
    order.push(r.id);
  };
  add(row({ id: 'alr_1', createdAt: FOURTEEN_MIN_AGO }));
  add(row({ id: 'alr_2', createdAt: SIXTEEN_MIN_AGO, escalatedAt: SIXTEEN_MIN_AGO, escalationRound: 1 }));
  const audits: Audit[] = [];
  const safetyAlerts = {
    listForStaff: vi.fn(
      async (by: unknown, options: { status: 'open' | 'all'; limit: number }): Promise<SafetyAlertRow[]> => {
        const m = 'safetyAlerts.listForStaff';
        if (typeof by !== 'string' || by === '') throw new RepositoryError('invalid', m);
        if (roles.get(by) !== 'staff') throw new RepositoryError('scope', m);
        const list = order
          .map((id) => rows.get(id)!)
          .filter((r) => options.status === 'all' || r.acknowledgedAt === null);
        return list.slice(0, options.limit);
      },
    ),
    acknowledge: vi.fn(
      async (
        by: unknown,
        input: { alertId: string; note?: string },
      ): Promise<{ acknowledged: boolean }> => {
        const m = 'safetyAlerts.acknowledge';
        if (typeof by !== 'string' || by === '') throw new RepositoryError('invalid', m);
        if (roles.get(by) !== 'staff') throw new RepositoryError('scope', m);
        const current = rows.get(input.alertId);
        if (!current) throw new RepositoryError('not_found', m);
        if (current.acknowledgedAt !== null) return { acknowledged: false };
        rows.set(input.alertId, {
          ...current,
          acknowledgedAt: new Date(NOW).toISOString(),
          acknowledgedBy: by,
          ackNote: input.note ?? null,
        });
        audits.push({
          alertId: input.alertId,
          actor: by,
          action: 'safety_alert.ack',
          ...(input.note === undefined ? {} : { note: input.note }),
        });
        return { acknowledged: true };
      },
    ),
  };
  const logs: string[] = [];
  const repos = { safetyAlerts } as unknown as Pick<Repositories, 'safetyAlerts'>;
  const h = createStaffAlertHandlers({
    repos: () => repos,
    log: (line) => logs.push(line),
    now: () => NOW,
  });
  return { h, roles, rows, audits, logs, safetyAlerts };
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
const get = (query = ''): NextRequest => new NextRequest(`${ORIGIN}${PATH}${query}`, { method: 'GET' });

async function codeOf(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

describe('GET: the alert inbox', () => {
  it('lists open alerts for the session staff user, escalated/overdue computed, no-store', async () => {
    const m = memory();
    const res = await m.h.list(get(), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as { alerts: { id: string; overdue: boolean; escalatedAt: string | null }[] };
    expect(body.alerts.map((a) => a.id)).toEqual(['alr_1', 'alr_2']);
    expect(body.alerts[0]).toMatchObject({ overdue: false, escalatedAt: null });
    expect(body.alerts[1]).toMatchObject({ overdue: true, escalatedAt: SIXTEEN_MIN_AGO });
    expect(m.safetyAlerts.listForStaff).toHaveBeenCalledWith('stf_1', { status: 'open', limit: 50 });
  });

  it('?status=all includes acknowledged alerts too', async () => {
    const m = memory();
    await m.h.acknowledge(post({ alertId: 'alr_1' }), ctx());
    const res = await m.h.list(get('?status=all'), ctx());
    const body = (await res.json()) as { alerts: { id: string }[] };
    expect(body.alerts.map((a) => a.id)).toEqual(['alr_1', 'alr_2']);
  });

  it('an unknown status is 400 validation', async () => {
    const m = memory();
    const res = await m.h.list(get('?status=closed'), ctx());
    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe('validation');
  });

  it.each([
    ['scope', 403, 'forbidden'],
    ['invalid', 403, 'forbidden'],
    ['not_found', 403, 'forbidden'],
    ['integrity', 500, 'provider_error'],
    ['failed', 500, 'provider_error'],
  ] as const)('a repository %s is %i %s, with no raw error text', async (kind, status, code) => {
    const m = memory();
    m.safetyAlerts.listForStaff.mockRejectedValueOnce(new RepositoryError(kind, 'safetyAlerts.listForStaff'));
    const res = await m.h.list(get(), ctx());
    expect(res.status).toBe(status);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ error: { code } });
    expect(text).not.toContain('safetyAlerts');
  });

  it('an unexpected throw is 500 and logs only the error name', async () => {
    const m = memory();
    m.safetyAlerts.listForStaff.mockRejectedValueOnce(new TypeError('secret detail person@example.test'));
    const res = await m.h.list(get(), ctx());
    expect(res.status).toBe(500);
    expect(await codeOf(res)).toBe('provider_error');
    expect(m.logs).toEqual(['[staff] alerts.list failed: TypeError']);
  });

  it('a former staff user (role changed after sign-in) is 403', async () => {
    const m = memory();
    m.roles.set('stf_1', 'student');
    const res = await m.h.list(get(), ctx());
    expect(res.status).toBe(403);
  });
});

describe('POST: acknowledge', () => {
  it('acknowledges with the session as `by`, one safety_alert.ack audit row', async () => {
    const m = memory();
    const res = await m.h.acknowledge(post({ alertId: 'alr_1' }), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ alertId: 'alr_1', acknowledged: true });
    expect(m.safetyAlerts.acknowledge).toHaveBeenCalledWith('stf_1', { alertId: 'alr_1' });
    expect(m.audits).toEqual([{ alertId: 'alr_1', actor: 'stf_1', action: 'safety_alert.ack' }]);
  });

  it('acknowledges with a note (trimmed); the note lands in the audit row', async () => {
    const m = memory();
    const res = await m.h.acknowledge(post({ alertId: 'alr_1', note: '  followed up  ' }), ctx());
    expect(res.status).toBe(200);
    expect(m.safetyAlerts.acknowledge).toHaveBeenCalledWith('stf_1', { alertId: 'alr_1', note: 'followed up' });
    expect(m.audits).toEqual([
      { alertId: 'alr_1', actor: 'stf_1', action: 'safety_alert.ack', note: 'followed up' },
    ]);
  });

  it('a second ack is a no-op: acknowledged: false, no new audit row', async () => {
    const m = memory();
    await m.h.acknowledge(post({ alertId: 'alr_1' }), ctx());
    const res = await m.h.acknowledge(post({ alertId: 'alr_1' }), ctx());
    expect(await res.json()).toEqual({ alertId: 'alr_1', acknowledged: false });
    expect(m.audits).toHaveLength(1);
  });

  it('a body `by` (or any unknown key) is 400 and never reaches the repo', async () => {
    const m = memory();
    for (const extra of [{ by: 'stf_2' }, { userId: 'stf_2' }, { acknowledgedBy: 'stf_2' }]) {
      const res = await m.h.acknowledge(post({ alertId: 'alr_1', ...extra }), ctx());
      expect(res.status).toBe(400);
      expect(await codeOf(res)).toBe('validation');
    }
    expect(m.safetyAlerts.acknowledge).not.toHaveBeenCalled();
    expect(m.audits).toEqual([]);
  });

  it.each([
    ['missing alertId', {}],
    ['empty alertId', { alertId: '' }],
    ['numeric alertId', { alertId: 7 }],
    ['blank note', { alertId: 'alr_1', note: '   ' }],
    ['note too long', { alertId: 'alr_1', note: 'x'.repeat(501) }],
    ['not an object', ['alr_1']],
    ['null', null],
  ])('%s is 400 validation', async (_label, body) => {
    const m = memory();
    const res = await m.h.acknowledge(post(body), ctx());
    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe('validation');
    expect(m.safetyAlerts.acknowledge).not.toHaveBeenCalled();
  });

  it('a note at the cap is accepted', async () => {
    const m = memory();
    const res = await m.h.acknowledge(post({ alertId: 'alr_1', note: 'x'.repeat(500) }), ctx());
    expect(res.status).toBe(200);
  });

  it('malformed JSON is 400; an oversize body is 413; neither reaches the repo', async () => {
    const m = memory();
    expect((await m.h.acknowledge(post(null, '{not json'), ctx())).status).toBe(400);
    const big = post({ alertId: 'alr_1', note: 'x'.repeat(MAX_BODY_BYTES) });
    const res = await m.h.acknowledge(big, ctx());
    expect(res.status).toBe(413);
    expect(await codeOf(res)).toBe('input_too_large');
    expect(m.safetyAlerts.acknowledge).not.toHaveBeenCalled();
  });

  it.each([
    ['scope', 403, 'forbidden'],
    ['not_found', 404, 'not_found'],
    ['invalid', 400, 'validation'],
    ['integrity', 400, 'validation'],
    ['failed', 500, 'provider_error'],
  ] as const)('a repository %s is %i %s, no raw text, no-store', async (kind, status, code) => {
    const m = memory();
    m.safetyAlerts.acknowledge.mockRejectedValueOnce(new RepositoryError(kind, 'safetyAlerts.acknowledge'));
    const res = await m.h.acknowledge(post({ alertId: 'alr_1' }), ctx());
    expect(res.status).toBe(status);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ error: { code } });
    expect(text).not.toContain('safetyAlerts');
  });

  it('an unknown alert is 404', async () => {
    const m = memory();
    const res = await m.h.acknowledge(post({ alertId: 'alr_zz' }), ctx());
    expect(res.status).toBe(404);
  });

  it('an unexpected throw is 500 and logs only the error name (a non-Error too)', async () => {
    const m = memory();
    m.safetyAlerts.acknowledge.mockRejectedValueOnce(new Error('pg says person@example.test'));
    expect((await m.h.acknowledge(post({ alertId: 'alr_1' }), ctx())).status).toBe(500);
    m.safetyAlerts.acknowledge.mockRejectedValueOnce('nope');
    expect((await m.h.acknowledge(post({ alertId: 'alr_1' }), ctx())).status).toBe(500);
    expect(m.logs).toEqual([
      '[staff] alerts.acknowledge failed: Error',
      '[staff] alerts.acknowledge failed: non-error',
    ]);
  });

  it('the default logger writes to console.error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const repos = {
      safetyAlerts: { listForStaff: async () => Promise.reject(new RangeError('x')) },
    } as unknown as Pick<Repositories, 'safetyAlerts'>;
    const h = createStaffAlertHandlers({ repos: () => repos });
    expect((await h.list(get(), ctx())).status).toBe(500);
    expect(spy).toHaveBeenCalledWith('[staff] alerts.list failed: RangeError');
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
      POST: guard.withRole(['staff'], m.h.acknowledge),
    };
  }
  const call = (method: 'GET' | 'POST', who: string | null, origin = ORIGIN) =>
    new NextRequest(`${ORIGIN}${PATH}`, {
      method,
      headers: {
        ...(who ? { cookie: `who=${who}` } : {}),
        ...(method === 'POST' ? { origin, 'content-type': 'application/json' } : {}),
      },
      ...(method === 'POST' ? { body: JSON.stringify({ alertId: 'alr_1' }) } : {}),
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
    expect(g.safetyAlerts.listForStaff).not.toHaveBeenCalled();
    expect(g.safetyAlerts.acknowledge).not.toHaveBeenCalled();
    expect(g.audits).toEqual([]);
  });

  it('staff GET is 200 and staff POST writes the audit row', async () => {
    const g = guarded();
    expect((await g.GET(call('GET', 'staff'))).status).toBe(200);
    const res = await g.POST(call('POST', 'staff'));
    expect(res.status).toBe(200);
    expect(g.audits).toEqual([{ alertId: 'alr_1', actor: 'stf_1', action: 'safety_alert.ack' }]);
  });

  it('a cross-site staff POST is 403 and writes nothing', async () => {
    const g = guarded();
    const res = await g.POST(call('POST', 'staff', 'https://evil.example'));
    expect(res.status).toBe(403);
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
