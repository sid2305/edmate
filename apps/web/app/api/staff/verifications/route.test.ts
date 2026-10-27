// Task 12.1b: the staff verification API over a memory `teacherProfiles` repo (no database; rule 4).
// The memory repo keeps the real one's rules (staff-only reads and writes, not-self, a
// `teacher.verify` audit row per decision, publish only when verified), so the role boundary,
// the error mapping and the audit write are all checked here; route.int.test.ts re-runs the same
// handlers over a real Postgres. The staff id always comes from the session, never the body.
import {
  RepositoryError,
  type Repositories,
  type StaffTakedownRow,
  type TeacherProfileRow,
  type TeacherVerificationQueueRow,
} from '@edmate/db';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import {
  createGuard,
  type CookieReader,
  type Principal,
  type RoleContext,
} from '../../../../src/auth/guard';
import { MAX_BODY_BYTES } from '../../../../src/studio/routes';
import { createStaffVerificationHandlers, MAX_REASON_CHARS } from './handlers';

const ORIGIN = 'http://localhost:8080';
const PATH = '/api/staff/verifications';
const STAFF: Principal = { userId: 'stf_1', role: 'staff' };
const WHO: Record<string, Principal> = {
  staff: STAFF,
  student: { userId: 'stu_1', role: 'student' },
  teacher: { userId: 'tch_a', role: 'teacher' },
};

interface Audit {
  teacherId: string;
  actor: string;
  action: string;
  reason?: string;
  safety?: true;
  before: string;
  after: string;
}

