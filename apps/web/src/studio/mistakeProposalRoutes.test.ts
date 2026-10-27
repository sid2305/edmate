// Task 6.3a Phase B: list + approve/reject a teacher's proposed mistake tags, over a fake
// mistakeProposals repo (no database, no real model; rule 4). GET is scoped to the session
// teacher; PATCH is replaced by POST (the existing ROUTE_POLICY row for /api/studio/** already
// allows GET/POST/PUT/DELETE, not PATCH — see the handoff decision).
import type { StyleCard } from '@edmate/contracts';
import { RepositoryError, type Repositories } from '@edmate/db';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import type { Principal, RoleContext } from '../auth/guard';
import { createMistakeProposalHandlers } from './mistakeProposalRoutes';

const ASHA: Principal = { userId: 't_asha', role: 'teacher' };
const ctx: RoleContext = { principal: ASHA, params: Promise.resolve({}) };
const URL = 'http://localhost:8080/api/studio/mistake-proposals';

function req(body?: unknown, method = 'GET'): NextRequest {
  return new NextRequest(URL, {
    method,
    ...(body === undefined
      ? {}
      : {
          body: typeof body === 'string' ? body : JSON.stringify(body),
          headers: { 'content-type': 'application/json' },
        }),
  });
}

type Row = {
  tag: string;
  count: number;
  lastSeen: string;
  status: 'pending' | 'approved' | 'rejected';
};

function memoryRepo() {
  const listPending = vi.fn(async (_scope: { teacherId: string }): Promise<Row[]> => []);
  const approve = vi.fn(
    async (
      _scope: { teacherId: string },
      _tag: string,
    ): Promise<{ approved: boolean; card: StyleCard | null }> => ({ approved: true, card: null }),
  );
  const reject = vi.fn(
    async (_scope: { teacherId: string }, _tag: string): Promise<{ rejected: boolean }> => ({
      rejected: true,
    }),
  );
  const repos = { mistakeProposals: { listPending, approve, reject } } as unknown as Pick<
    Repositories,
    'mistakeProposals'
  >;
  return { listPending, approve, reject, repos };
}

function setup(repo = memoryRepo()) {
  const log = { error: vi.fn() };
  const handlers = createMistakeProposalHandlers({ repos: () => repo.repos }, log);
  return { repo, handlers, log };
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}
const errorCode = async (res: Response) =>
  ((await json(res)).error as { code: string; retryable: boolean }).code;

describe('mistake proposals API: list', () => {
  it("returns the session teacher's own pending rows, scoped", async () => {
    const { handlers, repo } = setup();
    const rows: Row[] = [
      { tag: 'units', count: 3, lastSeen: '2026-10-01T00:00:00Z', status: 'pending' },
    ];
    repo.listPending.mockResolvedValueOnce(rows);
    const res = await handlers.list(req(), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await json(res)).toEqual({ proposals: rows });
    expect(repo.listPending).toHaveBeenCalledWith({ teacherId: 't_asha' });
  });

  it('maps a repository failure to a fixed 500', async () => {
    const { handlers, repo } = setup();
    repo.listPending.mockRejectedValueOnce(new RepositoryError('failed', 'listPending'));
    const res = await handlers.list(req(), ctx);
    expect(res.status).toBe(500);
    expect(await errorCode(res)).toBe('provider_error');
  });
});

describe('mistake proposals API: decide', () => {
  it('approve calls the repo and returns the new card', async () => {
    const { handlers, repo } = setup();
    const card: StyleCard = {
      id: 'sty_2',
      teacherId: 't_asha',
      version: 2,
      text: 'x',
      mistakeTags: ['units'],
    };
    repo.approve.mockResolvedValueOnce({ approved: true, card });
    const res = await handlers.decide(req({ tag: 'units', action: 'approve' }, 'POST'), ctx);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ approved: true, card });
    expect(repo.approve).toHaveBeenCalledWith({ teacherId: 't_asha' }, 'units');
    expect(repo.reject).not.toHaveBeenCalled();
  });

  it('reject calls the repo and returns the result, never touching approve', async () => {
    const { handlers, repo } = setup();
    repo.reject.mockResolvedValueOnce({ rejected: true });
    const res = await handlers.decide(req({ tag: 'units', action: 'reject' }, 'POST'), ctx);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ rejected: true });
    expect(repo.reject).toHaveBeenCalledWith({ teacherId: 't_asha' }, 'units');
    expect(repo.approve).not.toHaveBeenCalled();
  });

  it('a malformed body is validation, before the repo is touched', async () => {
    const { handlers, repo } = setup();
    const res = await handlers.decide(req({ tag: '', action: 'approve' }, 'POST'), ctx);
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('validation');
    expect(repo.approve).not.toHaveBeenCalled();
  });

  it('an unknown action is validation', async () => {
    const { handlers, repo } = setup();
    const res = await handlers.decide(req({ tag: 'units', action: 'delete' }, 'POST'), ctx);
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('validation');
    expect(repo.approve).not.toHaveBeenCalled();
    expect(repo.reject).not.toHaveBeenCalled();
  });

  it('non-JSON body is validation', async () => {
    const { handlers } = setup();
    const res = await handlers.decide(req('not json', 'POST'), ctx);
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('validation');
  });

  it('maps RepositoryError scope/not_found/limit through the fixed-status switch', async () => {
    const { handlers, repo } = setup();
    repo.approve.mockRejectedValueOnce(new RepositoryError('scope', 'approve'));
    let res = await handlers.decide(req({ tag: 'units', action: 'approve' }, 'POST'), ctx);
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('forbidden');

    repo.approve.mockRejectedValueOnce(new RepositoryError('not_found', 'approve'));
    res = await handlers.decide(req({ tag: 'units', action: 'approve' }, 'POST'), ctx);
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe('not_found');

    repo.approve.mockRejectedValueOnce(new RepositoryError('limit', 'approve'));
    res = await handlers.decide(req({ tag: 'units', action: 'approve' }, 'POST'), ctx);
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('limit_reached');
  });
});
