// Task 1.3 acceptance: the role x route matrix. For every ROUTE_POLICY row x every method x
// {anonymous, student, teacher, staff}: 200 when allowed, 401 `unauthorized` with no session, 403
// `forbidden` for a wrong role or a method the row doesn't list. Unmatched paths are denied.
import { ErrorCodeSchema } from '@edmate/contracts';
import { RepositoryError, type AgeStatus, type Role } from '@edmate/db';
import { NextRequest } from 'next/server';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  AGE_GATE_PATH,
  createGuard,
  GUARD,
  SIGN_IN_PATH,
  type CookieReader,
  type GuardDeps,
  type PageDeps,
  type Principal,
  type RoleContext,
} from './guard';
import {
  METHODS,
  policyFor,
  ROUTE_POLICY,
  ruleFor,
  sameAccess,
  type Access,
  type Clearance,
  type Method,
} from './policy';

const ORIGIN = 'http://localhost:8080';
type Who = 'anonymous' | Role;
const WHO: readonly Who[] = ['anonymous', 'student', 'teacher', 'staff'];
const PRINCIPALS: Record<Role, Principal> = {
  student: { userId: 'usr_student', role: 'student' },
  teacher: { userId: 'usr_teacher', role: 'teacher' },
  staff: { userId: 'usr_staff', role: 'staff' },
};

/** The test session cookie names who is calling. */
function deps(over: Partial<GuardDeps> = {}): GuardDeps {
  return {
    getPrincipal: async (c: CookieReader) => {
      const who = c.get('who')?.value as Role | undefined;
      return who ? PRINCIPALS[who] : null;
    },
    learnerStatus: async () => 'clear',
    allowedOrigin: ORIGIN,
    ...over,
  };
}

const noPages = (): PageDeps => {
  throw new Error('not a page');
};

function request(method: string, path: string, who: Who, headers: Record<string, string> = {}) {
  return new NextRequest(`${ORIGIN}${path}`, {
    method,
    headers: {
      ...(who === 'anonymous' ? {} : { cookie: `who=${who}` }),
      ...(method === 'GET' || method === 'HEAD' ? {} : { origin: ORIGIN }),
      ...headers,
    },
  });
}

/** A concrete path for a policy pattern. */
function sample(pattern: string): string {
  return pattern.replace(/\/\*\*$/, '/x/y').replace(/\/\*(?=\/|$)/g, '/item_1');
}

/** The route for a policy row, as a real route file would wrap it. */
function routeFor(access: Access, guard: ReturnType<typeof createGuard>) {
  const handler = vi.fn(() => new Response('ok'));
  if (access === 'public') return { handler, route: guard.publicRoute(handler) };
  if (access === 'provider') return { handler, route: guard.providerRoute(handler) };
  return { handler, route: guard.withRole(access, handler) };
}

async function errorOf(res: Response) {
  const body = (await res.json()) as {
    error: { code: string; message: string; retryable: boolean };
  };
  expect(ErrorCodeSchema.safeParse(body.error.code).success).toBe(true);
  expect(Object.keys(body.error).sort()).toEqual(['code', 'message', 'retryable']);
  expect(res.headers.get('cache-control')).toBe('no-store');
  return body.error;
}

function expected(access: Access, listed: boolean, who: Who): 200 | 401 | 403 {
  if (typeof access === 'string') return 200; // public and provider wrappers don't gate
  if (!listed) return 403;
  if (who === 'anonymous') return 401;
  return access.includes(who) ? 200 : 403;
}

const table: string[] = [];

