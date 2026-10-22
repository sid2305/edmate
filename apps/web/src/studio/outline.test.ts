// Task 8.3 Phase B: the outline API's handlers over a memory backend (no real database or model
// call; rule 4). Generation uses the scripted gateway (`@edmate/harness/testing`), never a real
// provider. The teacher always comes from the session's principal (`ctx.principal.userId`), never
// a body field.
import { manualClock, ScriptedGateway, type GatewayScript } from '@edmate/harness/testing';
import type {
  ModuleChunk,
  Outline,
  OutlineInput,
  RepositoryError as RepositoryErrorType,
} from '@edmate/db';
import { RepositoryError } from '@edmate/db';
import { describe, expect, it, vi } from 'vitest';
import type { Principal, RoleContext } from '../auth/guard';
import { createOutlineHandlers, type OutlineBackend } from './outline';
import { StudioUnavailableError, type ServerLog } from './routes';

const ORIGIN = 'http://localhost:8080';
const ASHA: Principal = { userId: 't_asha', role: 'teacher' };

interface Fixture {
  courseId: string;
  modules: Outline['modules'];
  chunksByModule: Record<string, ModuleChunk[]>;
}

/** An in-memory outline over one teacher (`t_asha`): enough of Phase A's repositories' contract
 * (not_found / invalid, counts-only) to drive this file's handler logic. */
function memoryBackend(seed: Fixture, gatewayScript: GatewayScript = {}) {
  let outlineVersion = 0;
  let modules = seed.modules;
  const logs: { event: string; fields?: Record<string, string> }[] = [];
  const replaceCalls: unknown[] = [];
  const gateway = new ScriptedGateway(gatewayScript, manualClock());

  const outline = (): Outline => ({ courseId: seed.courseId, outlineVersion, modules });

  const backend: OutlineBackend = {
    courses: {
      ensureDefault: vi.fn(async () => ({ id: seed.courseId, title: 'My course', outlineVersion })),
    },
    outline: {
      getOutline: vi.fn(async () => outline()),
      replaceOutline: vi.fn(async (_scope, input: OutlineInput) => {
        replaceCalls.push(input);
        const named = new Set(input.modules.map((m) => m.id));
        const allChunkIds = new Set(Object.values(seed.chunksByModule).flatMap((cs) => cs.map((c) => c.id)));
        for (const m of input.modules) {
          if (!modules.some((x) => x.id === m.id)) {
            throw new RepositoryError('not_found', 'outline.replaceOutline');
          }
          for (const t of m.topics) {
            for (const id of t.chunkIds) {
              if (!allChunkIds.has(id)) throw new RepositoryError('invalid', 'outline.replaceOutline');
            }
          }
        }
        outlineVersion += 1;
        modules = modules.map((m) => {
          const incoming = input.modules.find((x) => x.id === m.id);
          if (!named.has(m.id) || !incoming) return m;
          return {
            id: m.id,
            title: incoming.title,
            order: incoming.order,
            topics: incoming.topics.map((t, i) => ({
              id: t.id ?? `${m.id}_t${i}_new`,
              title: t.title,
              order: t.order,
              chunkIds: t.chunkIds.map((chunkId) => ({
                chunkId,
                sourceTitle: 'doc.pdf',
                locator: chunkId,
              })),
            })),
          };
        });
        return { courseId: seed.courseId, outlineVersion };
      }),
    },
    chunks: {
      listForModule: vi.fn(async (_scope, moduleId: string) => seed.chunksByModule[moduleId] ?? []),
    },
    gateway,
    log: { error: (event, fields) => logs.push({ event, ...(fields ? { fields } : {}) }) },
  };
  return { backend, logs, replaceCalls, currentModules: () => modules, currentVersion: () => outlineVersion };
}

function setup(seed: Fixture, script: GatewayScript = {}) {
  const mem = memoryBackend(seed, script);
  const h = createOutlineHandlers(async () => mem.backend, mem.backend.log);
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
  }) as unknown as Parameters<ReturnType<typeof createOutlineHandlers>['get']>[0];
}

