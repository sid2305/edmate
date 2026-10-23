// Task 8.5 Phase B: the teacher's test-chat routes end to end over memory ports, the real
// `defaultSteps` and the scripted gateway (rule 4: no real model call). The guard is the real
// `createGuard` with fake dependencies, and ROUTE_POLICY's `/api/studio/**` row decides access.
import { LIMITS, TurnEventSchema, type TurnEvent } from '@edmate/contracts';
import {
  RepositoryError,
  type CorrectionRecordInput,
  type StudentScope,
  type TeacherScope,
} from '@edmate/db';
import { memoryEntitlementStore } from '@edmate/harness/testing';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { memoryBackend, says, type MemoryBackendOptions } from '../../../test/turn-backend';
import { createGuard, type GuardDeps, type Principal } from '../../auth/guard';
import { TurnUnavailableError } from '../../turn/routes';
import { createTestChatHandlers, type TestChatBackend } from './routes';

const ORIGIN = 'http://localhost:8080';
const COOKIE = 'authjs.session-token';

const PEOPLE: Record<string, Principal> = {
  a: { userId: 'tch_a', role: 'teacher' },
  b: { userId: 'tch_b', role: 'teacher' },
  student: { userId: 'stu_1', role: 'student' },
};

const guardDeps: GuardDeps = {
  getPrincipal: async (c) => PEOPLE[c.get(COOKIE)?.value ?? ''] ?? null,
  learnerStatus: async () => 'clear',
  allowedOrigin: ORIGIN,
};
const guard = createGuard(
  () => guardDeps,
  () => {
    throw new Error('pages are not used here');
  },
);

function routes(opts: MemoryBackendOptions = {}) {
  const mem = memoryBackend(opts);
  const { world } = mem;
  const calls = {
    list: [] as { scope: TeacherScope; agentId: string }[],
    latest: [] as { scope: TeacherScope; agentId: string }[],
    corrections: [] as { scope: TeacherScope; input: CorrectionRecordInput }[],
    deps: [] as { scope: StudentScope; packageId: string }[],
    previews: [] as string[],
  };
  const previewStores: ReturnType<typeof memoryEntitlementStore>[] = [];
  const preview = (packageId: string) => {
    calls.previews.push(packageId);
    const store = memoryEntitlementStore(world, { market: 'IN', preview: { packageId } });
    previewStores.push(store);
    return store;
  };
  const backend: TestChatBackend = {
    agents: {
      get: async ({ teacherId }, agentId) => {
        const a = world.agents.find((x) => x.id === agentId && x.teacherId === teacherId);
        return a ? { status: a.status } : null;
      },
    },
    agentVersions: {
      latest: async (scope, agentId) => {
        calls.latest.push({ scope, agentId });
        const a = world.agents.find((x) => x.id === agentId && x.teacherId === scope.teacherId);
        if (!a || a.versions.length === 0) return null;
        return { version: Math.max(...a.versions.map((v) => v.version)) };
      },
    },
    packageVersions: {
      listForAgent: async (scope, agentId) => {
        calls.list.push({ scope, agentId });
        const ids = [
          ...new Set(
            world.packages
              .filter((p) => p.agentId === agentId && p.teacherId === scope.teacherId)
              .map((p) => p.id),
          ),
        ];
        return ids.map((packageId) => ({ packageId, name: `Package ${packageId}` }));
      },
    },
    sessions: {
      create: mem.backend.sessions.create,
      get: async (scope, id) =>
        world.sessions.find(
          (s) => s.id === id && s.studentId === scope.studentId && s.teacherId === scope.teacherId,
        ) ?? null,
    },
    corrections: {
      record: async (scope, input) => {
        calls.corrections.push({ scope, input });
        return { correctionId: 'cor_1', chunkId: 'chk_note_1', evalCaseId: 'evc_1' };
      },
    },
    previewEntitlements: preview,
    depsFor: (scope, packageId) => {
      calls.deps.push({ scope, packageId });
      return {
        ...mem.backend.depsFor(scope),
        entitlements: preview(packageId),
        entitlementSource: 'teacher_preview',
      };
    },
    steps: mem.backend.steps,
    now: () => new Date(),
    log: mem.backend.log,
  };
  const h = createTestChatHandlers(async () => backend);
  return {
    ...mem,
    backend,
    calls,
    previewStores,
    list: guard.withRole(['teacher'], h.listPackages),
    start: guard.withRole(['teacher'], h.startTestSession),
    turn: guard.withRole(['teacher'], h.postTestTurn),
    correct: guard.withRole(['teacher'], h.postCorrection),
  };
}

