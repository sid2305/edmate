// Task 12.3d: the repeat-infringer flag (B-63) over memory `takedowns`/`teacherProfiles`/`audit`
// repos (no database; rule 4). GET only -- suspension goes through the existing
// `/api/staff/verifications` POST, unchanged. The staff id always comes from the session, never a
// query string. route.int.test.ts re-runs the same handlers over a real Postgres.
import { RepositoryError, type Repositories, type StaffTakedownRow } from '@edmate/db';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import {
  createGuard,
  type CookieReader,
  type Principal,
  type RoleContext,
} from '../../../../src/auth/guard';
import type { QueueItem, TakedownSummary } from '../verifications/handlers';
import {
  createStaffRepeatInfringersHandlers,
  listRepeatInfringersForStaff,
  REPEAT_INFRINGER_THRESHOLD,
  REPEAT_INFRINGER_WINDOW_DAYS,
  REPEAT_INFRINGERS_MAX_LIMIT,
} from './handlers';

const ORIGIN = 'http://localhost:8080';
const PATH = '/api/staff/repeat-infringers';
const STAFF: Principal = { userId: 'stf_1', role: 'staff' };
const WHO: Record<string, Principal> = {
  staff: STAFF,
  student: { userId: 'stu_1', role: 'student' },
  teacher: { userId: 'tch_a', role: 'teacher' },
};
const NOW = Date.parse('2026-10-27T00:00:00.000Z');
const DAY_MS = 86_400_000;

interface Profile {
  teacherId: string;
  slug: string;
  verificationStatus: 'pending' | 'verified' | 'rejected';
}

/** A memory takedowns + teacherProfiles + audit repo trio, with the real ones' role checks. */
function memory() {
  const roles = new Map<string, string>([
    ['stf_1', 'staff'],
    ['stu_1', 'student'],
    ['tch_a', 'teacher'],
  ]);
  const active: StaffTakedownRow[] = [];
  const profiles = new Map<string, Profile>();
  const addProfile = (
    teacherId: string,
    slug: string,
    verificationStatus: Profile['verificationStatus'] = 'verified',
  ) => {
    profiles.set(slug, { teacherId, slug, verificationStatus });
    roles.set(teacherId, 'teacher');
  };
  const addTakedown = (
    row: Partial<StaffTakedownRow> & { teacherId: string; teacherSlug: string },
  ) => {
    active.push({
      id: `tkd_${active.length}`,
      kind: 'agent',
      targetId: `agt_${active.length}`,
      category: 'copyright',
      createdAt: new Date(NOW - DAY_MS).toISOString(),
      ...row,
    });
  };
  const takedowns = {
    listActiveForStaff: vi.fn(async (by: unknown): Promise<StaffTakedownRow[]> => {
      if (typeof by !== 'string' || by === '') {
        throw new RepositoryError('invalid', 'takedowns.listActiveForStaff');
      }
      if (roles.get(by) !== 'staff')
        throw new RepositoryError('scope', 'takedowns.listActiveForStaff');
      return [...active];
    }),
  };
  const teacherProfiles = {
    findBySlugForStaff: vi.fn(async (by: unknown, slug: unknown) => {
      if (typeof by !== 'string' || by === '') {
        throw new RepositoryError('invalid', 'teacherProfiles.findBySlugForStaff');
      }
      if (roles.get(by) !== 'staff')
        throw new RepositoryError('scope', 'teacherProfiles.findBySlugForStaff');
      const p = profiles.get(String(slug));
      if (!p) return null;
      return {
        id: `tp_${p.teacherId}`,
        teacherId: p.teacherId,
        slug: p.slug,
        displayName: p.slug,
        subject: 'Math',
        verificationStatus: p.verificationStatus,
        name: `Name ${p.teacherId}`,
        email: `${p.teacherId}@example.test`,
      };
    }),
  };
  const audit = {
    findLastVerifyForStaff: vi.fn(async () => null),
    findSubjectHistoryForStaff: vi.fn(async () => []),
  };
  const repos = { takedowns, teacherProfiles, audit } as unknown as Pick<
    Repositories,
    'takedowns' | 'teacherProfiles' | 'audit'
  >;
  const logs: string[] = [];
  const h = createStaffRepeatInfringersHandlers({
    repos: () => repos,
    log: (line) => logs.push(line),
  });
  return {
    h,
    roles,
    active,
    profiles,
    addProfile,
    addTakedown,
    logs,
    takedowns,
    teacherProfiles,
    audit,
  };
}

const ctx = (principal: Principal = STAFF): RoleContext => ({
  principal,
  params: Promise.resolve({}),
});
const get = () => new NextRequest(`${ORIGIN}${PATH}`, { method: 'GET' });