describe('role x route matrix', () => {
  const guard = createGuard(() => deps(), noPages);

  for (const row of ROUTE_POLICY) {
    const path = sample(row.pattern);
    for (const method of METHODS) {
      const listed = row.methods.includes(method);
      // Public and provider wrappers can't see unlisted methods; the coverage test keeps every
      // real export listed, so only listed methods are meaningful for them.
      if (typeof row.access === 'string' && !listed) continue;
      it(`${method} ${path}`, async () => {
        const cells: string[] = [];
        for (const who of WHO) {
          const { handler, route } = routeFor(row.access, guard);
          const res = await route(request(method, path, who));
          const want = expected(row.access, listed, who);
          expect(res.status, `${who}`).toBe(want);
          if (want === 200) {
            expect(handler).toHaveBeenCalledOnce();
          } else {
            expect(handler).not.toHaveBeenCalled();
            const err = await errorOf(res);
            expect(err.code).toBe(want === 401 ? 'unauthorized' : 'forbidden');
            expect(err.retryable).toBe(false);
          }
          cells.push(`${who}=${res.status}`);
        }
        table.push(`${method.padEnd(6)} ${path.padEnd(28)} ${cells.join(' ')}`);
      });
    }
  }

  it('denies every role on a path no policy matches', async () => {
    const unmatched = [
      '/api/unknown',
      '/api/studio',
      '/api/staffx/reports',
      '/api/me/progress/',
      '/api//me/progress',
      '/api/studio/x%2Fy',
      '/api/studio/x%5Cy',
      '/elsewhere',
    ];
    for (const path of unmatched) {
      for (const method of METHODS) expect(policyFor(method, path), `${method} ${path}`).toBeNull();
      for (const roles of [['student'], ['teacher'], ['staff']] as Role[][]) {
        const route = guard.withRole(roles, () => new Response('ok'));
        for (const who of WHO) {
          const res = await route(request('GET', path, who));
          expect(res.status, `${path} ${who}`).toBe(403);
        }
      }
    }
    expect(policyFor('GET', 'no-leading-slash')).toBeNull();
    // A raw encoded dot segment is refused (the URL parser already resolves it in requests).
    expect(policyFor('GET', '/api/studio/%2e%2e/staff/reports')).toBeNull();
    expect(policyFor('GET', '/api/studio/../staff/reports')).toBeNull();
  });

  it('denies a route whose wrapper disagrees with the policy (wrong roles for the path)', async () => {
    const route = guard.withRole(['staff'], () => new Response('ok'));
    const res = await route(request('GET', '/api/studio/documents', 'staff'));
    expect(res.status).toBe(403);
    const both = guard.withRole(['teacher', 'staff'], () => new Response('ok'));
    expect((await both(request('GET', '/api/studio/documents', 'teacher'))).status).toBe(403);
  });

  it('treats HEAD as GET', async () => {
    expect(policyFor('HEAD', '/api/me/progress')).toEqual(['student']);
    const route = guard.withRole(['student'], () => new Response('ok'));
    expect((await route(request('HEAD', '/api/me/progress', 'student'))).status).toBe(200);
  });

  afterAll(() => {
    if (table.length)
      console.log(`[role x route matrix] ${table.length} rows\n  ${table.join('\n  ')}`);
  });
});

describe('withRole', () => {
  it('passes the principal and the route params to the handler', async () => {
    const guard = createGuard(() => deps(), noPages);
    const handler = vi.fn(async (_req: NextRequest, _ctx: RoleContext) => new Response('ok'));
    const route = guard.withRole(['student'], handler);
    const params = Promise.resolve({ id: 'sub_1' });
    await route(request('PATCH', '/api/subscriptions/sub_1', 'student'), { params });
    const ctx = handler.mock.calls[0]![1];
    expect(ctx.principal).toEqual(PRINCIPALS.student);
    expect(await ctx.params).toEqual({ id: 'sub_1' });
    await route(request('PATCH', '/api/subscriptions/sub_1', 'student'));
    expect(await handler.mock.calls[1]![1].params).toEqual({});
  });

  it('a principal lookup that throws is 500 provider_error, retryable, and the handler never runs', async () => {
    const guard = createGuard(
      () =>
        deps({
          getPrincipal: async () => {
            throw new Error('db down: postgres://u:p@127.0.0.1/x');
          },
        }),
      noPages,
    );
    const handler = vi.fn(() => new Response('ok'));
    const res = await guard.withRole(
      ['student'],
      handler,
    )(request('GET', '/api/me/progress', 'student'));
    expect(res.status).toBe(500);
    const err = await errorOf(res);
    expect(err).toMatchObject({ code: 'provider_error', retryable: true });
    expect(JSON.stringify(err)).not.toContain('postgres');
    expect(handler).not.toHaveBeenCalled();
  });

  it('missing sign-in config is 500, not anonymous', async () => {
    const guard = createGuard(() => {
      throw new Error('AUTH_SECRET is not set');
    }, noPages);
    const res = await guard.withRole(
      ['student'],
      () => new Response('ok'),
    )(request('GET', '/api/me/progress', 'student'));
    expect(res.status).toBe(500);
    expect((await errorOf(res)).code).toBe('provider_error');
  });

  it('withRole keeps its access on the brand', () => {
    const guard = createGuard(() => deps(), noPages);
    expect(guard.withRole(['teacher'], () => new Response())[GUARD]).toEqual(['teacher']);
    expect(guard.publicRoute(() => new Response())[GUARD]).toBe('public');
    expect(guard.providerRoute(() => new Response())[GUARD]).toBe('provider');
  });

  it('publicRoute and providerRoute pass arguments and return values through', async () => {
    const guard = createGuard(() => deps(), noPages);
    const r = new Response('sync');
    expect(guard.publicRoute((x: number) => (x === 1 ? r : null))(1)).toBe(r);
    expect(guard.providerRoute((x: number) => x + 1)(1)).toBe(2);
  });
});

