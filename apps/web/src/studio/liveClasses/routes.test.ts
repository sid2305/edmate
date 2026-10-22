// Task 11.1b Phase B: the live-classes API's handlers over a fake backend (no real database;
// rule 4). The teacher always comes from the session's principal (`ctx.principal.userId`), never
// a body field.
import type { TeacherLiveClassRow } from '@edmate/db';
import { RepositoryError } from '@edmate/db';
import { describe, expect, it, vi } from 'vitest';
import type { Principal, RoleContext } from '../../auth/guard';
import { StudioUnavailableError, type ServerLog } from '../routes';
import { createLiveClassesHandlers, type LiveClassesBackend } from './routes';

const ORIGIN = 'http://localhost:8080';
const ASHA: Principal = { userId: 't_asha', role: 'teacher' };

const CLASS: TeacherLiveClassRow = {
  id: 'lc_1',
  title: 'Ratios review',
  link: 'https://meet.example.com/abc',
  startsAt: '2026-11-01T10:00:00.000Z',
  packageIds: ['pkg_1'],
};

function memoryBackend() {
  const logs: { event: string; fields?: Record<string, string> }[] = [];
  const backend: LiveClassesBackend = {
    liveClasses: {
      listForTeacher: vi.fn(async () => [CLASS]),
      create: vi.fn(async () => ({ id: 'lc_new' })),
    },
    log: { error: (event, fields) => logs.push({ event, ...(fields ? { fields } : {}) }) },
  };
  return { backend, logs };
}

function setup() {
  const mem = memoryBackend();
  const h = createLiveClassesHandlers(async () => mem.backend, mem.backend.log);
  return { ...mem, h };
}

function ctx(principal: Principal, params: Record<string, string> = {}): RoleContext {
  return { principal, params: Promise.resolve(params) };
}

function req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  }) as unknown as Parameters<ReturnType<typeof createLiveClassesHandlers>['list']>[0];
}

async function json(res: Response) {
  return (await res.json()) as Record<string, unknown> & {
    error?: { code: string; message: string; retryable: boolean };
  };
}

const VALID_BODY = {
  title: 'Ratios review',
  link: 'https://meet.example.com/abc',
  startsAt: '2026-11-01T10:00:00.000Z',
  packageIds: ['pkg_1'],
};

describe('GET /api/studio/live-classes', () => {
  it("returns only the signed-in teacher's own classes, soonest first", async () => {
    const s = setup();
    const res = await s.h.list(req('GET', '/api/studio/live-classes'), ctx(ASHA));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await json(res)).toEqual({ classes: [CLASS] });
    expect(s.backend.liveClasses.listForTeacher).toHaveBeenCalledWith({ teacherId: 't_asha' });
  });

  it('a backend that cannot be built is 503, logged by reason only', async () => {
    const h = createLiveClassesHandlers(
      async () => {
        throw new StudioUnavailableError('DATABASE_URL');
      },
      { error: vi.fn() } as ServerLog,
    );
    const res = await h.list(req('GET', '/api/studio/live-classes'), ctx(ASHA));
    expect(res.status).toBe(503);
    expect((await json(res)).error?.code).toBe('provider_error');
  });
});

describe('POST /api/studio/live-classes', () => {
  it('schedules a class with the signed-in teacher as scope, never from the body', async () => {
    const s = setup();
    const res = await s.h.create(req('POST', '/api/studio/live-classes', VALID_BODY), ctx(ASHA));
    expect(res.status).toBe(201);
    expect(await json(res)).toEqual({ id: 'lc_new' });
    expect(s.backend.liveClasses.create).toHaveBeenCalledWith({ teacherId: 't_asha' }, VALID_BODY);
  });

  it('a non-https link is 400, nothing written', async () => {
    const s = setup();
    const res = await s.h.create(
      req('POST', '/api/studio/live-classes', { ...VALID_BODY, link: 'http://meet.example.com/abc' }),
      ctx(ASHA),
    );
    expect(res.status).toBe(400);
    expect(s.backend.liveClasses.create).not.toHaveBeenCalled();
  });

  it('a link over 2048 characters is 400, nothing written', async () => {
    const s = setup();
    const res = await s.h.create(
      req('POST', '/api/studio/live-classes', {
        ...VALID_BODY,
        link: `https://meet.example.com/${'a'.repeat(2048)}`,
      }),
      ctx(ASHA),
    );
    expect(res.status).toBe(400);
    expect(s.backend.liveClasses.create).not.toHaveBeenCalled();
  });

  it('a non-matching body shape is 400', async () => {
    const s = setup();
    const res = await s.h.create(
      req('POST', '/api/studio/live-classes', { title: 'x' }),
      ctx(ASHA),
    );
    expect(res.status).toBe(400);
    expect(s.backend.liveClasses.create).not.toHaveBeenCalled();
  });

  it('an unknown field is 400 (strict body)', async () => {
    const s = setup();
    const res = await s.h.create(
      req('POST', '/api/studio/live-classes', { ...VALID_BODY, teacherId: 'leaked' }),
      ctx(ASHA),
    );
    expect(res.status).toBe(400);
  });

  it('a body over the size cap is 413 before parsing', async () => {
    const s = setup();
    const res = await s.h.create(
      req('POST', '/api/studio/live-classes', { a: 'x'.repeat(20_000) }, {
        'content-length': String(20_010),
      }),
      ctx(ASHA),
    );
    expect(res.status).toBe(413);
    expect(s.backend.liveClasses.create).not.toHaveBeenCalled();
  });

  it("a repository not_found (a package id that isn't the teacher's own) is 404, nothing written", async () => {
    const s = setup();
    vi.mocked(s.backend.liveClasses.create).mockRejectedValueOnce(
      new RepositoryError('not_found', 'liveClasses.create'),
    );
    const res = await s.h.create(req('POST', '/api/studio/live-classes', VALID_BODY), ctx(ASHA));
    expect(res.status).toBe(404);
  });

  it('a repository invalid (e.g. a past startsAt) is 400', async () => {
    const s = setup();
    vi.mocked(s.backend.liveClasses.create).mockRejectedValueOnce(
      new RepositoryError('invalid', 'liveClasses.create'),
    );
    const res = await s.h.create(req('POST', '/api/studio/live-classes', VALID_BODY), ctx(ASHA));
    expect(res.status).toBe(400);
  });

  it('an unknown error is a logged 500, with the error name only (no title/link text)', async () => {
    const s = setup();
    vi.mocked(s.backend.liveClasses.create).mockRejectedValueOnce(new Error('db exploded'));
    const res = await s.h.create(
      req('POST', '/api/studio/live-classes', { ...VALID_BODY, title: 'a secret-ish title' }),
      ctx(ASHA),
    );
    expect(res.status).toBe(500);
    expect(s.logs).toEqual([{ event: 'liveClasses.failed', fields: { error: 'Error' } }]);
    expect(JSON.stringify(s.logs)).not.toContain('secret-ish');
  });
});
