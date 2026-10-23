// Task 11.2b: POST /api/live-classes/[id]/questions over a memory backend (no database; rule 4).
// The route only knows the live class's id and the session's own student; `teacherId` is resolved
// by trying the distinct teachers of the student's own live subscriptions in turn (task 9.4d; see
// handlers.ts) -- `EDMATE_CHAT_AGENTS` plays no part. A mismatched teacher, an unentitled student and a class that has already started
// all read alike: `not_found`, nothing written.
import { RepositoryError } from '@edmate/db';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { createGuard, type CookieReader, type Principal, type RoleContext } from '../../../../../src/auth/guard';
import { createAskQuestionHandlers, MAX_BODY_BYTES } from './handlers';

const ORIGIN = 'http://localhost:8080';
const path = (id: string) => `/api/live-classes/${id}/questions`;
const STUDENT: Principal = { userId: 'stu_1', role: 'student' };

const ctx = (params: Record<string, string>, principal: Principal = STUDENT): RoleContext => ({
  principal,
  params: Promise.resolve(params),
});

function post(id: string, body: unknown, raw?: string): NextRequest {
  return new NextRequest(`${ORIGIN}${path(id)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: raw ?? JSON.stringify(body),
  });
}

async function codeOf(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

type Live = { agentId: string; teacherId: string; status: 'trial' | 'active' | 'past_due' | 'paused' | 'ended' };

/** A memory backend: `stu_1` has a live subscription to `tch_a` (agent `agt_a`); `submit` accepts
 * only `lc_1`, for `studentId === 'stu_1'` and `teacherId === 'tch_a'`, matching 11.2a's shape. */
function memory(live: readonly Live[] = [{ agentId: 'agt_a', teacherId: 'tch_a', status: 'active' }]) {
  const submit = vi.fn(
    async (scope: { studentId: string; teacherId: string }, input: { liveClassId: string; text: string }) => {
      if (scope.teacherId !== 'tch_a' || scope.studentId !== 'stu_1' || input.liveClassId !== 'lc_1') {
        throw new RepositoryError('not_found', 'classQuestions.submit');
      }
      return { id: 'cq_1' };
    },
  );
  const listLiveForStudent = vi.fn(async (studentId: string) => (studentId === 'stu_1' ? [...live] : []));
  const h = createAskQuestionHandlers({
    classQuestions: { submit },
    subscriptions: { listLiveForStudent },
  });
  return { h, submit, listLiveForStudent };
}

describe('POST /api/live-classes/[id]/questions', () => {
  it('a happy-path submission is 200 with the new id', async () => {
    const m = memory();
    const res = await m.h.post(post('lc_1', { text: 'What is a ratio?' }), ctx({ id: 'lc_1' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ id: 'cq_1' });
    expect(m.submit).toHaveBeenCalledWith(
      { studentId: 'stu_1', teacherId: 'tch_a' },
      { liveClassId: 'lc_1', text: 'What is a ratio?' },
    );
  });

  it('trims the text before sending it on', async () => {
    const m = memory();
    await m.h.post(post('lc_1', { text: '  What is a ratio?  ' }), ctx({ id: 'lc_1' }));
    expect(m.submit).toHaveBeenCalledWith(expect.anything(), {
      liveClassId: 'lc_1',
      text: 'What is a ratio?',
    });
  });

  it('a class id that is not the caller\'s upcoming class is 404, nothing written', async () => {
    const m = memory();
    const res = await m.h.post(post('lc_other', { text: 'hi' }), ctx({ id: 'lc_other' }));
    expect(res.status).toBe(404);
    expect(await codeOf(res)).toBe('not_found');
  });

  it('a live subscription to a teacher not in EDMATE_CHAT_AGENTS can ask (9.4d)', async () => {
    const prev = process.env.EDMATE_CHAT_AGENTS;
    process.env.EDMATE_CHAT_AGENTS = 'agt_other';
    try {
      const m = memory([{ agentId: 'agt_not_configured', teacherId: 'tch_a', status: 'past_due' }]);
      const res = await m.h.post(post('lc_1', { text: 'hi' }), ctx({ id: 'lc_1' }));
      expect(res.status).toBe(200);
      expect(m.listLiveForStudent).toHaveBeenCalledWith('stu_1');
      expect(m.submit).toHaveBeenCalledWith({ studentId: 'stu_1', teacherId: 'tch_a' }, expect.anything());
    } finally {
      if (prev === undefined) delete process.env.EDMATE_CHAT_AGENTS;
      else process.env.EDMATE_CHAT_AGENTS = prev;
    }
  });

  it('a paused subscription still resolves its teacher (paused classes show on /home)', async () => {
    const m = memory([{ agentId: 'agt_a', teacherId: 'tch_a', status: 'paused' }]);
    const res = await m.h.post(post('lc_1', { text: 'hi' }), ctx({ id: 'lc_1' }));
    expect(res.status).toBe(200);
  });

  it('a student with no live subscription is 404, nothing written', async () => {
    const m = memory([]);
    const res = await m.h.post(post('lc_1', { text: 'hi' }), ctx({ id: 'lc_1' }));
    expect(res.status).toBe(404);
    expect(await codeOf(res)).toBe('not_found');
    expect(m.submit).not.toHaveBeenCalled();
  });

  it('only the signed-in student\'s own subscriptions are read (another student is 404)', async () => {
    const m = memory();
    const other: Principal = { userId: 'stu_2', role: 'student' };
    const res = await m.h.post(post('lc_1', { text: 'hi' }), ctx({ id: 'lc_1' }, other));
    expect(res.status).toBe(404);
    expect(m.listLiveForStudent).toHaveBeenCalledWith('stu_2');
    expect(m.submit).not.toHaveBeenCalled();
  });

  it('an ended row is skipped', async () => {
    const m = memory([{ agentId: 'agt_a', teacherId: 'tch_a', status: 'ended' }]);
    const res = await m.h.post(post('lc_1', { text: 'hi' }), ctx({ id: 'lc_1' }));
    expect(res.status).toBe(404);
    expect(m.submit).not.toHaveBeenCalled();
  });

  it('a subscription only to a different class\'s teacher is 404; each teacher tried once', async () => {
    const m = memory([
      { agentId: 'agt_b', teacherId: 'tch_b', status: 'active' },
      { agentId: 'agt_b2', teacherId: 'tch_b', status: 'trial' },
      { agentId: 'agt_c', teacherId: 'tch_c', status: 'active' },
    ]);
    const res = await m.h.post(post('lc_1', { text: 'hi' }), ctx({ id: 'lc_1' }));
    expect(res.status).toBe(404);
    expect(m.submit).toHaveBeenCalledTimes(2);
  });

  it('a subscription lookup failure is 500, no raw error text', async () => {
    const m = memory();
    m.listLiveForStudent.mockRejectedValueOnce(new Error('pg says secret@example.test'));
    const res = await m.h.post(post('lc_1', { text: 'hi' }), ctx({ id: 'lc_1' }));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('secret@example.test');
  });

  it.each([
    ['empty text', { text: '' }],
    ['blank text', { text: '   ' }],
    ['missing text', {}],
    ['extra key', { text: 'hi', studentId: 'stu_evil' }],
    ['not an object', ['hi']],
    ['null', null],
  ])('%s is 400 validation, nothing written', async (_label, body) => {
    const m = memory();
    const res = await m.h.post(post('lc_1', body), ctx({ id: 'lc_1' }));
    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe('validation');
    expect(m.submit).not.toHaveBeenCalled();
  });

  it('malformed JSON is 400; an oversize body is 413; neither reaches the repo', async () => {
    const m = memory();
    expect((await m.h.post(post('lc_1', null, '{not json'), ctx({ id: 'lc_1' }))).status).toBe(400);
    const big = post('lc_1', { text: 'x'.repeat(MAX_BODY_BYTES) });
    const res = await m.h.post(big, ctx({ id: 'lc_1' }));
    expect(res.status).toBe(413);
    expect(await codeOf(res)).toBe('input_too_large');
    expect(m.submit).not.toHaveBeenCalled();
  });

  it('a missing or empty [id] param is 404, no raw text leaks', async () => {
    const m = memory();
    const res = await m.h.post(post('lc_1', { text: 'hi' }), ctx({}));
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).not.toContain('classQuestions');
    expect(m.submit).not.toHaveBeenCalled();
  });

  it('an unexpected repository error is 500, no raw error text', async () => {
    const m = memory();
    m.submit.mockRejectedValueOnce(new Error('pg says secret@example.test'));
    const res = await m.h.post(post('lc_1', { text: 'hi' }), ctx({ id: 'lc_1' }));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ error: { code: 'provider_error' } });
    expect(text).not.toContain('secret@example.test');
  });
});

describe('through the real guard and ROUTE_POLICY', () => {
  function guarded() {
    const m = memory();
    const who: Record<string, Principal> = {
      student: STUDENT,
      teacher: { userId: 'tch_a', role: 'teacher' },
      staff: { userId: 'stf_1', role: 'staff' },
    };
    const guard = createGuard(
      () => ({
        getPrincipal: async (c: CookieReader) => who[c.get('who')?.value ?? ''] ?? null,
        learnerStatus: async () => 'clear',
        allowedOrigin: ORIGIN,
      }),
      () => {
        throw new Error('not a page');
      },
    );
    return { ...m, POST: guard.withRole(['student'], m.h.post) };
  }

  const call = (id: string, who: string | null, origin = ORIGIN) =>
    new NextRequest(`${ORIGIN}${path(id)}`, {
      method: 'POST',
      headers: {
        ...(who ? { cookie: `who=${who}` } : {}),
        origin,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ text: 'hi' }),
    });

  it.each([
    [null, 401],
    ['teacher', 403],
    ['staff', 403],
  ])('as %s is %i, nothing written', async (who, status) => {
    const g = guarded();
    const res = await g.POST(call('lc_1', who), { params: Promise.resolve({ id: 'lc_1' }) });
    expect(res.status).toBe(status);
    expect(g.submit).not.toHaveBeenCalled();
  });

  it('a signed-in student is let through to the handler', async () => {
    const g = guarded();
    const res = await g.POST(call('lc_1', 'student'), { params: Promise.resolve({ id: 'lc_1' }) });
    expect(res.status).toBe(200);
  });

  it('a cross-site POST is 403 and writes nothing', async () => {
    const g = guarded();
    const res = await g.POST(call('lc_1', 'student', 'https://evil.example'), {
      params: Promise.resolve({ id: 'lc_1' }),
    });
    expect(res.status).toBe(403);
    expect(g.submit).not.toHaveBeenCalled();
  });
});

describe('route.ts', () => {
  it('exports POST guarded for students only', async () => {
    const { GUARD } = await import('../../../../../src/auth/guard');
    const route = await import('./route');
    expect((route.POST as unknown as Record<symbol, unknown>)[GUARD]).toEqual(['student']);
    expect(route.dynamic).toBe('force-dynamic');
  });
});