function request(method: 'GET' | 'POST', path: string, who: string | null, body?: unknown) {
  return new NextRequest(`${ORIGIN}${path}`, {
    method,
    headers: {
      origin: ORIGIN,
      'content-type': 'application/json',
      ...(who === null ? {} : { cookie: `${COOKIE}=${who}` }),
    },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
}
const get = (path: string, who: string | null) => request('GET', path, who);
const post = (path: string, who: string | null, body: unknown) => request('POST', path, who, body);

const agentCtx = (agentId: string) => ({ params: Promise.resolve({ agentId }) });
const sessionCtx = (id: string) => ({ params: Promise.resolve({ id }) });

const turnBody = (text = 'What is a fraction?', extra: object = {}) => ({
  agentId: 'agt_a',
  kind: 'message',
  text,
  lang: 'en',
  clientTs: '2026-10-22T10:00:00.000Z',
  ...extra,
});

const correction = (extra: object = {}) => ({
  moduleId: 'mod_a1',
  question: 'What is a fraction?',
  badAnswer: 'A fraction is a whole number.',
  correctedAnswer: 'A fraction is a part of a whole: a numerator over a denominator.',
  ...extra,
});

async function events(res: Response): Promise<TurnEvent[]> {
  const text = await res.text();
  return text
    .split('\n\n')
    .filter((block) => block.trim() !== '')
    .map((block) => {
      const data = block.split('\n').find((l) => l.startsWith('data: '))?.slice(6) ?? '';
      return TurnEventSchema.parse(JSON.parse(data));
    });
}

async function errorOf(res: Response) {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

const PKG_PATH = '/api/studio/agents/agt_a/packages';
const START_PATH = '/api/studio/agents/agt_a/test-sessions';
const turnPath = (id: string) => `/api/studio/test-sessions/${id}/turns`;
const CORRECTIONS_PATH = '/api/studio/corrections';

describe('access: teachers only', () => {
  it('a student gets 403 and anonymous gets 401 on every route; nothing is read or run', async () => {
    const r = routes();
    const sessions = r.world.sessions.length;
    expect((await r.list(get(PKG_PATH, 'student'), agentCtx('agt_a'))).status).toBe(403);
    expect((await r.start(post(START_PATH, 'student', { packageId: 'pkg_a' }), agentCtx('agt_a'))).status).toBe(403);
    const turn = await r.turn(post(turnPath('ses_preview_a'), 'student', turnBody()), sessionCtx('ses_preview_a'));
    expect(turn.status).toBe(403);
    expect((await r.correct(post(CORRECTIONS_PATH, 'student', correction()))).status).toBe(403);
    expect((await r.list(get(PKG_PATH, null), agentCtx('agt_a'))).status).toBe(401);
    expect((await r.correct(post(CORRECTIONS_PATH, null, correction()))).status).toBe(401);
    expect(r.world.sessions).toHaveLength(sessions);
    expect(r.calls.list).toHaveLength(0);
    expect(r.calls.corrections).toHaveLength(0);
    expect(r.seen.streams).toBe(0);
  });
});

describe('GET /api/studio/agents/:agentId/packages', () => {
  it("lists the teacher's own previewable packages for the agent, uncached", async () => {
    const r = routes();
    const res = await r.list(get(PKG_PATH, 'a'), agentCtx('agt_a'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ packages: [{ packageId: 'pkg_a', name: 'Package pkg_a' }] });
    expect(r.calls.list).toEqual([{ scope: { teacherId: 'tch_a' }, agentId: 'agt_a' }]);
  });

  it('a draft agent is listed too (test before publish)', async () => {
    const r = routes();
    const res = await r.list(get('/api/studio/agents/agt_a_draft/packages', 'a'), agentCtx('agt_a_draft'));
    expect(await res.json()).toEqual({ packages: [{ packageId: 'pkg_a_draft', name: 'Package pkg_a_draft' }] });
  });

  it("another teacher's, an unknown or a malformed agent id is 404 and lists nothing", async () => {
    const r = routes();
    for (const [who, agentId] of [['b', 'agt_a'], ['a', 'agt_none'], ['a', '../etc']] as const) {
      const res = await r.list(get(PKG_PATH, who), agentCtx(agentId));
      expect(res.status, agentId).toBe(404);
      expect(await errorOf(res)).toBe('not_found');
    }
    expect(r.calls.list).toHaveLength(0);
  });

  it('a repository failure is 500, logged by error name only', async () => {
    const r = routes();
    r.backend.packageVersions.listForAgent = async () => {
      throw new TypeError('select from packages where teacher_id = tch_a');
    };
    const res = await r.list(get(PKG_PATH, 'a'), agentCtx('agt_a'));
    expect(res.status).toBe(500);
    expect(await errorOf(res)).toBe('provider_error');
    expect(r.logs).toEqual([{ event: 'testChat.packages_failed', fields: { error: 'TypeError' } }]);
  });

  it('a backend that cannot be built is 503 (retryable)', async () => {
    const h = createTestChatHandlers(() => Promise.reject(new TurnUnavailableError('REDIS_URL')));
    const list = guard.withRole(['teacher'], h.listPackages);
    const res = await list(get(PKG_PATH, 'a'), agentCtx('agt_a'));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: 'provider_error', retryable: true } });
  });
});

