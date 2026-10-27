// Task 13.4b: `DELETE /api/me` over a fake backend (no database; rule 4).
import { RepositoryError } from '@edmate/db';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import type { RoleContext } from '../auth/guard';
import { createDeleteHandler, type DeleteBackend } from './delete';

const STUDENT = 'std_amy';

function ctx(userId = STUDENT): RoleContext {
  return { principal: { userId, role: 'student' }, params: Promise.resolve({}) };
}

function req(body?: unknown): NextRequest {
  return new NextRequest('http://localhost:8080/api/me', {
    method: 'DELETE',
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

function fakeBackend(
  overrides: {
    hasOpen?: boolean;
    anonymiseError?: RepositoryError | Error;
    signOutError?: Error;
  } = {},
): DeleteBackend & {
  calls: { hasOpenFor: string[]; anonymiseFor: string[]; signOutCalled: number };
} {
  const calls = { hasOpenFor: [] as string[], anonymiseFor: [] as string[], signOutCalled: 0 };
  return {
    calls,
    safetyAlerts: {
      hasOpenForStudent: async (studentId: string) => {
        calls.hasOpenFor.push(studentId);
        return overrides.hasOpen ?? false;
      },
    },
    identity: {
      anonymise: async (userId: string) => {
        calls.anonymiseFor.push(userId);
        if (overrides.anonymiseError) throw overrides.anonymiseError;
      },
    },
    signOut: async () => {
      calls.signOutCalled += 1;
      if (overrides.signOutError) throw overrides.signOutError;
    },
  };
}

describe('DELETE /api/me', () => {
  it("anonymises the signed-in principal's own id and signs out, 200 deleted:true, no-store", async () => {
    const backend = fakeBackend();
    const handler = createDeleteHandler(backend);
    const res = await handler(req(), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ deleted: true });
    expect(backend.calls.hasOpenFor).toEqual([STUDENT]);
    expect(backend.calls.anonymiseFor).toEqual([STUDENT]);
    expect(backend.calls.signOutCalled).toBe(1);
  });

  it("never accepts a body-supplied studentId or teacherId; only the principal's own id is used", async () => {
    const backend = fakeBackend();
    const handler = createDeleteHandler(backend);
    await handler(
      req({ studentId: 'stu_other', teacherId: 'tch_other', userId: 'stu_other' }),
      ctx(),
    );
    expect(backend.calls.anonymiseFor).toEqual([STUDENT]);
  });

  it('a student with an open safety alert gets 409 delete_on_hold; nothing is anonymised, no sign-out', async () => {
    const backend = fakeBackend({ hasOpen: true });
    const handler = createDeleteHandler(backend);
    const res = await handler(req(), ctx());
    expect(res.status).toBe(409);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('delete_on_hold');
    expect(body.message).toMatch(/safety check/);
    expect(backend.calls.anonymiseFor).toEqual([]);
    expect(backend.calls.signOutCalled).toBe(0);
  });

  it('anonymise not_found/scope gives 404', async () => {
    for (const kind of ['not_found', 'scope'] as const) {
      const backend = fakeBackend({
        anonymiseError: new RepositoryError(kind, 'identity.anonymise'),
      });
      const handler = createDeleteHandler(backend);
      const res = await handler(req(), ctx());
      expect(res.status).toBe(404);
      expect(backend.calls.signOutCalled).toBe(0);
    }
  });

  it('any other anonymise failure gives 500, logging only the error name, never a raw message', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const backend = fakeBackend({
      anonymiseError: new RepositoryError('failed', 'identity.anonymise'),
    });
    const handler = createDeleteHandler(backend);
    const res = await handler(req(), ctx());
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain('identity.anonymise');
    expect(spy.mock.calls.flat().join(' ')).toContain('RepositoryError');
    expect(spy.mock.calls.flat().join(' ')).not.toContain('identity.anonymise');
    spy.mockRestore();
  });

  it('a sign-out failure after a successful delete is still 200 deleted:true; the failure is logged', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const backend = fakeBackend({ signOutError: new Error('redis down') });
    const handler = createDeleteHandler(backend);
    const res = await handler(req(), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    expect(backend.calls.anonymiseFor).toEqual([STUDENT]);
    expect(spy.mock.calls.flat().join(' ')).toContain('Error');
    spy.mockRestore();
  });
});