async function json(res: Response) {
  return (await res.json()) as Record<string, unknown> & {
    error?: { code: string; message: string; retryable: boolean };
  };
}

const EMPTY_MODULE = { id: 'm1', title: 'Module 1', order: 0, topics: [] };
const SEED_EMPTY: Fixture = { courseId: 'course_1', modules: [EMPTY_MODULE], chunksByModule: {} };

const CHUNKS_M2: ModuleChunk[] = [
  { id: 'c1', text: 'Ratios and proportions', locator: 'p1', sourceTitle: 'doc.pdf' },
  { id: 'c2', text: 'Fractions', locator: 'p2', sourceTitle: 'doc.pdf' },
];
const SEED_WITH_CHUNKS: Fixture = {
  courseId: 'course_1',
  modules: [
    { id: 'm1', title: 'Module 1', order: 0, topics: [] },
    { id: 'm2', title: 'Module 2', order: 1, topics: [] },
  ],
  chunksByModule: { m2: CHUNKS_M2 },
};

describe('GET /api/studio/outline', () => {
  it("ensures the teacher's course exists, then returns the outline", async () => {
    const s = setup(SEED_EMPTY);
    const res = await s.h.get(req('GET', '/api/studio/outline'), ctx(ASHA));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ courseId: 'course_1', outlineVersion: 0, modules: [EMPTY_MODULE] });
    expect(s.backend.courses.ensureDefault).toHaveBeenCalledWith({ teacherId: 't_asha' });
  });

  it('a backend that cannot be built is 503, logged by reason only', async () => {
    const h = createOutlineHandlers(
      async () => {
        throw new StudioUnavailableError('REDIS_URL');
      },
      { error: vi.fn() } as ServerLog,
    );
    const res = await h.get(req('GET', '/api/studio/outline'), ctx(ASHA));
    expect(res.status).toBe(503);
    expect((await json(res)).error?.code).toBe('provider_error');
  });

  it('a null outline after ensureDefault is a logged 500 (defensive)', async () => {
    const s = setup(SEED_EMPTY);
    vi.mocked(s.backend.outline.getOutline).mockResolvedValueOnce(null);
    const res = await s.h.get(req('GET', '/api/studio/outline'), ctx(ASHA));
    expect(res.status).toBe(500);
    expect(s.logs).toContainEqual({ event: 'outline.missing_after_ensure', fields: {} });
  });
});

describe('PUT /api/studio/outline', () => {
  const BODY = {
    modules: [{ id: 'm1', title: 'Renamed', order: 0, topics: [{ title: 'T1', order: 0, chunkIds: [] }] }],
  };

  it('replaces the outline and returns the new version', async () => {
    const s = setup(SEED_EMPTY);
    const res = await s.h.put(req('PUT', '/api/studio/outline', BODY), ctx(ASHA));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ courseId: 'course_1', outlineVersion: 1 });
    expect(s.replaceCalls).toEqual([BODY]);
  });

  it('a malformed body (missing chunkIds) is 400, nothing written', async () => {
    const s = setup(SEED_EMPTY);
    const bad = { modules: [{ id: 'm1', title: 'X', order: 0, topics: [{ title: 'T', order: 0 }] }] };
    const res = await s.h.put(req('PUT', '/api/studio/outline', bad), ctx(ASHA));
    expect(res.status).toBe(400);
    expect((await json(res)).error?.code).toBe('validation');
    expect(s.backend.outline.replaceOutline).not.toHaveBeenCalled();
  });

  it('an unknown chunk id is 400 (the repository refuses, nothing written)', async () => {
    const s = setup(SEED_EMPTY);
    const bad = {
      modules: [{ id: 'm1', title: 'X', order: 0, topics: [{ title: 'T', order: 0, chunkIds: ['ghost'] }] }],
    };
    const res = await s.h.put(req('PUT', '/api/studio/outline', bad), ctx(ASHA));
    expect(res.status).toBe(400);
    expect((await json(res)).error?.code).toBe('validation');
  });

  it("another teacher's module id is 404", async () => {
    const s = setup(SEED_EMPTY);
    const bad = { modules: [{ id: 'm_ghost', title: 'X', order: 0, topics: [] }] };
    const res = await s.h.put(req('PUT', '/api/studio/outline', bad), ctx(ASHA));
    expect(res.status).toBe(404);
  });

  it('a body over the size cap is 413, nothing read', async () => {
    const s = setup(SEED_EMPTY);
    const res = await s.h.put(
      req('PUT', '/api/studio/outline', undefined, { 'content-length': '999999' }),
      ctx(ASHA),
    );
    expect(res.status).toBe(413);
    expect(s.backend.outline.replaceOutline).not.toHaveBeenCalled();
  });
});