/** A memory teacherProfiles repo with the real one's role, not-self, audit and publish rules. */
function memory() {
  const roles = new Map<string, string>([
    ['stf_1', 'staff'],
    ['stf_2', 'staff'],
    ['tch_a', 'teacher'],
    ['tch_b', 'teacher'],
    ['tch_c', 'teacher'],
  ]);
  // Task 9.3h: this teacher's active takedowns and last verify/reject decision (default empty).
  const activeTakedowns = new Map<string, StaffTakedownRow[]>();
  const lastDecisions = new Map<
    string,
    { status: 'verified' | 'rejected'; reason: string | null; ts: string }
  >();
  // Task 9.3m (B-58): this teacher's past subject changes, newest first (default empty).
  const subjectHistories = new Map<string, { from: string; to: string; ts: string }[]>();
  const profiles = new Map<string, TeacherProfileRow>();
  const order: string[] = [];
  const add = (teacherId: string, slug: string) => {
    profiles.set(teacherId, {
      id: `tp_${teacherId}`,
      teacherId,
      slug,
      displayName: 'Asha',
      subject: 'Math',
      bio: '',
      languages: [],
      verificationStatus: 'pending',
    });
    order.push(teacherId);
  };
  add('tch_a', 'asha-math');
  add('tch_b', 'ben-physics');
  add('tch_c', 'chen-chem');
  const audits: Audit[] = [];
  const teacherProfiles = {
    listPendingForStaff: vi.fn(async (by: unknown): Promise<TeacherVerificationQueueRow[]> => {
      if (typeof by !== 'string' || by === '') {
        throw new RepositoryError('invalid', 'teacherProfiles.listPendingForStaff');
      }
      if (roles.get(by) !== 'staff') {
        throw new RepositoryError('scope', 'teacherProfiles.listPendingForStaff');
      }
      return order
        .map((id) => profiles.get(id)!)
        .filter((p) => p.verificationStatus === 'pending')
        .map((p) => ({
          id: p.id,
          teacherId: p.teacherId,
          slug: p.slug,
          subject: p.subject,
          verificationStatus: p.verificationStatus,
          name: `Name ${p.teacherId}`,
          email: p.teacherId === 'tch_c' ? null : `${p.teacherId}@example.test`,
        }));
    }),
    findBySlugForStaff: vi.fn(
      async (by: unknown, slug: unknown): Promise<TeacherVerificationQueueRow | null> => {
        if (typeof by !== 'string' || by === '') {
          throw new RepositoryError('invalid', 'teacherProfiles.findBySlugForStaff');
        }
        if (typeof slug !== 'string' || slug === '') {
          throw new RepositoryError('invalid', 'teacherProfiles.findBySlugForStaff');
        }
        if (slug.length < 3 || slug.length > 60 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
          throw new RepositoryError('invalid', 'teacherProfiles.findBySlugForStaff');
        }
        if (roles.get(by) !== 'staff') {
          throw new RepositoryError('scope', 'teacherProfiles.findBySlugForStaff');
        }
        const p = order.map((id) => profiles.get(id)!).find((x) => x.slug === slug);
        if (!p) return null;
        return {
          id: p.id,
          teacherId: p.teacherId,
          slug: p.slug,
          subject: p.subject,
          verificationStatus: p.verificationStatus,
          name: `Name ${p.teacherId}`,
          email: p.teacherId === 'tch_c' ? null : `${p.teacherId}@example.test`,
        };
      },
    ),
    setVerification: vi.fn(
      async (
        scope: { teacherId: string },
        input: { status: 'verified' | 'rejected'; by: string; reason?: string; safety?: boolean },
      ): Promise<TeacherProfileRow> => {
        const m = 'teacherProfiles.setVerification';
        if (input.reason !== undefined && (input.reason.length < 1 || input.reason.length > 500)) {
          throw new RepositoryError('invalid', m);
        }
        if (input.by === scope.teacherId) throw new RepositoryError('scope', m);
        if (roles.get(input.by) !== 'staff') throw new RepositoryError('scope', m);
        const current = profiles.get(scope.teacherId);
        if (!current) throw new RepositoryError('not_found', m);
        const next = { ...current, verificationStatus: input.status };
        profiles.set(scope.teacherId, next);
        audits.push({
          teacherId: scope.teacherId,
          actor: input.by,
          action: 'teacher.verify',
          ...(input.reason === undefined ? {} : { reason: input.reason }),
          ...(input.safety === true ? { safety: true as const } : {}),
          before: current.verificationStatus,
          after: input.status,
        });
        lastDecisions.set(scope.teacherId, {
          status: input.status,
          reason: input.reason ?? null,
          ts: new Date().toISOString(),
        });
        return next;
      },
    ),
    async assertVerifiedForPublish(scope: { teacherId: string }): Promise<void> {
      if (profiles.get(scope.teacherId)?.verificationStatus !== 'verified') {
        throw new RepositoryError('scope', 'teacherProfiles.assertVerifiedForPublish');
      }
    },
  };
  const takedowns = {
    listActiveForStaff: vi.fn(async (by: unknown): Promise<StaffTakedownRow[]> => {
      if (typeof by !== 'string' || by === '') {
        throw new RepositoryError('invalid', 'takedowns.listActiveForStaff');
      }
      if (roles.get(by) !== 'staff') {
        throw new RepositoryError('scope', 'takedowns.listActiveForStaff');
      }
      return [...activeTakedowns.values()].flat();
    }),
  };
  const audit = {
    findLastVerifyForStaff: vi.fn(async (by: unknown, teacherId: unknown) => {
      if (typeof by !== 'string' || by === '') {
        throw new RepositoryError('invalid', 'audit.findLastVerifyForStaff');
      }
      if (typeof teacherId !== 'string' || teacherId === '') {
        throw new RepositoryError('invalid', 'audit.findLastVerifyForStaff');
      }
      if (roles.get(by) !== 'staff') {
        throw new RepositoryError('scope', 'audit.findLastVerifyForStaff');
      }
      return lastDecisions.get(teacherId) ?? null;
    }),
    findSubjectHistoryForStaff: vi.fn(async (by: unknown, teacherId: unknown, limit: unknown) => {
      if (typeof by !== 'string' || by === '') {
        throw new RepositoryError('invalid', 'audit.findSubjectHistoryForStaff');
      }
      if (typeof teacherId !== 'string' || teacherId === '') {
        throw new RepositoryError('invalid', 'audit.findSubjectHistoryForStaff');
      }
      if (typeof limit !== 'number' || limit < 1 || limit > 10) {
        throw new RepositoryError('invalid', 'audit.findSubjectHistoryForStaff');
      }
      if (roles.get(by) !== 'staff') {
        throw new RepositoryError('scope', 'audit.findSubjectHistoryForStaff');
      }
      return subjectHistories.get(teacherId) ?? [];
    }),
  };
  const logs: string[] = [];
  const repos = { teacherProfiles, takedowns, audit } as unknown as Pick<
    Repositories,
    'teacherProfiles' | 'takedowns' | 'audit'
  >;
  const h = createStaffVerificationHandlers({
    repos: () => repos,
    log: (line) => logs.push(line),
  });
  return {
    h,
    roles,
    profiles,
    audits,
    logs,
    teacherProfiles,
    takedowns,
    audit,
    activeTakedowns,
    lastDecisions,
    subjectHistories,
  };
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
const getLookup = (slug?: string) =>
  new NextRequest(
    `${ORIGIN}${PATH}/lookup${slug === undefined ? '' : `?slug=${encodeURIComponent(slug)}`}`,
    { method: 'GET' },
  );

async function codeOf(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

describe('GET: the pending queue', () => {
  it('lists pending teachers for the session staff user, oldest first, no-store', async () => {
    const m = memory();
    const res = await m.h.list(get(), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({
      teachers: [
        {
          teacherId: 'tch_a',
          slug: 'asha-math',
          subject: 'Math',
          name: 'Name tch_a',
          email: 'tch_a@example.test',
          activeTakedowns: [],
          lastDecision: null,
          subjectHistory: [],
        },
        {
          teacherId: 'tch_b',
          slug: 'ben-physics',
          subject: 'Math',
          name: 'Name tch_b',
          email: 'tch_b@example.test',
          activeTakedowns: [],
          lastDecision: null,
          subjectHistory: [],
        },
        {
          teacherId: 'tch_c',
          slug: 'chen-chem',
          subject: 'Math',
          name: 'Name tch_c',
          email: null,
          activeTakedowns: [],
          lastDecision: null,
          subjectHistory: [],
        },
      ],
    });
    expect(m.teacherProfiles.listPendingForStaff).toHaveBeenCalledWith('stf_1');
  });

  it('ignores any query string: the staff id is only the session', async () => {
    const m = memory();
    await m.h.list(new NextRequest(`${ORIGIN}${PATH}?by=tch_a`, { method: 'GET' }), ctx());
    expect(m.teacherProfiles.listPendingForStaff).toHaveBeenCalledWith('stf_1');
  });

  it.each([
    ['scope', 403, 'forbidden'],
    ['invalid', 403, 'forbidden'],
    ['not_found', 403, 'forbidden'],
    ['integrity', 500, 'provider_error'],
    ['failed', 500, 'provider_error'],
  ] as const)('a repository %s is %i %s, with no raw error text', async (kind, status, code) => {
    const m = memory();
    m.teacherProfiles.listPendingForStaff.mockRejectedValueOnce(
      new RepositoryError(kind, 'teacherProfiles.listPendingForStaff'),
    );
    const res = await m.h.list(get(), ctx());
    expect(res.status).toBe(status);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ error: { code } });
    expect(text).not.toContain('teacherProfiles');
  });

  it('an unexpected throw is 500 and logs only the error name', async () => {
    const m = memory();
    m.teacherProfiles.listPendingForStaff.mockRejectedValueOnce(
      new TypeError('secret detail person@example.test'),
    );
    const res = await m.h.list(get(), ctx());
    expect(res.status).toBe(500);
    expect(await codeOf(res)).toBe('provider_error');
    expect(m.logs).toEqual(['[staff] verifications.list failed: TypeError']);
  });

  it('a former staff user (role changed after sign-in) is 403', async () => {
    const m = memory();
    m.roles.set('stf_1', 'student');
    const res = await m.h.list(get(), ctx());
    expect(res.status).toBe(403);
  });

  it('shows an active takedown and a prior decision (9.3h)', async () => {
    const m = memory();
    m.activeTakedowns.set('tch_a', [
      {
        id: 'td_1',
        kind: 'document',
        targetId: 'doc_1',
        teacherId: 'tch_a',
        teacherSlug: 'asha-math',
        category: 'other',
        createdAt: '2026-10-20T00:00:00.000Z',
      },
    ]);
    m.lastDecisions.set('tch_a', {
      status: 'rejected',
      reason: 'unsafe',
      ts: '2026-10-19T00:00:00.000Z',
    });
    const res = await m.h.list(get(), ctx());
    const body = (await res.json()) as {
      teachers: { teacherId: string; activeTakedowns: unknown[]; lastDecision: unknown }[];
    };
    const asha = body.teachers.find((t) => t.teacherId === 'tch_a');
    expect(asha?.activeTakedowns).toEqual([
      { kind: 'document', category: 'other', createdAt: '2026-10-20T00:00:00.000Z' },
    ]);
    expect(asha?.lastDecision).toEqual({ status: 'rejected', ts: '2026-10-19T00:00:00.000Z' });
  });

  it('shows a subject-change history on a queue row (9.3m, B-58)', async () => {
    const m = memory();
    m.subjectHistories.set('tch_a', [
      { from: 'Math', to: 'Physics', ts: '2026-10-20T00:00:00.000Z' },
      { from: 'Biology', to: 'Math', ts: '2026-10-18T00:00:00.000Z' },
    ]);
    const res = await m.h.list(get(), ctx());
    const body = (await res.json()) as {
      teachers: { teacherId: string; subjectHistory: unknown[] }[];
    };
    const asha = body.teachers.find((t) => t.teacherId === 'tch_a');
    expect(asha?.subjectHistory).toEqual([
      { from: 'Math', to: 'Physics', ts: '2026-10-20T00:00:00.000Z' },
      { from: 'Biology', to: 'Math', ts: '2026-10-18T00:00:00.000Z' },
    ]);
    expect(m.audit.findSubjectHistoryForStaff).toHaveBeenCalledWith('stf_1', 'tch_a', 10);
  });

  it('a scope error from findSubjectHistoryForStaff is 403, same as listForbidden (9.3n)', async () => {
    const m = memory();
    m.audit.findSubjectHistoryForStaff.mockRejectedValueOnce(
      new RepositoryError('scope', 'audit.findSubjectHistoryForStaff'),
    );
    const res = await m.h.list(get(), ctx());
    expect(res.status).toBe(403);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({
      error: { code: 'forbidden', message: 'Only staff can see the verification queue.' },
    });
  });

  it('a scope error from findLastVerifyForStaff is 403, same as listForbidden (9.3n)', async () => {
    const m = memory();
    m.audit.findLastVerifyForStaff.mockRejectedValueOnce(
      new RepositoryError('scope', 'audit.findLastVerifyForStaff'),
    );
    const res = await m.h.list(get(), ctx());
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe('forbidden');
  });

  it('an unexpected throw from enrichQueueRows is 500, generic message, no teacher id or detail (9.3n)', async () => {
    const m = memory();
    m.audit.findSubjectHistoryForStaff.mockRejectedValueOnce(new Error('boom tch_a'));
    const res = await m.h.list(get(), ctx());
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({
      error: { code: 'provider_error', message: 'Something went wrong. Try again.' },
    });
    expect(text).not.toContain('tch_a');
    expect(text).not.toContain('boom');
    expect(m.logs).toEqual(['[staff] verifications.list failed: Error']);
  });
});

describe('GET lookup: find one teacher by slug, any status', () => {
  it('finds a pending teacher by slug', async () => {
    const m = memory();
    const res = await m.h.lookup(getLookup('asha-math'), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({
      teacher: {
        teacherId: 'tch_a',
        slug: 'asha-math',
        subject: 'Math',
        name: 'Name tch_a',
        email: 'tch_a@example.test',
        verificationStatus: 'pending',
        activeTakedowns: [],
        lastDecision: null,
        subjectHistory: [],
      },
    });
    expect(m.teacherProfiles.findBySlugForStaff).toHaveBeenCalledWith('stf_1', 'asha-math');
  });

  it('finds a verified or a rejected teacher too (9.3f: no status filter, unlike list)', async () => {
    const m = memory();
    await m.h.decide(post({ teacherId: 'tch_a', status: 'verified' }), ctx());
    const verified = await m.h.lookup(getLookup('asha-math'), ctx());
    expect(
      ((await verified.json()) as { teacher: { verificationStatus: string } }).teacher
        .verificationStatus,
    ).toBe('verified');
    await m.h.decide(post({ teacherId: 'tch_b', status: 'rejected' }), ctx());
    const rejected = await m.h.lookup(getLookup('ben-physics'), ctx());
    expect(
      ((await rejected.json()) as { teacher: { verificationStatus: string } }).teacher
        .verificationStatus,
    ).toBe('rejected');
  });

  it('an unknown slug is 200 with a null teacher', async () => {
    const m = memory();
    const res = await m.h.lookup(getLookup('no-such-teacher'), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ teacher: null });
  });

  it('shows an active takedown and a prior decision on lookup too (9.3h)', async () => {
    const m = memory();
    m.activeTakedowns.set('tch_a', [
      {
        id: 'td_1',
        kind: 'agent',
        targetId: 'tp_tch_a',
        teacherId: 'tch_a',
        teacherSlug: 'asha-math',
        category: 'other',
        createdAt: '2026-10-20T00:00:00.000Z',
      },
    ]);
    m.lastDecisions.set('tch_a', {
      status: 'rejected',
      reason: 'unsafe',
      ts: '2026-10-19T00:00:00.000Z',
    });
    const res = await m.h.lookup(getLookup('asha-math'), ctx());
    const body = (await res.json()) as {
      teacher: { activeTakedowns: unknown[]; lastDecision: unknown };
    };
    expect(body.teacher.activeTakedowns).toEqual([
      { kind: 'agent', category: 'other', createdAt: '2026-10-20T00:00:00.000Z' },
    ]);
    expect(body.teacher.lastDecision).toEqual({
      status: 'rejected',
      ts: '2026-10-19T00:00:00.000Z',
    });
  });

  it('shows a subject-change history on lookup too (9.3m, B-58)', async () => {
    const m = memory();
    m.subjectHistories.set('tch_a', [
      { from: 'Math', to: 'Physics', ts: '2026-10-20T00:00:00.000Z' },
    ]);
    const res = await m.h.lookup(getLookup('asha-math'), ctx());
    const body = (await res.json()) as { teacher: { subjectHistory: unknown[] } };
    expect(body.teacher.subjectHistory).toEqual([
      { from: 'Math', to: 'Physics', ts: '2026-10-20T00:00:00.000Z' },
    ]);
  });

  it.each([
    ['missing', undefined],
    ['blank', ''],
    ['whitespace only', '   '],
  ])('a %s slug param is 400, no repo call', async (_label, slug) => {
    const m = memory();
    const res = await m.h.lookup(getLookup(slug), ctx());
    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe('validation');
    expect(m.teacherProfiles.findBySlugForStaff).not.toHaveBeenCalled();
  });

  it.each([
    ['too short', 'ab'],
    ['upper-case', 'Bad Slug'],
    ['a space', 'asha math'],
    ['a pasted URL', 'https://edmate.test/t/asha-math'],
  ])('a malformed non-blank slug (%s) is 400 validation, not 403', async (_label, slug) => {
    const m = memory();
    const res = await m.h.lookup(getLookup(slug), ctx());
    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe('validation');
  });

  it('a non-staff session is 403', async () => {
    const m = memory();
    const res = await m.h.lookup(getLookup('asha-math'), ctx({ userId: 'tch_a', role: 'teacher' }));
    expect(res.status).toBe(403);
  });

  it('an unexpected throw is 500 and logs only the error name', async () => {
    const m = memory();
    m.teacherProfiles.findBySlugForStaff.mockRejectedValueOnce(
      new TypeError('secret detail person@example.test'),
    );
    const res = await m.h.lookup(getLookup('asha-math'), ctx());
    expect(res.status).toBe(500);
    expect(await codeOf(res)).toBe('provider_error');
    expect(m.logs).toEqual(['[staff] verifications.lookup failed: TypeError']);
  });

  it('a scope error from findSubjectHistoryForStaff is 403, lookupForbidden (9.3n)', async () => {
    const m = memory();
    m.audit.findSubjectHistoryForStaff.mockRejectedValueOnce(
      new RepositoryError('scope', 'audit.findSubjectHistoryForStaff'),
    );
    const res = await m.h.lookup(getLookup('asha-math'), ctx());
    expect(res.status).toBe(403);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({
      error: { code: 'forbidden', message: 'Only staff can look up a teacher.' },
    });
  });

  it('a scope error from findLastVerifyForStaff is 403, lookupForbidden (9.3n)', async () => {
    const m = memory();
    m.audit.findLastVerifyForStaff.mockRejectedValueOnce(
      new RepositoryError('scope', 'audit.findLastVerifyForStaff'),
    );
    const res = await m.h.lookup(getLookup('asha-math'), ctx());
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe('forbidden');
  });

  it('an unexpected throw from enrichQueueRows is 500, generic message, no teacher id or detail (9.3n)', async () => {
    const m = memory();
    m.audit.findSubjectHistoryForStaff.mockRejectedValueOnce(new Error('boom tch_a'));
    const res = await m.h.lookup(getLookup('asha-math'), ctx());
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({
      error: { code: 'provider_error', message: 'Something went wrong. Try again.' },
    });
    expect(text).not.toContain('tch_a');
    expect(text).not.toContain('boom');
    expect(m.logs).toEqual(['[staff] verifications.lookup failed: Error']);
  });
});

describe('POST: approve or reject', () => {
  it('approves: setVerification with the session as `by`, one teacher.verify audit row', async () => {
    const m = memory();
    const res = await m.h.decide(post({ teacherId: 'tch_a', status: 'verified' }), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ teacherId: 'tch_a', verificationStatus: 'verified' });
    expect(m.teacherProfiles.setVerification).toHaveBeenCalledWith(
      { teacherId: 'tch_a' },
      { status: 'verified', by: 'stf_1' },
    );
    expect(m.audits).toEqual([
      {
        teacherId: 'tch_a',
        actor: 'stf_1',
        action: 'teacher.verify',
        before: 'pending',
        after: 'verified',
      },
    ]);
  });

  it('rejects with a reason (trimmed); the reason lands in the audit row', async () => {
    const m = memory();
    const res = await m.h.decide(
      post({ teacherId: 'tch_b', status: 'rejected', reason: '  name does not match  ' }),
      ctx(),
    );
    expect(res.status).toBe(200);
    expect(m.audits).toEqual([
      {
        teacherId: 'tch_b',
        actor: 'stf_1',
        action: 'teacher.verify',
        reason: 'name does not match',
        before: 'pending',
        after: 'rejected',
      },
    ]);
  });

  it('a safety rejection passes `safety: true` through; the audit row records it (9.3e)', async () => {
    const m = memory();
    const res = await m.h.decide(
      post({ teacherId: 'tch_b', status: 'rejected', reason: 'unsafe advice', safety: true }),
      ctx(),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ teacherId: 'tch_b', verificationStatus: 'rejected' });
    expect(m.teacherProfiles.setVerification).toHaveBeenCalledWith(
      { teacherId: 'tch_b' },
      { status: 'rejected', by: 'stf_1', reason: 'unsafe advice', safety: true },
    );
    expect(m.audits).toEqual([
      {
        teacherId: 'tch_b',
        actor: 'stf_1',
        action: 'teacher.verify',
        reason: 'unsafe advice',
        safety: true,
        before: 'pending',
        after: 'rejected',
      },
    ]);
  });

  it('`safety: false` is a plain rejection: the flag never reaches the repo (9.3e)', async () => {
    const m = memory();
    const res = await m.h.decide(
      post({ teacherId: 'tch_b', status: 'rejected', safety: false }),
      ctx(),
    );
    expect(res.status).toBe(200);
    expect(m.teacherProfiles.setVerification).toHaveBeenCalledWith(
      { teacherId: 'tch_b' },
      { status: 'rejected', by: 'stf_1' },
    );
    expect(m.audits[0]).not.toHaveProperty('safety');
  });

  it('after an approval the teacher leaves the queue', async () => {
    const m = memory();
    await m.h.decide(post({ teacherId: 'tch_a', status: 'verified' }), ctx());
    const body = (await (await m.h.list(get(), ctx())).json()) as {
      teachers: { teacherId: string }[];
    };
    expect(body.teachers.map((t) => t.teacherId)).toEqual(['tch_b', 'tch_c']);
  });

  it('unverified teachers stay unpublished: pending and rejected fail the publish check', async () => {
    const m = memory();
    const repo = m.teacherProfiles;
    await expect(repo.assertVerifiedForPublish({ teacherId: 'tch_a' })).rejects.toMatchObject({
      kind: 'scope',
    });
    await m.h.decide(post({ teacherId: 'tch_a', status: 'rejected' }), ctx());
    await expect(repo.assertVerifiedForPublish({ teacherId: 'tch_a' })).rejects.toMatchObject({
      kind: 'scope',
    });
    await m.h.decide(post({ teacherId: 'tch_b', status: 'verified' }), ctx());
    await expect(repo.assertVerifiedForPublish({ teacherId: 'tch_b' })).resolves.toBeUndefined();
  });

  it('a body `by` (or any unknown key) is 400 and never reaches the repo', async () => {
    const m = memory();
    for (const extra of [
      { by: 'stf_2' },
      { userId: 'stf_2' },
      { verificationStatus: 'verified' },
    ]) {
      const res = await m.h.decide(
        post({ teacherId: 'tch_a', status: 'verified', ...extra }),
        ctx(),
      );
      expect(res.status).toBe(400);
      expect(await codeOf(res)).toBe('validation');
    }
    expect(m.teacherProfiles.setVerification).not.toHaveBeenCalled();
    expect(m.audits).toEqual([]);
  });

  it.each([
    ['pending is not a decision', { teacherId: 'tch_a', status: 'pending' }],
    ['missing status', { teacherId: 'tch_a' }],
    ['missing teacherId', { status: 'verified' }],
    ['empty teacherId', { teacherId: '', status: 'verified' }],
    ['numeric teacherId', { teacherId: 7, status: 'verified' }],
    ['blank reason', { teacherId: 'tch_a', status: 'rejected', reason: '   ' }],
    [
      'reason too long',
      { teacherId: 'tch_a', status: 'rejected', reason: 'x'.repeat(MAX_REASON_CHARS + 1) },
    ],
    ['safety on an approval', { teacherId: 'tch_a', status: 'verified', safety: true }],
    ['numeric safety', { teacherId: 'tch_a', status: 'rejected', safety: 1 }],
    ['string safety', { teacherId: 'tch_a', status: 'rejected', safety: 'yes' }],
    ['null safety', { teacherId: 'tch_a', status: 'rejected', safety: null }],
    ['not an object', ['tch_a', 'verified']],
    ['null', null],
  ])('%s is 400 validation', async (_label, body) => {
    const m = memory();
    const res = await m.h.decide(post(body), ctx());
    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe('validation');
    expect(m.teacherProfiles.setVerification).not.toHaveBeenCalled();
  });

  it('a reason at the cap is accepted', async () => {
    const m = memory();
    const res = await m.h.decide(
      post({ teacherId: 'tch_a', status: 'rejected', reason: 'x'.repeat(MAX_REASON_CHARS) }),
      ctx(),
    );
    expect(res.status).toBe(200);
  });

  it('malformed JSON is 400; an oversize body is 413; neither reaches the repo', async () => {
    const m = memory();
    expect((await m.h.decide(post(null, '{not json'), ctx())).status).toBe(400);
    const big = post({
      teacherId: 'tch_a',
      status: 'rejected',
      reason: 'x'.repeat(MAX_BODY_BYTES),
    });
    const res = await m.h.decide(big, ctx());
    expect(res.status).toBe(413);
    expect(await codeOf(res)).toBe('input_too_large');
    expect(m.teacherProfiles.setVerification).not.toHaveBeenCalled();
  });

  it("a staff user can't verify themselves: the not-self rule is a fixed 403", async () => {
    const m = memory();
    // A former teacher promoted to staff still has a pending profile of their own.
    m.roles.set('tch_a', 'staff');
    const res = await m.h.decide(
      post({ teacherId: 'tch_a', status: 'verified' }),
      ctx({ userId: 'tch_a', role: 'staff' }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: 'forbidden', message: expect.any(String), retryable: false },
    });
    expect(m.profiles.get('tch_a')?.verificationStatus).toBe('pending');
    expect(m.audits).toEqual([]);
  });

  it.each([
    ['scope', 403, 'forbidden'],
    ['not_found', 404, 'not_found'],
    ['invalid', 400, 'validation'],
    ['integrity', 400, 'validation'],
    ['failed', 500, 'provider_error'],
  ] as const)('a repository %s is %i %s, no raw text, no-store', async (kind, status, code) => {
    const m = memory();
    m.teacherProfiles.setVerification.mockRejectedValueOnce(
      new RepositoryError(kind, 'teacherProfiles.setVerification'),
    );
    const res = await m.h.decide(post({ teacherId: 'tch_a', status: 'verified' }), ctx());
    expect(res.status).toBe(status);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ error: { code } });
    expect(text).not.toContain('teacherProfiles');
  });

  it('an unknown teacher is 404', async () => {
    const m = memory();
    const res = await m.h.decide(post({ teacherId: 'tch_zz', status: 'verified' }), ctx());
    expect(res.status).toBe(404);
  });

  it('an unexpected throw is 500 and logs only the error name (a non-Error too)', async () => {
    const m = memory();
    m.teacherProfiles.setVerification.mockRejectedValueOnce(
      new Error('pg says person@example.test'),
    );
    expect((await m.h.decide(post({ teacherId: 'tch_a', status: 'verified' }), ctx())).status).toBe(
      500,
    );
    m.teacherProfiles.setVerification.mockRejectedValueOnce('nope');
    expect((await m.h.decide(post({ teacherId: 'tch_a', status: 'verified' }), ctx())).status).toBe(
      500,
    );
    expect(m.logs).toEqual([
      '[staff] verifications.decide failed: Error',
      '[staff] verifications.decide failed: non-error',
    ]);
  });

  it('the default logger writes to console.error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const repos = {
      teacherProfiles: { listPendingForStaff: async () => Promise.reject(new RangeError('x')) },
      takedowns: { listActiveForStaff: async () => [] },
      audit: {
        findLastVerifyForStaff: async () => null,
        findSubjectHistoryForStaff: async () => [],
      },
    } as unknown as Pick<Repositories, 'teacherProfiles' | 'takedowns' | 'audit'>;
    const h = createStaffVerificationHandlers({ repos: () => repos });
    expect((await h.list(get(), ctx())).status).toBe(500);
    expect(spy).toHaveBeenCalledWith('[staff] verifications.list failed: RangeError');
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
      POST: guard.withRole(['staff'], m.h.decide),
      LOOKUP: guard.withRole(['staff'], m.h.lookup),
    };
  }
  const call = (method: 'GET' | 'POST', who: string | null, origin = ORIGIN) =>
    new NextRequest(`${ORIGIN}${PATH}`, {
      method,
      headers: {
        ...(who ? { cookie: `who=${who}` } : {}),
        ...(method === 'POST' ? { origin, 'content-type': 'application/json' } : {}),
      },
      ...(method === 'POST'
        ? { body: JSON.stringify({ teacherId: 'tch_b', status: 'verified' }) }
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
    expect(g.teacherProfiles.listPendingForStaff).not.toHaveBeenCalled();
    expect(g.teacherProfiles.setVerification).not.toHaveBeenCalled();
    expect(g.audits).toEqual([]);
  });

  it('a teacher cannot approve themselves through the route either (403 before the repo)', async () => {
    const g = guarded();
    const res = await g.POST(
      new NextRequest(`${ORIGIN}${PATH}`, {
        method: 'POST',
        headers: { cookie: 'who=teacher', origin: ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ teacherId: 'tch_a', status: 'verified' }),
      }),
    );
    expect(res.status).toBe(403);
    expect(g.profiles.get('tch_a')?.verificationStatus).toBe('pending');
  });

  it('staff GET is 200 and staff POST writes the audit row', async () => {
    const g = guarded();
    expect((await g.GET(call('GET', 'staff'))).status).toBe(200);
    const res = await g.POST(call('POST', 'staff'));
    expect(res.status).toBe(200);
    expect(g.audits).toEqual([
      {
        teacherId: 'tch_b',
        actor: 'stf_1',
        action: 'teacher.verify',
        before: 'pending',
        after: 'verified',
      },
    ]);
  });

  it('a cross-site staff POST is 403 and writes nothing', async () => {
    const g = guarded();
    const res = await g.POST(call('POST', 'staff', 'https://evil.example'));
    expect(res.status).toBe(403);
    expect(g.audits).toEqual([]);
  });

  it.each([
    [null, 401],
    ['student', 403],
    ['teacher', 403],
  ])('lookup as %s is %i, nothing read', async (who, status) => {
    const g = guarded();
    const res = await g.LOOKUP(
      new NextRequest(`${ORIGIN}${PATH}/lookup?slug=ben-physics`, {
        method: 'GET',
        headers: who ? { cookie: `who=${who}` } : {},
      }),
    );
    expect(res.status).toBe(status);
    expect(g.teacherProfiles.findBySlugForStaff).not.toHaveBeenCalled();
  });

  it('staff lookup is 200', async () => {
    const g = guarded();
    const res = await g.LOOKUP(
      new NextRequest(`${ORIGIN}${PATH}/lookup?slug=ben-physics`, {
        method: 'GET',
        headers: { cookie: 'who=staff' },
      }),
    );
    expect(res.status).toBe(200);
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

describe('lookup/route.ts', () => {
  it('exports GET guarded for staff only', async () => {
    const { GUARD } = await import('../../../../src/auth/guard');
    const route = await import('./lookup/route');
    expect((route.GET as unknown as Record<symbol, unknown>)[GUARD]).toEqual(['staff']);
    expect(route.dynamic).toBe('force-dynamic');
  });
});
