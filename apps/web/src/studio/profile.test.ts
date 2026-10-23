// Task 8.1a: the onboarding profile route's handlers over a fake `teacherProfiles` repo (no
// database; rule 4). The teacher is always the session's own principal: a body that tries to set
// `teacherId`/`userId` is ignored, never read as the scope.
import { RepositoryError, type Repositories, type TeacherProfileRow } from '@edmate/db';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import type { Principal, RoleContext } from '../auth/guard';
import { MAX_BODY_BYTES } from './routes';
import { createProfileHandlers } from './profile';

const ASHA: Principal = { userId: 't_asha', role: 'teacher' };

const ROW: TeacherProfileRow = {
  id: 'tp_1',
  teacherId: 't_asha',
  slug: 'asha-math',
  displayName: 'Asha',
  subject: 'Math',
  bio: '',
  languages: [],
  verificationStatus: 'pending',
};

function ctxFor(principal: Principal): RoleContext {
  return { principal, params: Promise.resolve({}) };
}

function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost:8080/api/studio/profile', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

/** A fake `teacherProfiles` repo recording the scope each call used. */
function fakeRepos(overrides: {
  create?: (scope: unknown, input: unknown) => Promise<TeacherProfileRow>;
  update?: (scope: unknown, input: unknown) => Promise<TeacherProfileRow>;
} = {}) {
  const calls: { method: string; scope: unknown; input: unknown }[] = [];
  const create = vi.fn(async (scope: unknown, input: unknown) => {
    calls.push({ method: 'create', scope, input });
    if (overrides.create) return overrides.create(scope, input);
    return ROW;
  });
  const update = vi.fn(async (scope: unknown, input: unknown) => {
    calls.push({ method: 'update', scope, input });
    if (overrides.update) return overrides.update(scope, input);
    return ROW;
  });
  const repos = {
    teacherProfiles: { create, update },
  } as unknown as Pick<Repositories, 'teacherProfiles'>;
  return { calls, repos };
}

describe('createProfileHandlers', () => {
  it('create: forwards the body as-is with the session as the scope', async () => {
    const { repos, calls } = fakeRepos();
    const handlers = createProfileHandlers({ repos: () => repos });
    const res = await handlers.create(
      req({ slug: 'asha-math', subject: 'Math' }),
      ctxFor(ASHA),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ profile: ROW });
    expect(calls).toEqual([
      { method: 'create', scope: { teacherId: 't_asha' }, input: { slug: 'asha-math', subject: 'Math' } },
    ]);
  });

  it('create: a body teacherId/userId is ignored -- the scope is always the session', async () => {
    const { repos, calls } = fakeRepos();
    const handlers = createProfileHandlers({ repos: () => repos });
    await handlers.create(
      req({ slug: 'asha-math', subject: 'Math', teacherId: 't_ben', userId: 't_ben' }),
      ctxFor(ASHA),
    );
    expect(calls[0]?.scope).toEqual({ teacherId: 't_asha' });
  });

  it('update: forwards the body as-is with the session as the scope', async () => {
    const { repos, calls } = fakeRepos();
    const handlers = createProfileHandlers({ repos: () => repos });
    const res = await handlers.update(req({ subject: 'Physics' }), ctxFor(ASHA));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ profile: ROW });
    expect(calls).toEqual([
      { method: 'update', scope: { teacherId: 't_asha' }, input: { subject: 'Physics' } },
    ]);
  });

  it('a bad body (missing subject) never reaches the repo: the repo\'s own invalid is 400', async () => {
    const { repos, calls } = fakeRepos({
      create: () => {
        throw new RepositoryError('invalid', 'teacherProfiles.create');
      },
    });
    const handlers = createProfileHandlers({ repos: () => repos });
    const res = await handlers.create(req({ slug: 'asha-math' }), ctxFor(ASHA));
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: 'validation' },
    });
    expect(calls.length).toBe(1);
  });

  it('a body with a verificationStatus key is the repo\'s own invalid, never reaches SQL', async () => {
    const { repos } = fakeRepos({
      create: () => {
        throw new RepositoryError('invalid', 'teacherProfiles.create');
      },
    });
    const handlers = createProfileHandlers({ repos: () => repos });
    const res = await handlers.create(
      req({ slug: 'asha-math', subject: 'Math', verificationStatus: 'verified' }),
      ctxFor(ASHA),
    );
    expect(res.status).toBe(400);
  });

  it('an oversize body is refused before parsing (413)', async () => {
    const { repos, calls } = fakeRepos();
    const handlers = createProfileHandlers({ repos: () => repos });
    const big = 'x'.repeat(MAX_BODY_BYTES + 1);
    const res = await handlers.create(
      req({ slug: 'asha-math', subject: 'Math', bio: big }),
      ctxFor(ASHA),
    );
    expect(res.status).toBe(413);
    expect(calls.length).toBe(0);
  });

  it('a malformed JSON body is validation, never reaches the repo', async () => {
    const { repos, calls } = fakeRepos();
    const handlers = createProfileHandlers({ repos: () => repos });
    const malformed = new NextRequest('http://localhost:8080/api/studio/profile', {
      method: 'POST',
      body: '{not json',
      headers: { 'content-type': 'application/json' },
    });
    const res = await handlers.create(malformed, ctxFor(ASHA));
    expect(res.status).toBe(400);
    expect(calls.length).toBe(0);
  });

  it.each([
    ['scope', 403],
    ['not_found', 404],
    ['invalid', 400],
    ['integrity', 400],
    ['failed', 500],
  ] as const)('maps a %s repository error to %i', async (kind, status) => {
    const { repos } = fakeRepos({
      update: () => {
        throw new RepositoryError(kind, 'teacherProfiles.update');
      },
    });
    const handlers = createProfileHandlers({ repos: () => repos });
    const res = await handlers.update(req({ subject: 'Physics' }), ctxFor(ASHA));
    expect(res.status).toBe(status);
  });

  it('an unexpected error is 500, never the repo\'s own message text', async () => {
    const { repos } = fakeRepos({
      update: () => {
        throw new Error('pg: duplicate key on teacher_profiles_slug_key (t_asha)');
      },
    });
    const handlers = createProfileHandlers({ repos: () => repos });
    const res = await handlers.update(req({ subject: 'Physics' }), ctxFor(ASHA));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).not.toMatch(/duplicate|t_asha/);
  });
});