describe('POST /api/studio/outline/generate', () => {
  it('skips a module with no ready chunks and drafts only the one that has them', async () => {
    const s = setup(SEED_WITH_CHUNKS, {
      generateObject: [
        {
          value: {
            topics: [
              { topic: 'Ratios', chunkIds: ['c1'] },
              { topic: 'Fractions', chunkIds: ['c2'] },
            ],
          },
        },
      ],
    });
    const res = await s.h.generate(req('POST', '/api/studio/outline/generate'), ctx(ASHA));
    expect(res.status).toBe(200);
    expect(s.backend.chunks.listForModule).toHaveBeenCalledWith({ teacherId: 't_asha' }, 'm1');
    expect(s.backend.chunks.listForModule).toHaveBeenCalledWith({ teacherId: 't_asha' }, 'm2');
    expect(s.replaceCalls).toEqual([
      {
        modules: [
          {
            id: 'm2',
            title: 'Module 2',
            order: 1,
            topics: [
              { title: 'Ratios', order: 0, chunkIds: ['c1'] },
              { title: 'Fractions', order: 1, chunkIds: ['c2'] },
            ],
          },
        ],
      },
    ]);
    const body = await json(res);
    expect(body).toEqual({ courseId: 'course_1', outlineVersion: 1, modules: s.currentModules() });
    // m1 (no chunks) is untouched by the write.
    expect(s.currentModules().find((m) => m.id === 'm1')).toEqual({
      id: 'm1',
      title: 'Module 1',
      order: 0,
      topics: [],
    });
  });

  it('no ready chunks anywhere is 400, nothing drafted or written', async () => {
    const s = setup(SEED_EMPTY);
    const res = await s.h.generate(req('POST', '/api/studio/outline/generate'), ctx(ASHA));
    expect(res.status).toBe(400);
    expect(s.backend.outline.replaceOutline).not.toHaveBeenCalled();
  });

  it("a write the repository refuses (e.g. a topic with student evidence) surfaces as 400", async () => {
    const s = setup(SEED_WITH_CHUNKS, {
      generateObject: [{ value: { topics: [{ topic: 'Ratios', chunkIds: ['c1', 'c2'] }] } }],
    });
    vi.mocked(s.backend.outline.replaceOutline).mockRejectedValueOnce(
      new RepositoryError('invalid' as RepositoryErrorType['kind'], 'outline.replaceOutline'),
    );
    const res = await s.h.generate(req('POST', '/api/studio/outline/generate'), ctx(ASHA));
    expect(res.status).toBe(400);
  });

  it('an unexpected error is a logged 500, never the thrown message', async () => {
    const s = setup(SEED_WITH_CHUNKS, { generateObject: [{ value: { topics: [{ topic: 'Ratios', chunkIds: ['c1'] }] } }] });
    vi.mocked(s.backend.outline.replaceOutline).mockRejectedValueOnce(new Error('boom: secret'));
    const res = await s.h.generate(req('POST', '/api/studio/outline/generate'), ctx(ASHA));
    expect(res.status).toBe(500);
    expect(s.logs).toEqual([{ event: 'outline.failed', fields: { error: 'Error' } }]);
    expect(JSON.stringify(await json(res))).not.toContain('secret');
  });
});
