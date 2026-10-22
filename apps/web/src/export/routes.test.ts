// Task 9.6 Phase B, acceptance item 3: the export routes over a fake backend (no database).
import { parsePdf } from '@edmate/ingest';
import { RepositoryError } from '@edmate/db';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import type { Principal, RoleContext } from '../auth/guard';
import type { ExportBackend } from './buildExport';
import { createExportHandlers } from './routes';

const STUDENT: Principal = { userId: 'std_amy', role: 'student' };

function ctxFor(principal: Principal, agentId: string | undefined): RoleContext {
  return { principal, params: Promise.resolve(agentId === undefined ? {} : { agentId }) };
}

function req(agentId: string): NextRequest {
  return new NextRequest(`http://localhost:8080/api/me/export/${agentId}`, { method: 'GET' });
}

function fakeBackend(
  overrides: { owner?: () => Promise<{ teacherId: string } | null>; fail?: boolean } = {},
): ExportBackend & { agents: { owner: () => Promise<{ teacherId: string } | null> } } {
  const owner = overrides.owner ?? (async () => ({ teacherId: 'tch_asha' }));
  const fail = overrides.fail ?? false;
  function maybeFail<T>(value: T): Promise<T> {
    if (fail) return Promise.reject(new RepositoryError('failed', 'sessions.listForStudent'));
    return Promise.resolve(value);
  }
  return {
    agents: { owner },
    sessions: { listForStudent: () => maybeFail({ items: [], next: null }) },
    messages: { listForStudent: () => maybeFail({ items: [], next: null }) },
    learnerProfiles: { get: () => maybeFail(null) },
    evidenceEvents: { list: () => maybeFail({ events: [], truncated: false }) },
    teacherQuestions: { listForStudent: () => maybeFail([]) },
    subscriptions: { findLive: () => maybeFail(null) },
    packageVersions: { getById: () => maybeFail(null) },
    outline: { getOutline: () => maybeFail(null) },
  };
}

describe('GET /api/me/export/:agentId (json)', () => {
  it('returns 200 application/json with an attachment disposition and no-store', async () => {
    const backend = fakeBackend();
    const { json } = createExportHandlers(backend);
    const res = await json(req('agt_1'), ctxFor(STUDENT, 'agt_1'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="edmate-export-agt_1.json"');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    const body = (await res.json()) as { format: string; agentId: string };
    expect(body.format).toBe('edmate-export');
    expect(body.agentId).toBe('agt_1');
  });

  it('a non-live, malformed or other teacher\'s agent gives 404', async () => {
    const backend = fakeBackend({ owner: async () => null });
    const { json } = createExportHandlers(backend);
    const res = await json(req('agt_1'), ctxFor(STUDENT, 'agt_1'));
    expect(res.status).toBe(404);
  });

  it('a malformed agentId path param gives 404', async () => {
    const backend = fakeBackend();
    const { json } = createExportHandlers(backend);
    const res = await json(req('x'), ctxFor(STUDENT, ''));
    expect(res.status).toBe(404);
  });

  it('a repository failure gives 500 with only the error name logged, never a raw message', async () => {
    const backend = fakeBackend({ fail: true });
    const { json } = createExportHandlers(backend);
    const res = await json(req('agt_1'), ctxFor(STUDENT, 'agt_1'));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).not.toMatch(/sessions\.listForStudent/);
  });

  it('logs the error name (never its message) on the 500 path', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const backend = fakeBackend({ fail: true });
    const { json } = createExportHandlers(backend);
    await json(req('agt_1'), ctxFor(STUDENT, 'agt_1'));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('RepositoryError'));
    expect(spy.mock.calls.flat().join(' ')).not.toMatch(/sessions\.listForStudent/);
    spy.mockRestore();
  });
});

describe('GET /api/me/export/:agentId/notes (pdf)', () => {
  it('returns 200 application/pdf with an attachment disposition and no-store', async () => {
    const backend = fakeBackend();
    const { notes } = createExportHandlers(backend);
    const res = await notes(req('agt_1'), ctxFor(STUDENT, 'agt_1'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="edmate-notes-agt_1.pdf"');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const bytes = new Uint8Array(await res.arrayBuffer());
    const doc = await parsePdf(bytes, 'notes');
    expect(doc.units.length).toBeGreaterThanOrEqual(1);
  });

  it('a non-live agent gives 404', async () => {
    const backend = fakeBackend({ owner: async () => null });
    const { notes } = createExportHandlers(backend);
    const res = await notes(req('agt_1'), ctxFor(STUDENT, 'agt_1'));
    expect(res.status).toBe(404);
  });

  it('a repository failure gives 500', async () => {
    const backend = fakeBackend({ fail: true });
    const { notes } = createExportHandlers(backend);
    const res = await notes(req('agt_1'), ctxFor(STUDENT, 'agt_1'));
    expect(res.status).toBe(500);
  });
});