describe('Origin check on unsafe methods', () => {
  const guard = createGuard(() => deps(), noPages);
  const route = guard.withRole(['student'], () => new Response('ok'));
  const unsafe: Array<[Method, string]> = [
    ['POST', '/api/subscriptions'],
    ['PATCH', '/api/subscriptions/sub_1'],
    ['DELETE', '/api/me'],
  ];

  it.each(unsafe)(
    '%s %s: a missing, null or cross-site Origin is 403 before the session is read',
    async (method, path) => {
      const getPrincipal = vi.fn(deps().getPrincipal);
      const g = createGuard(() => deps({ getPrincipal }), noPages);
      const r = g.withRole(['student'], () => new Response('ok'));
      for (const headers of [
        { origin: '' },
        { origin: 'null' },
        { origin: 'https://evil.example' },
        { origin: 'http://localhost:8081' },
        { origin: 'https://evil.example', 'sec-fetch-site': 'same-origin' },
        { origin: '', 'sec-fetch-site': 'cross-site' },
      ]) {
        const req = new NextRequest(`${ORIGIN}${path}`, {
          method,
          headers: { cookie: 'who=student', ...headers },
        });
        if (headers.origin === '') req.headers.delete('origin');
        const res = await r(req);
        expect(res.status, JSON.stringify(headers)).toBe(403);
        expect((await errorOf(res)).code).toBe('forbidden');
      }
      expect(getPrincipal).not.toHaveBeenCalled();
    },
  );

  it('same-origin passes, by Origin or by Sec-Fetch-Site', async () => {
    expect((await route(request('POST', '/api/subscriptions', 'student'))).status).toBe(200);
    const req = new NextRequest(`${ORIGIN}/api/subscriptions`, {
      method: 'POST',
      headers: { cookie: 'who=student', 'sec-fetch-site': 'same-origin' },
    });
    expect((await route(req)).status).toBe(200);
  });

  it('PUT is checked too', async () => {
    const studio = guard.withRole(['teacher'], () => new Response('ok'));
    const req = new NextRequest(`${ORIGIN}/api/studio/outline`, {
      method: 'PUT',
      headers: { cookie: 'who=teacher', origin: 'https://evil.example' },
    });
    expect((await studio(req)).status).toBe(403);
  });

  it('GET needs no Origin', async () => {
    const req = new NextRequest(`${ORIGIN}/api/me/progress`, {
      headers: { cookie: 'who=student' },
    });
    expect((await route(req)).status).toBe(200);
  });

  it('providerRoute skips the Origin check (webhooks come from the provider)', async () => {
    const hook = guard.providerRoute((_req: NextRequest) => new Response('ok'));
    const req = new NextRequest(`${ORIGIN}/api/webhooks/payments`, {
      method: 'POST',
      headers: { origin: 'https://payments.example' },
    });
    expect(hook(req).status).toBe(200);
  });
});

describe('requireRole (server components and actions)', () => {
  function pages(who: Who) {
    const redirect = vi.fn((url: string): never => {
      throw new Error(`REDIRECT ${url}`);
    });
    const notFound = vi.fn((): never => {
      throw new Error('NOT_FOUND');
    });
    const page: PageDeps = {
      cookies: async () => ({
        get: (name: string) => (name === 'who' && who !== 'anonymous' ? { value: who } : undefined),
      }),
      redirect,
      notFound,
    };
    return { page, redirect, notFound };
  }

  it('returns the principal for an allowed role', async () => {
    const p = pages('teacher');
    const guard = createGuard(
      () => deps(),
      () => p.page,
    );
    expect(await guard.requireRole(['teacher'])).toEqual(PRINCIPALS.teacher);
  });

  it('redirects anonymous users to sign-in', async () => {
    const p = pages('anonymous');
    const guard = createGuard(
      () => deps(),
      () => p.page,
    );
    await expect(guard.requireRole(['student'])).rejects.toThrow(`REDIRECT ${SIGN_IN_PATH}`);
    expect(p.notFound).not.toHaveBeenCalled();
  });

  it('SIGN_IN_PATH is the one sign-in page (task 9.1)', () => {
    expect(SIGN_IN_PATH).toBe('/sign-in');
  });

  it('is not-found for a wrong role (no role inheritance: staff are not teachers)', async () => {
    const p = pages('staff');
    const guard = createGuard(
      () => deps(),
      () => p.page,
    );
    await expect(guard.requireRole(['teacher'])).rejects.toThrow('NOT_FOUND');
    expect(p.redirect).not.toHaveBeenCalled();
  });
});

