// Task 12.2d: the staff takedowns API over a memory `takedowns` repo (no database; rule 4). The
// memory repo keeps the real one's rules (staff-only reads and writes, at most one active takedown
// per target, audited create/lift), so the role boundary, the discriminated body and the error
// mapping are all checked here; route.int.test.ts re-runs the real handlers over a real Postgres.
// The staff id always comes from the session, never the body.
import { RepositoryError, type Repositories, type StaffTakedownRow } from '@edmate/db';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { createGuard, type CookieReader, type Principal, type RoleContext } from '../../../../src/auth/guard';
import { MAX_BODY_BYTES } from '../../../../src/studio/routes';
import { createStaffTakedownsHandlers, MAX_NOTE_CHARS } from './handlers';

const ORIGIN = 'http://localhost:8080';
const PATH = '/api/staff/takedowns';
const STAFF: Principal = { userId: 'stf_1', role: 'staff' };
const WHO: Record<string, Principal> = {
  staff: STAFF,
  student: { userId: 'stu_1', role: 'student' },
  teacher: { userId: 'tch_a', role: 'teacher' },
};

interface Audit {
  target: string;
  actor: string;
  action: 'create' | 'lift';
}

function row(id: string, targetId: string): StaffTakedownRow {
  return {
    id,
    kind: 'document',
    targetId,
    teacherId: 'tch_a',
    teacherSlug: 'asha-math',
    category: 'copyright',
    createdAt: '2026-10-22T00:00:00.000Z',
  };
}

/** A memory `takedowns` repo with the real one's role, one-active-per-target and audit rules. */
function memory() {
  const roles = new Map<string, string>([
    ['stf_1', 'staff'],
    ['stf_2', 'staff'],
    ['stu_1', 'student'],
    ['tch_a', 'teacher'],
  ]);
  const targets = new Map<string, boolean>([
    ['doc_a', true],
    ['doc_b', true],
    ['agt_a', true],
  ]);
  const active = new Map<string, StaffTakedownRow>([['td_a', row('td_a', 'doc_a')]]);
  const audits: Audit[] = [];
  let n = 1;
  const takedowns = {
    listActiveForStaff: vi.fn(async (by: unknown): Promise<StaffTakedownRow[]> => {
      if (typeof by !== 'string' || by === '') {
        throw new RepositoryError('invalid', 'takedowns.listActiveForStaff');
      }
      if (roles.get(by) !== 'staff') throw new RepositoryError('scope', 'takedowns.listActiveForStaff');
      return [...active.values()];
    }),
    create: vi.fn(
      async (
        by: unknown,
        input: { kind: 'document' | 'agent'; targetId: string; category: string },
      ): Promise<{ id: string }> => {
        const method = 'takedowns.create';
        if (typeof by !== 'string' || by === '') throw new RepositoryError('invalid', method);
        if (roles.get(by) !== 'staff') throw new RepositoryError('scope', method);
        if (!targets.get(input.targetId)) throw new RepositoryError('not_found', method);
        const target = `${input.kind}:${input.targetId}`;
        for (const r of active.values()) {
          if (`${r.kind}:${r.targetId}` === target) throw new RepositoryError('invalid', method);
        }
        const id = `td_${++n}`;
        active.set(id, row(id, input.targetId));
        audits.push({ target, actor: by, action: 'create' });
        return { id };
      },
    ),
    lift: vi.fn(async (by: unknown, takedownId: unknown): Promise<{ id: string; status: 'lifted' }> => {
      const method = 'takedowns.lift';
      if (typeof by !== 'string' || by === '') throw new RepositoryError('invalid', method);
      if (roles.get(by) !== 'staff') throw new RepositoryError('scope', method);
      if (typeof takedownId !== 'string' || !active.has(takedownId)) {
        throw new RepositoryError('not_found', method);
      }
      const found = active.get(takedownId)!;
      active.delete(takedownId);
      audits.push({ target: `${found.kind}:${found.targetId}`, actor: by, action: 'lift' });
      return { id: takedownId, status: 'lifted' };
    }),
  };
  const logs: string[] = [];
  const repos = { takedowns } as unknown as Pick<Repositories, 'takedowns'>;
  const h = createStaffTakedownsHandlers({ repos: () => repos, log: (line) => logs.push(line) });
  return { h, roles, targets, active, audits, logs, takedowns };
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

describe('GET: active takedowns', () => {
  it('lists active takedowns for the session staff user, no-store', async () => {
    const m = memory();
    const res = await m.h.list(get(), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ takedowns: [row('td_a', 'doc_a')] });
    expect(m.takedowns.listActiveForStaff).toHaveBeenCalledWith('stf_1');
  });

  it.each([
    ['scope', 403, 'forbidden'],
    ['invalid', 403, 'forbidden'],
    ['not_found', 500, 'provider_error'],
    ['integrity', 500, 'provider_error'],
    ['failed', 500, 'provider_error'],
  ] as const)('a repository %s is %i %s, with no raw error text', async (kind, status, code) => {
    const m = memory();
    m.takedowns.listActiveForStaff.mockRejectedValueOnce(
      new RepositoryError(kind, 'takedowns.listActiveForStaff'),
    );
    const res = await m.h.list(get(), ctx());
    expect(res.status).toBe(status);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ error: { code } });
    expect(text).not.toContain('takedowns.listActiveForStaff');
  });

  it('an unexpected throw is 500 and logs only the error name', async () => {
    const m = memory();
    m.takedowns.listActiveForStaff.mockRejectedValueOnce(new TypeError('x'));
    const res = await m.h.list(get(), ctx());
    expect(res.status).toBe(500);
    expect(m.logs).toEqual(['[staff] takedowns.list failed: TypeError']);
  });
});