describe('POST /api/studio/agents/:agentId/test-sessions', () => {
  it("starts a teacher_preview session on the agent's newest version and the package's newest version", async () => {
    const r = routes();
    const res = await r.start(post(START_PATH, 'a', { packageId: 'pkg_a' }), agentCtx('agt_a'));
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const { sessionId } = (await res.json()) as { sessionId: string };
    expect(r.world.sessions.find((s) => s.id === sessionId)).toMatchObject({
      studentId: 'tch_a',
      teacherId: 'tch_a',
      agentId: 'agt_a',
      agentVersion: 2,
      packageId: 'pkg_a',
      packageVersion: 2,
      endedAt: null,
    });
    expect(r.calls.previews).toEqual(['pkg_a']);
    expect(r.previewStores[0]?.calls[0]?.x).toEqual({
      studentId: 'tch_a',
      agentId: 'agt_a',
      source: 'teacher_preview',
    });
    expect(r.calls.latest).toEqual([{ scope: { teacherId: 'tch_a' }, agentId: 'agt_a' }]);
  });

  it('a draft agent can be previewed', async () => {
    const r = routes();
    const res = await r.start(
      post('/api/studio/agents/agt_a_draft/test-sessions', 'a', { packageId: 'pkg_a_draft' }),
      agentCtx('agt_a_draft'),
    );
    expect(res.status).toBe(201);
    const { sessionId } = (await res.json()) as { sessionId: string };
    expect(r.world.sessions.find((s) => s.id === sessionId)).toMatchObject({
      agentId: 'agt_a_draft',
      agentVersion: 1,
      packageId: 'pkg_a_draft',
      packageVersion: 1,
    });
  });

  it("another teacher's agent, another agent's package, or an unknown package is 404; nothing made", async () => {
    const r = routes();
    const sessions = r.world.sessions.length;
    const cases: [string, string, string][] = [
      ['b', 'agt_a', 'pkg_a'], // teacher B on teacher A's agent
      ['a', 'agt_a', 'pkg_a_draft'], // own package, but of another agent
      ['a', 'agt_a', 'pkg_b'], // another teacher's package
      ['a', 'agt_a', 'pkg_none'],
      ['a', 'agt_none', 'pkg_a'],
      ['a', '../etc', 'pkg_a'],
    ];
    for (const [who, agentId, packageId] of cases) {
      const res = await r.start(post(START_PATH, who, { packageId }), agentCtx(agentId));
      expect(res.status, `${who} ${agentId} ${packageId}`).toBe(404);
      expect(await errorOf(res)).toBe('not_found');
    }
    expect(r.world.sessions).toHaveLength(sessions);
  });

  it('an owned agent with no version yet is 404', async () => {
    const r = routes();
    r.backend.agentVersions.latest = async () => null;
    const res = await r.start(post(START_PATH, 'a', { packageId: 'pkg_a' }), agentCtx('agt_a'));
    expect(res.status).toBe(404);
  });

  it('a body naming anything but the package, bad JSON or a too large body is refused', async () => {
    const r = routes();
    const named = await r.start(post(START_PATH, 'a', { packageId: 'pkg_a', studentId: 'stu_1' }), agentCtx('agt_a'));
    expect(named.status).toBe(400);
    expect(await errorOf(named)).toBe('validation');
    expect((await r.start(post(START_PATH, 'a', '{nope'), agentCtx('agt_a'))).status).toBe(400);
    expect((await r.start(post(START_PATH, 'a', {}), agentCtx('agt_a'))).status).toBe(400);
    const big = await r.start(post(START_PATH, 'a', { packageId: 'x'.repeat(70_000) }), agentCtx('agt_a'));
    expect(big.status).toBe(413);
    expect(await errorOf(big)).toBe('input_too_large');
  });

  it('a repository failure is 500, logged by error name only', async () => {
    const r = routes();
    r.backend.sessions.create = async () => {
      throw new Error('insert into sessions for tch_a failed');
    };
    const res = await r.start(post(START_PATH, 'a', { packageId: 'pkg_a' }), agentCtx('agt_a'));
    expect(res.status).toBe(500);
    expect(r.logs).toEqual([{ event: 'testChat.start_failed', fields: { error: 'Error' } }]);
  });

  it('an unavailable backend part is 503', async () => {
    const r = routes();
    r.backend.sessions.create = async () => {
      throw new TurnUnavailableError('REDIS_URL');
    };
    const res = await r.start(post(START_PATH, 'a', { packageId: 'pkg_a' }), agentCtx('agt_a'));
    expect(res.status).toBe(503);
  });
});