describe('policy table', () => {
  it('has no role inheritance: every role row names exactly one role', () => {
    for (const row of ROUTE_POLICY) {
      if (typeof row.access !== 'string') expect(row.access, row.pattern).toHaveLength(1);
    }
  });

  it('sameAccess compares role lists as sets and strings exactly', () => {
    expect(sameAccess(['student', 'teacher'], ['teacher', 'student'])).toBe(true);
    expect(sameAccess(['student'], ['student', 'teacher'])).toBe(false);
    expect(sameAccess(['student'], ['teacher'])).toBe(false);
    expect(sameAccess('public', 'public')).toBe(true);
    expect(sameAccess('public', 'provider')).toBe(false);
    expect(sameAccess('public', ['student'])).toBe(false);
  });

  it('matches the API surface rows', () => {
    expect(policyFor('GET', '/api/teachers')).toBe('public');
    expect(policyFor('GET', '/api/teachers/asha')).toBe('public');
    expect(policyFor('GET', '/api/teachers/asha/extra')).toBeNull();
    expect(policyFor('POST', '/api/teachers')).toBeNull();
    expect(policyFor('POST', '/api/sessions/s_1/turns')).toEqual(['student']);
    expect(policyFor('GET', '/api/me')).toBeNull();
    expect(policyFor('DELETE', '/api/me')).toEqual(['student']);
    // 8.2: teachers delete their uploads (`DELETE /api/studio/documents/:id`); nobody else may.
    expect(policyFor('DELETE', '/api/studio/documents/doc_1')).toEqual(['teacher']);
    expect(policyFor('DELETE', '/api/studio')).toBeNull();
    expect(policyFor('DELETE', '/api/staff/reports')).toBeNull();
    expect(policyFor('POST', '/api/webhooks/payments')).toBe('provider');
    expect(policyFor('GET', '/api/webhooks/payments')).toBeNull();
    expect(policyFor('post', '/api/staff/reports')).toEqual(['staff']);
  });
});