describe('POST create: take down a document or an agent', () => {
  it('creates a document takedown; the staff id is the session, audited', async () => {
    const m = memory();
    const res = await m.h.act(
      post({ action: 'create', kind: 'document', targetId: 'doc_b', category: 'copyright' }),
      ctx(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ id: 'td_2', status: 'active' });
    expect(m.takedowns.create).toHaveBeenCalledWith('stf_1', {
      kind: 'document',
      targetId: 'doc_b',
      category: 'copyright',
    });
    expect(m.audits).toEqual([{ target: 'document:doc_b', actor: 'stf_1', action: 'create' }]);
  });

  it('creates an agent takedown with an optional reportId and note', async () => {
    const m = memory();
    const res = await m.h.act(
      post({
        action: 'create',
        kind: 'agent',
        targetId: 'agt_a',
        category: 'harmful',
        reportId: 'rp_a',
        note: '  took down the agent  ',
      }),
      ctx(),
    );
    expect(res.status).toBe(200);
    expect(m.takedowns.create).toHaveBeenCalledWith('stf_1', {
      kind: 'agent',
      targetId: 'agt_a',
      category: 'harmful',
      reportId: 'rp_a',
      note: 'took down the agent',
    });
  });

  it('a body `by` (or any unknown key) is 400 and never reaches the repo', async () => {
    const m = memory();
    for (const extra of [{ by: 'stf_2' }, { userId: 'stf_2' }]) {
      const res = await m.h.act(
        post({ action: 'create', kind: 'document', targetId: 'doc_a', category: 'copyright', ...extra }),
        ctx(),
      );
      expect(res.status).toBe(400);
      expect(await codeOf(res)).toBe('validation');
    }
    expect(m.takedowns.create).not.toHaveBeenCalled();
    expect(m.audits).toEqual([]);
  });

  it.each([
    ['missing action', { kind: 'document', targetId: 'doc_a', category: 'copyright' }],
    ['unknown action', { action: 'delete', kind: 'document', targetId: 'doc_a', category: 'copyright' }],
    ['bad kind', { action: 'create', kind: 'teacher', targetId: 'doc_a', category: 'copyright' }],
    ['missing targetId', { action: 'create', kind: 'document', category: 'copyright' }],
    ['empty targetId', { action: 'create', kind: 'document', targetId: '', category: 'copyright' }],
    ['bad category', { action: 'create', kind: 'document', targetId: 'doc_a', category: 'spam' }],
    [
      'blank note',
      { action: 'create', kind: 'document', targetId: 'doc_a', category: 'copyright', note: '  ' },
    ],
    [
      'note too long',
      {
        action: 'create',
        kind: 'document',
        targetId: 'doc_a',
        category: 'copyright',
        note: 'x'.repeat(MAX_NOTE_CHARS + 1),
      },
    ],
    ['not an object', ['create', 'doc_a']],
    ['null', null],
  ])('%s is 400 validation', async (_label, body) => {
    const m = memory();
    const res = await m.h.act(post(body), ctx());
    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe('validation');
    expect(m.takedowns.create).not.toHaveBeenCalled();
    expect(m.takedowns.lift).not.toHaveBeenCalled();
  });

  it('a lift body with a create-only key (kind, category) is 400', async () => {
    const m = memory();
    const res = await m.h.act(post({ action: 'lift', takedownId: 'td_a', kind: 'document' }), ctx());
    expect(res.status).toBe(400);
  });

  it('malformed JSON is 400; an oversize body is 413; neither reaches the repo', async () => {
    const m = memory();
    expect((await m.h.act(post(null, '{not json'), ctx())).status).toBe(400);
    const big = post({
      action: 'create',
      kind: 'document',
      targetId: 'doc_a',
      category: 'copyright',
      note: 'x'.repeat(MAX_BODY_BYTES),
    });
    const res = await m.h.act(big, ctx());
    expect(res.status).toBe(413);
    expect(await codeOf(res)).toBe('input_too_large');
    expect(m.takedowns.create).not.toHaveBeenCalled();
  });

  it('a missing target is 404; an already-taken-down target is 400 (second attempt)', async () => {
    const m = memory();
    const missing = await m.h.act(
      post({ action: 'create', kind: 'document', targetId: 'doc_zz', category: 'copyright' }),
      ctx(),
    );
    expect(missing.status).toBe(404);
    const dup = await m.h.act(
      post({ action: 'create', kind: 'document', targetId: 'doc_a', category: 'copyright' }),
      ctx(),
    );
    expect(dup.status).toBe(400);
    expect(await codeOf(dup)).toBe('validation');
  });

  it.each([
    ['scope', 403, 'forbidden'],
    ['not_found', 404, 'not_found'],
    ['invalid', 400, 'validation'],
    ['integrity', 400, 'validation'],
    ['failed', 500, 'provider_error'],
  ] as const)('a repository %s is %i %s, no raw text, no-store', async (kind, status, code) => {
    const m = memory();
    m.takedowns.create.mockRejectedValueOnce(new RepositoryError(kind, 'takedowns.create'));
    const res = await m.h.act(
      post({ action: 'create', kind: 'document', targetId: 'doc_a', category: 'copyright' }),
      ctx(),
    );
    expect(res.status).toBe(status);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ error: { code } });
    expect(text).not.toContain('takedowns.create');
  });
});