async function codeOf(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

describe('constants', () => {
  it('threshold 3, window 365 days, cap 50', () => {
    expect(REPEAT_INFRINGER_THRESHOLD).toBe(3);
    expect(REPEAT_INFRINGER_WINDOW_DAYS).toBe(365);
    expect(REPEAT_INFRINGERS_MAX_LIMIT).toBe(50);
  });
});

describe('listRepeatInfringersForStaff', () => {
  it('flags a teacher with 3 in-window active copyright takedowns', async () => {
    const m = memory();
    m.addProfile('tch_a', 'asha-math');
    m.addTakedown({ teacherId: 'tch_a', teacherSlug: 'asha-math' });
    m.addTakedown({ teacherId: 'tch_a', teacherSlug: 'asha-math' });
    m.addTakedown({ teacherId: 'tch_a', teacherSlug: 'asha-math' });
    const list = await listRepeatInfringersForStaff(
      {
        takedowns: m.takedowns,
        teacherProfiles: m.teacherProfiles,
        audit: m.audit,
      } as unknown as Pick<Repositories, 'takedowns' | 'teacherProfiles' | 'audit'>,
      'stf_1',
      NOW,
    );
    expect(list.map((t) => t.slug)).toEqual(['asha-math']);
  });

  it('excludes a teacher with only 2 in-window copyright takedowns', async () => {
    const m = memory();
    m.addProfile('tch_a', 'asha-math');
    m.addTakedown({ teacherId: 'tch_a', teacherSlug: 'asha-math' });
    m.addTakedown({ teacherId: 'tch_a', teacherSlug: 'asha-math' });
    const list = await listRepeatInfringersForStaff(
      {
        takedowns: m.takedowns,
        teacherProfiles: m.teacherProfiles,
        audit: m.audit,
      } as unknown as Pick<Repositories, 'takedowns' | 'teacherProfiles' | 'audit'>,
      'stf_1',
      NOW,
    );
    expect(list).toEqual([]);
  });

  it('a 4th copyright takedown older than 365 days does not count towards the threshold', async () => {
    const m = memory();
    m.addProfile('tch_a', 'asha-math');
    m.addTakedown({ teacherId: 'tch_a', teacherSlug: 'asha-math' });
    m.addTakedown({ teacherId: 'tch_a', teacherSlug: 'asha-math' });
    m.addTakedown({
      teacherId: 'tch_a',
      teacherSlug: 'asha-math',
      createdAt: new Date(NOW - 366 * DAY_MS).toISOString(),
    });
    const list = await listRepeatInfringersForStaff(
      {
        takedowns: m.takedowns,
        teacherProfiles: m.teacherProfiles,
        audit: m.audit,
      } as unknown as Pick<Repositories, 'takedowns' | 'teacherProfiles' | 'audit'>,
      'stf_1',
      NOW,
    );
    expect(list).toEqual([]);
  });

  it('a non-copyright category active takedown does not count', async () => {
    const m = memory();
    m.addProfile('tch_a', 'asha-math');
    m.addTakedown({ teacherId: 'tch_a', teacherSlug: 'asha-math' });
    m.addTakedown({ teacherId: 'tch_a', teacherSlug: 'asha-math' });
    m.addTakedown({ teacherId: 'tch_a', teacherSlug: 'asha-math', category: 'harmful' });
    const list = await listRepeatInfringersForStaff(
      {
        takedowns: m.takedowns,
        teacherProfiles: m.teacherProfiles,
        audit: m.audit,
      } as unknown as Pick<Repositories, 'takedowns' | 'teacherProfiles' | 'audit'>,
      'stf_1',
      NOW,
    );
    expect(list).toEqual([]);
  });

  it('a flagged teacher already rejected is excluded', async () => {
    const m = memory();
    m.addProfile('tch_a', 'asha-math', 'rejected');
    m.addTakedown({ teacherId: 'tch_a', teacherSlug: 'asha-math' });
    m.addTakedown({ teacherId: 'tch_a', teacherSlug: 'asha-math' });
    m.addTakedown({ teacherId: 'tch_a', teacherSlug: 'asha-math' });
    const list = await listRepeatInfringersForStaff(
      {
        takedowns: m.takedowns,
        teacherProfiles: m.teacherProfiles,
        audit: m.audit,
      } as unknown as Pick<Repositories, 'takedowns' | 'teacherProfiles' | 'audit'>,
      'stf_1',
      NOW,
    );
    expect(list).toEqual([]);
  });

  it('a flagged slug that findBySlugForStaff returns null for is excluded', async () => {
    const m = memory();
    // No profile added: the slug is unknown to findBySlugForStaff.
    m.addTakedown({ teacherId: 'tch_a', teacherSlug: 'ghost-slug' });
    m.addTakedown({ teacherId: 'tch_a', teacherSlug: 'ghost-slug' });
    m.addTakedown({ teacherId: 'tch_a', teacherSlug: 'ghost-slug' });
    const list = await listRepeatInfringersForStaff(
      {
        takedowns: m.takedowns,
        teacherProfiles: m.teacherProfiles,
        audit: m.audit,
      } as unknown as Pick<Repositories, 'takedowns' | 'teacherProfiles' | 'audit'>,
      'stf_1',
      NOW,
    );
    expect(list).toEqual([]);
  });

  it('caps at REPEAT_INFRINGERS_MAX_LIMIT, sorted by slug', async () => {
    const m = memory();
    for (let i = 0; i < REPEAT_INFRINGERS_MAX_LIMIT + 5; i++) {
      const teacherId = `tch_${String(i).padStart(3, '0')}`;
      const slug = `teacher-${String(i).padStart(3, '0')}`;
      m.addProfile(teacherId, slug);
      m.addTakedown({ teacherId, teacherSlug: slug });
      m.addTakedown({ teacherId, teacherSlug: slug });
      m.addTakedown({ teacherId, teacherSlug: slug });
    }
    const list = await listRepeatInfringersForStaff(
      {
        takedowns: m.takedowns,
        teacherProfiles: m.teacherProfiles,
        audit: m.audit,
      } as unknown as Pick<Repositories, 'takedowns' | 'teacherProfiles' | 'audit'>,
      'stf_1',
      NOW,
    );
    expect(list).toHaveLength(REPEAT_INFRINGERS_MAX_LIMIT);
    const slugs = list.map((t) => t.slug);
    expect(slugs).toEqual([...slugs].sort());
  });
});

describe('GET /api/staff/repeat-infringers', () => {
  it('a staff user with no flagged teachers sees an empty list, no-store', async () => {
    const m = memory();
    const res = await m.h.list(get(), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ teachers: [] });
  });

  it('lists a flagged teacher, shape-identical to the verification queue items', async () => {
    const m = memory();
    m.addProfile('tch_a', 'asha-math');
    m.addTakedown({ teacherId: 'tch_a', teacherSlug: 'asha-math' });
    m.addTakedown({ teacherId: 'tch_a', teacherSlug: 'asha-math' });
    m.addTakedown({ teacherId: 'tch_a', teacherSlug: 'asha-math' });
    const res = await m.h.list(get(), ctx());
    const body = (await res.json()) as {
      teachers: (QueueItem & { activeTakedowns: TakedownSummary[] })[];
    };
    expect(body.teachers).toHaveLength(1);
    expect(body.teachers[0]).toMatchObject({
      teacherId: 'tch_a',
      slug: 'asha-math',
      verificationStatus: 'verified',
    });
  });

  it('a non-staff principal is 403 forbidden', async () => {
    const m = memory();
    const res = await m.h.list(get(), ctx(WHO.teacher));
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe('forbidden');
  });

  it.each([
    ['scope', 403, 'forbidden'],
    ['invalid', 403, 'forbidden'],
    ['not_found', 500, 'provider_error'],
    ['integrity', 500, 'provider_error'],
    ['failed', 500, 'provider_error'],
  ] as const)('a repository %s on the outer by is %i %s', async (kind, status, code) => {
    const m = memory();
    m.takedowns.listActiveForStaff.mockRejectedValueOnce(
      new RepositoryError(kind, 'takedowns.listActiveForStaff'),
    );
    const res = await m.h.list(get(), ctx());
    expect(res.status).toBe(status);
    expect(await codeOf(res)).toBe(code);
  });

  it('an unexpected throw is 500 provider_error; the body never names a reason, note or email', async () => {
    const m = memory();
    m.addProfile('tch_a', 'asha-math');
    m.addTakedown({ teacherId: 'tch_a', teacherSlug: 'asha-math' });
    m.addTakedown({ teacherId: 'tch_a', teacherSlug: 'asha-math' });
    m.addTakedown({ teacherId: 'tch_a', teacherSlug: 'asha-math' });
    m.teacherProfiles.findBySlugForStaff.mockRejectedValueOnce(
      new TypeError('person@example.test'),
    );
    const res = await m.h.list(get(), ctx());
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ error: { code: 'provider_error' } });
    expect(text).not.toContain('reason');
    expect(text).not.toContain('note');
    expect(text).not.toContain('@example.test');
    expect(m.logs).toEqual(['[staff] repeat-infringers.list failed: TypeError']);
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
    return { ...m, GET: guard.withRole(['staff'], m.h.list) };
  }
  const call = (who: string | null) =>
    new NextRequest(`${ORIGIN}${PATH}`, {
      method: 'GET',
      headers: who ? { cookie: `who=${who}` } : {},
    });

  it('signed-out is 401; student and teacher are 403', async () => {
    const g = guarded();
    expect((await g.GET(call(null))).status).toBe(401);
    expect((await g.GET(call('student'))).status).toBe(403);
    expect((await g.GET(call('teacher'))).status).toBe(403);
  });

  it('staff can list through the real guard', async () => {
    const g = guarded();
    expect((await g.GET(call('staff'))).status).toBe(200);
  });
});

describe('route.ts', () => {
  it('exports only GET, guarded for staff only', async () => {
    const { GUARD } = await import('../../../../src/auth/guard');
    const route = await import('./route');
    expect((route.GET as unknown as Record<symbol, unknown>)[GUARD]).toEqual(['staff']);
    expect(route.dynamic).toBe('force-dynamic');
    expect((route as Record<string, unknown>).POST).toBeUndefined();
  });
});