// Task 1.7: a student's age-gate standing x the route's clearance. `age_needed` is refused on every
// student route; `parent_needed` only on `agent` routes (starting a session, subscribing).
describe('age clearance x route matrix (1.7)', () => {
  const STATUSES: readonly AgeStatus[] = ['age_needed', 'parent_needed', 'clear'];
  const want = (status: AgeStatus, clearance: Clearance) =>
    status === 'age_needed' || (status === 'parent_needed' && clearance === 'agent') ? 403 : 200;

  for (const row of ROUTE_POLICY) {
    if (typeof row.access === 'string' || !row.access.includes('student')) continue;
    for (const method of row.methods) {
      const path = sample(row.pattern);
      it(`${method} ${path}`, async () => {
        for (const status of STATUSES) {
          const learnerStatus = vi.fn(async () => status);
          const guard = createGuard(() => deps({ learnerStatus }), noPages);
          const handler = vi.fn(() => new Response('ok'));
          const res = await guard.withRole(['student'], handler)(request(method, path, 'student'));
          const expected = want(status, ruleFor(method, path)!.clearance);
          expect(res.status, status).toBe(expected);
          expect(learnerStatus).toHaveBeenCalledWith('usr_student');
          if (expected === 403) {
            expect(handler).not.toHaveBeenCalled();
            expect(await errorOf(res)).toMatchObject({ code: 'forbidden', retryable: false });
          }
        }
      });
    }
  }

  it('agent routes are starting a session and subscribing; the rest need the age answer only', () => {
    expect(ruleFor('POST', '/api/sessions')?.clearance).toBe('agent');
    expect(ruleFor('POST', '/api/sessions/s_1/turns')?.clearance).toBe('agent');
    expect(ruleFor('POST', '/api/subscriptions')?.clearance).toBe('agent');
    expect(ruleFor('PATCH', '/api/subscriptions/sub_1')?.clearance).toBe('age');
    expect(ruleFor('GET', '/api/me/progress')?.clearance).toBe('age');
    expect(ruleFor('DELETE', '/api/me')?.clearance).toBe('age');
    expect(ruleFor('GET', '/api/studio/x')?.clearance).toBe('age');
    expect(ruleFor('GET', '/api/nowhere')).toBeNull();
    for (const row of ROUTE_POLICY) {
      if (row.clearance !== undefined) expect(row.access, row.pattern).toEqual(['student']);
    }
  });

  it('teachers and staff are never asked for an age answer', async () => {
    const learnerStatus = vi.fn(async (): Promise<AgeStatus> => 'age_needed');
    const guard = createGuard(() => deps({ learnerStatus }), noPages);
    const studio = guard.withRole(['teacher'], () => new Response('ok'));
    expect((await studio(request('GET', '/api/studio/x', 'teacher'))).status).toBe(200);
    const staff = guard.withRole(['staff'], () => new Response('ok'));
    expect((await staff(request('GET', '/api/staff/reports', 'staff'))).status).toBe(200);
    expect(learnerStatus).not.toHaveBeenCalled();
  });

  it('a learner erased since the session was read is signed out (401); other failures are 500', async () => {
    const gone = createGuard(
      () =>
        deps({
          learnerStatus: async () => {
            throw new RepositoryError('not_found', 'identity.learnerStatus');
          },
        }),
      noPages,
    );
    const route = gone.withRole(['student'], () => new Response('ok'));
    const res = await route(request('GET', '/api/me/progress', 'student'));
    expect(res.status).toBe(401);
    expect((await errorOf(res)).code).toBe('unauthorized');

    for (const error of [
      new RepositoryError('failed', 'identity.learnerStatus'),
      new Error('age policy: bad minAge'),
    ]) {
      const broken = createGuard(
        () =>
          deps({
            learnerStatus: async () => {
              throw error;
            },
          }),
        noPages,
      );
      const r = await broken.withRole(
        ['student'],
        () => new Response('ok'),
      )(request('GET', '/api/me/progress', 'student'));
      expect(r.status).toBe(500);
      expect((await errorOf(r)).code).toBe('provider_error');
    }
  });

  describe('requireRole', () => {
    function page() {
      const redirect = vi.fn((url: string): never => {
        throw new Error(`REDIRECT ${url}`);
      });
      const pageDeps: PageDeps = {
        cookies: async () => ({
          get: (name: string) => (name === 'who' ? { value: 'student' } : undefined),
        }),
        redirect,
        notFound: () => {
          throw new Error('NOT_FOUND');
        },
      };
      return { pageDeps, redirect };
    }
    const guardWith = (status: AgeStatus) => {
      const p = page();
      return {
        ...p,
        guard: createGuard(
          () => deps({ learnerStatus: async () => status }),
          () => p.pageDeps,
        ),
      };
    };

    it('sends a learner with no age answer to the age gate, except on the gate itself', async () => {
      const { guard } = guardWith('age_needed');
      await expect(guard.requireRole(['student'])).rejects.toThrow(`REDIRECT ${AGE_GATE_PATH}`);
      await expect(guard.requireRole(['student'], { clearance: 'agent' })).rejects.toThrow(
        `REDIRECT ${AGE_GATE_PATH}`,
      );
      expect(await guard.requireRole(['student'], { clearance: 'none' })).toEqual(
        PRINCIPALS.student,
      );
    });

    it('a learner waiting for a parent may open age pages, not agent pages', async () => {
      const { guard } = guardWith('parent_needed');
      expect(await guard.requireRole(['student'])).toEqual(PRINCIPALS.student);
      await expect(guard.requireRole(['student'], { clearance: 'agent' })).rejects.toThrow(
        `REDIRECT ${AGE_GATE_PATH}`,
      );
    });

    it('a clear learner opens every page', async () => {
      const { guard, redirect } = guardWith('clear');
      expect(await guard.requireRole(['student'], { clearance: 'agent' })).toEqual(
        PRINCIPALS.student,
      );
      expect(redirect).not.toHaveBeenCalled();
    });
  });
});