describe('POST lift: restore a takedown', () => {
  it('lifts; the staff id is the session, audited; the entry leaves the active list', async () => {
    const m = memory();
    const res = await m.h.act(post({ action: 'lift', takedownId: 'td_a' }), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'td_a', status: 'lifted' });
    expect(m.takedowns.lift).toHaveBeenCalledWith('stf_1', 'td_a', {});
    expect(m.audits).toEqual([{ target: 'document:doc_a', actor: 'stf_1', action: 'lift' }]);
    const list = (await (await m.h.list(get(), ctx())).json()) as { takedowns: StaffTakedownRow[] };
    expect(list.takedowns).toEqual([]);
  });

  it('lifts with a note', async () => {
    const m = memory();
    await m.h.act(post({ action: 'lift', takedownId: 'td_a', note: 'reinstated' }), ctx());
    expect(m.takedowns.lift).toHaveBeenCalledWith('stf_1', 'td_a', { note: 'reinstated' });
  });

  it('a missing or already-lifted takedown is 404', async () => {
    const m = memory();
    expect((await m.h.act(post({ action: 'lift', takedownId: 'td_zz' }), ctx())).status).toBe(404);
    await m.h.act(post({ action: 'lift', takedownId: 'td_a' }), ctx());
    expect((await m.h.act(post({ action: 'lift', takedownId: 'td_a' }), ctx())).status).toBe(404);
  });

  it.each([
    ['scope', 403, 'forbidden'],
    ['not_found', 404, 'not_found'],
    ['invalid', 400, 'validation'],
    ['integrity', 400, 'validation'],
    ['failed', 500, 'provider_error'],
  ] as const)('a repository %s is %i %s, no raw text, no-store', async (kind, status, code) => {
    const m = memory();
    m.takedowns.lift.mockRejectedValueOnce(new RepositoryError(kind, 'takedowns.lift'));
    const res = await m.h.act(post({ action: 'lift', takedownId: 'td_a' }), ctx());
    expect(res.status).toBe(status);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ error: { code } });
    expect(text).not.toContain('takedowns.lift');
  });

  it('an unexpected throw is 500 and logs only the error name (a non-Error too)', async () => {
    const m = memory();
    m.takedowns.lift.mockRejectedValueOnce(new Error('pg says person@example.test'));
    expect((await m.h.act(post({ action: 'lift', takedownId: 'td_a' }), ctx())).status).toBe(500);
    m.takedowns.lift.mockRejectedValueOnce('nope');
    expect((await m.h.act(post({ action: 'lift', takedownId: 'td_a' }), ctx())).status).toBe(500);
    expect(m.logs).toEqual([
      '[staff] takedowns.act failed: Error',
      '[staff] takedowns.act failed: non-error',
    ]);
  });

  it('the default logger writes to console.error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const repos = {
      takedowns: { listActiveForStaff: async () => Promise.reject(new RangeError('x')) },
    } as unknown as Pick<Repositories, 'takedowns'>;
    const h = createStaffTakedownsHandlers({ repos: () => repos });
    expect((await h.list(get(), ctx())).status).toBe(500);
    expect(spy).toHaveBeenCalledWith('[staff] takedowns.list failed: RangeError');
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
      POST: guard.withRole(['staff'], m.h.act),
    };
  }
  const call = (method: 'GET' | 'POST', who: string | null, origin = ORIGIN) =>
    new NextRequest(`${ORIGIN}${PATH}`, {
      method,
      headers: {
        ...(who ? { cookie: `who=${who}` } : {}),
        ...(method === 'POST' ? { origin, 'content-type': 'application/json' } : {}),
      },
      ...(method === 'POST' ? { body: JSON.stringify({ action: 'lift', takedownId: 'td_a' }) } : {}),
    });

  it('signed-out is 401; student and teacher are 403 on GET and POST, nothing written', async () => {
    const g = guarded();
    expect((await g.GET(call('GET', null))).status).toBe(401);
    expect((await g.POST(call('POST', null))).status).toBe(401);
    for (const who of ['student', 'teacher']) {
      expect((await g.GET(call('GET', who))).status).toBe(403);
      expect((await g.POST(call('POST', who))).status).toBe(403);
    }
    expect(g.audits).toEqual([]);
  });

  it('a cross-site staff POST is 403 and writes nothing', async () => {
    const g = guarded();
    const res = await g.POST(call('POST', 'staff', 'https://evil.example'));
    expect(res.status).toBe(403);
    expect(g.audits).toEqual([]);
  });

  it('staff can list and act through the real guard', async () => {
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