describe('POST /api/studio/test-sessions/:id/turns', () => {
  it('runs a real teacher_preview turn through runTurn as SSE, to done', async () => {
    const r = routes({ stream: [says('A fraction is ', 'a part of a whole.')] });
    const started = await r.start(post(START_PATH, 'a', { packageId: 'pkg_a' }), agentCtx('agt_a'));
    const { sessionId } = (await started.json()) as { sessionId: string };
    const res = await r.turn(post(turnPath(sessionId), 'a', turnBody()), sessionCtx(sessionId));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-cache, no-transform');
    const got = await events(res);
    const tokens = got.filter((e) => e.type === 'token').map((e) => (e as { text: string }).text);
    expect(tokens.join('')).toBe('A fraction is a part of a whole.');
    expect(got.at(-1)?.type).toBe('done');
    // The preview's student is the teacher; the package is the session's, never the client's.
    expect(r.calls.deps).toEqual([{ scope: { studentId: 'tch_a', teacherId: 'tch_a' }, packageId: 'pkg_a' }]);
    const resolved = r.previewStores.at(-1)?.calls.map((c) => c.x);
    expect(resolved).toEqual([{ studentId: 'tch_a', agentId: 'agt_a', source: 'teacher_preview' }]);
    const stored = await r.transcripts.history(sessionId, 10);
    expect(stored.map((m) => m.role)).toEqual(['student', 'agent']);
  }, 20_000);

  it("runs on a draft agent's existing preview session", async () => {
    const r = routes({ stream: [says('Draft reply.')] });
    const res = await r.turn(
      post(turnPath('ses_preview_a_draft'), 'a', turnBody('Tell me about photosynthesis', { agentId: 'agt_a_draft' })),
      sessionCtx('ses_preview_a_draft'),
    );
    const got = await events(res);
    expect(got.at(-1)?.type).toBe('done');
    expect(r.calls.deps[0]?.packageId).toBe('pkg_a_draft');
  }, 20_000);

  it("a student's session, another teacher's, another agent's, an ended or unknown one is 404 JSON", async () => {
    const r = routes();
    r.world.sessions.push({
      id: 'ses_preview_a_ended',
      studentId: 'tch_a',
      teacherId: 'tch_a',
      agentId: 'agt_a',
      agentVersion: 2,
      packageId: 'pkg_a',
      packageVersion: 2,
      endedAt: '2026-10-21T10:00:00.000Z',
    });
    r.world.sessions.push({
      id: 'ses_preview_a_nopkg',
      studentId: 'tch_a',
      teacherId: 'tch_a',
      agentId: 'agt_a',
      agentVersion: 2,
      packageId: null,
      packageVersion: null,
      endedAt: null,
    } as never);
    const cases: [string, string, object][] = [
      ['a', 'ses_1a', {}], // stu_1's subscription session with teacher A
      ['b', 'ses_preview_a', {}], // teacher B on teacher A's preview
      ['b', 'ses_preview_a', { agentId: 'agt_b' }],
      ['a', 'ses_preview_a', { agentId: 'agt_a_draft' }], // the body names another agent
      ['a', 'ses_preview_a_ended', {}],
      ['a', 'ses_preview_a_nopkg', {}],
      ['a', 'ses_none', {}],
      ['a', 'ses_preview_a', { agentId: 'agt_none' }],
    ];
    for (const [who, id, extra] of cases) {
      const res = await r.turn(post(turnPath(id), who, turnBody('hi', extra)), sessionCtx(id));
      expect(res.status, `${who} ${id}`).toBe(404);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(await errorOf(res)).toBe('not_found');
    }
    const bad = await r.turn(post(turnPath('x'), 'a', turnBody()), sessionCtx('../etc'));
    expect(bad.status).toBe(404);
    expect(r.seen.streams).toBe(0);
    expect(r.calls.deps).toHaveLength(0);
  });

  it('a body naming a student or a session, bad JSON or a too large body is refused before any work', async () => {
    const r = routes();
    const id = 'ses_preview_a';
    const named = await r.turn(post(turnPath(id), 'a', turnBody('hi', { studentId: 'stu_1' })), sessionCtx(id));
    expect(named.status).toBe(400);
    expect((await r.turn(post(turnPath(id), 'a', '{nope'), sessionCtx(id))).status).toBe(400);
    const big = await r.turn(post(turnPath(id), 'a', turnBody('x'.repeat(70_000))), sessionCtx(id));
    expect(big.status).toBe(413);
    expect(r.calls.deps).toHaveLength(0);
    expect(r.seen.streams).toBe(0);
  });

  it('a backend failure before the stream is 500, logged by name only', async () => {
    const r = routes();
    r.backend.sessions.get = async () => {
      throw new RangeError('select from sessions where student_id = tch_a');
    };
    const res = await r.turn(post(turnPath('ses_preview_a'), 'a', turnBody()), sessionCtx('ses_preview_a'));
    expect(res.status).toBe(500);
    expect(r.logs).toEqual([{ event: 'testChat.turn_start_failed', fields: { error: 'RangeError' } }]);
  });

  it('an unbuildable backend is 503', async () => {
    const h = createTestChatHandlers(() => Promise.reject(new TurnUnavailableError('provider_key')));
    const turn = guard.withRole(['teacher'], h.postTestTurn);
    const res = await turn(post(turnPath('ses_preview_a'), 'a', turnBody()), sessionCtx('ses_preview_a'));
    expect(res.status).toBe(503);
  });
});

describe('POST /api/studio/corrections', () => {
  it("records the correction in the signed-in teacher's scope and returns its ids", async () => {
    const r = routes();
    const res = await r.correct(post(CORRECTIONS_PATH, 'a', correction()));
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ correctionId: 'cor_1', chunkId: 'chk_note_1', evalCaseId: 'evc_1' });
    expect(r.calls.corrections).toEqual([{ scope: { teacherId: 'tch_a' }, input: correction() }]);
  });

  it('a body naming a teacher, a missing field or a wrong type is 400; nothing recorded', async () => {
    const r = routes();
    const bodies: unknown[] = [
      correction({ teacherId: 'tch_b' }),
      { ...correction(), badAnswer: undefined },
      correction({ question: 42 }),
      correction({ moduleId: '../etc' }),
      '{nope',
    ];
    for (const body of bodies) {
      const res = await r.correct(post(CORRECTIONS_PATH, 'a', body));
      expect(res.status).toBe(400);
      expect(await errorOf(res)).toBe('validation');
    }
    const big = await r.correct(post(CORRECTIONS_PATH, 'a', correction({ correctedAnswer: 'x'.repeat(70_000) })));
    expect(big.status).toBe(413);
    expect(r.calls.corrections).toHaveLength(0);
  });

  it('a text field at LIMITS.turnTextMaxLength is accepted; one character over is a 400, before any write', async () => {
    const r = routes();
    const atBound = 'x'.repeat(LIMITS.turnTextMaxLength);
    const ok = await r.correct(post(CORRECTIONS_PATH, 'a', correction({ question: atBound })));
    expect(ok.status).toBe(201);
    const over = await r.correct(post(CORRECTIONS_PATH, 'a', correction({ question: `${atBound}x` })));
    expect(over.status).toBe(400);
    expect(await errorOf(over)).toBe('validation');
    expect(r.calls.corrections).toEqual([{ scope: { teacherId: 'tch_a' }, input: correction({ question: atBound }) }]);
  });

  it("the repository's not_found (another teacher's or a missing module) is 404; invalid is 400", async () => {
    const r = routes();
    r.backend.corrections.record = async () => {
      throw new RepositoryError('not_found', 'corrections.record');
    };
    const missing = await r.correct(post(CORRECTIONS_PATH, 'a', correction()));
    expect(missing.status).toBe(404);
    expect(await errorOf(missing)).toBe('not_found');
    r.backend.corrections.record = async () => {
      throw new RepositoryError('invalid', 'corrections.record');
    };
    const invalid = await r.correct(post(CORRECTIONS_PATH, 'a', correction({ correctedAnswer: '   ' })));
    expect(invalid.status).toBe(400);
    expect(r.logs).toEqual([]);
  });

  it('any other failure is 500, logged by error name only', async () => {
    const r = routes();
    r.backend.corrections.record = async () => {
      throw new RepositoryError('integrity', 'corrections.record');
    };
    const res = await r.correct(post(CORRECTIONS_PATH, 'a', correction()));
    expect(res.status).toBe(500);
    expect(r.logs).toEqual([{ event: 'testChat.correction_failed', fields: { error: 'RepositoryError' } }]);
  });

  it('an unbuildable backend is 503', async () => {
    const h = createTestChatHandlers(() => Promise.reject(new Error('no db')));
    const correct = guard.withRole(['teacher'], h.postCorrection);
    expect((await correct(post(CORRECTIONS_PATH, 'a', correction()))).status).toBe(503);
  });
});
