// Task 9.4 Phase A: the chat routes end to end over memory ports, the real `defaultSteps` and the
// scripted gateway (rule 4: no real model call). The guard is the real `createGuard` with fake
// dependencies, and ROUTE_POLICY's own rows decide the clearance (`agent`).
import type { AgeStatus } from '@edmate/db';
import { TurnEventSchema, type TurnEvent } from '@edmate/contracts';
import { scriptedStreamProviderError } from '@edmate/harness/testing';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { memoryBackend, says, type MemoryBackendOptions } from '../../test/turn-backend';
import { createGuard, type GuardDeps, type Principal } from '../auth/guard';
import {
  createSessionHandlers,
  MAX_BODY_BYTES,
  sseBody,
  TurnUnavailableError,
  type TurnBackend,
} from './routes';

const ORIGIN = 'http://localhost:8080';
const COOKIE = 'authjs.session-token';

/** Session tokens → who they are and (students) their age standing. */
const PEOPLE: Record<string, { principal: Principal; status?: AgeStatus }> = {
  clear: { principal: { userId: 'stu_1', role: 'student' }, status: 'clear' },
  // The same student id, held for a parent's consent: the guard must stop it before the handler.
  parent: { principal: { userId: 'stu_1', role: 'student' }, status: 'parent_needed' },
  age: { principal: { userId: 'stu_1', role: 'student' }, status: 'age_needed' },
  two: { principal: { userId: 'stu_2', role: 'student' }, status: 'clear' },
  teacher: { principal: { userId: 'tch_a', role: 'teacher' } },
};

let currentToken = '';
const guardDeps: GuardDeps = {
  getPrincipal: async (c) => PEOPLE[c.get(COOKIE)?.value ?? '']?.principal ?? null,
  // The standing belongs to the token here (one student id, several standings).
  learnerStatus: async () => PEOPLE[currentToken]?.status ?? 'clear',
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
  const handlers = createSessionHandlers(async () => mem.backend);
  return {
    ...mem,
    start: guard.withRole(['student'], handlers.startSession),
    turn: guard.withRole(['student'], handlers.postTurn),
  };
}

function post(path: string, who: string | null, body: unknown, signal?: AbortSignal) {
  currentToken = who ?? '';
  return new NextRequest(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: {
      origin: ORIGIN,
      'content-type': 'application/json',
      ...(who === null ? {} : { cookie: `${COOKIE}=${who}` }),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
}

const turnBody = (text = 'What is a fraction?', extra: object = {}) => ({
  agentId: 'agt_a',
  kind: 'message',
  text,
  lang: 'en',
  clientTs: '2026-10-20T10:00:00.000Z',
  ...extra,
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

/** Reads an SSE body into events, each checked against the contracts schema. */
async function events(res: Response): Promise<TurnEvent[]> {
  const text = await res.text();
  return text
    .split('\n\n')
    .filter((block) => block.trim() !== '')
    .map((block) => {
      const lines = block.split('\n');
      const type = lines.find((l) => l.startsWith('event: '))?.slice(7);
      const data = lines.find((l) => l.startsWith('data: '))?.slice(6) ?? '';
      const event = TurnEventSchema.parse(JSON.parse(data));
      expect(event.type).toBe(type);
      return event;
    });
}

async function errorOf(res: Response) {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

describe('clearance (consent done) on both routes', () => {
  it('a parent_needed student gets 403, no session is made and the gateway is never called', async () => {
    const r = routes();
    const sessions = r.world.sessions.length;
    const start = await r.start(post('/api/sessions', 'parent', { agentId: 'agt_a' }));
    expect(start.status).toBe(403);
    expect(await errorOf(start)).toBe('forbidden');
    const turn = await r.turn(post('/api/sessions/ses_1a/turns', 'parent', turnBody()), ctx('ses_1a'));
    expect(turn.status).toBe(403);
    expect(await errorOf(turn)).toBe('forbidden');
    expect(r.world.sessions).toHaveLength(sessions);
    expect(r.seen.streams).toBe(0);
    expect(r.entitlements.calls).toHaveLength(0);
    expect(r.scopes).toHaveLength(0);
  });

  it('an age_needed student gets 403; a teacher gets 403; anonymous gets 401', async () => {
    const r = routes();
    expect((await r.start(post('/api/sessions', 'age', { agentId: 'agt_a' }))).status).toBe(403);
    expect((await r.start(post('/api/sessions', 'teacher', { agentId: 'agt_a' }))).status).toBe(403);
    const anon = await r.turn(post('/api/sessions/ses_1a/turns', null, turnBody()), ctx('ses_1a'));
    expect(anon.status).toBe(401);
    expect(r.seen.streams).toBe(0);
  });

  it('a clear student passes', async () => {
    const r = routes();
    const res = await r.start(post('/api/sessions', 'clear', { agentId: 'agt_a' }));
    expect(res.status).toBe(201);
  });
});

describe('POST /api/sessions', () => {
  it('returns the new session id, pinned to the entitlement package version and the live agent', async () => {
    const r = routes();
    const res = await r.start(post('/api/sessions', 'clear', { agentId: 'agt_a' }));
    expect(res.headers.get('cache-control')).toBe('no-store');
    const { sessionId } = (await res.json()) as { sessionId: string };
    const row = r.world.sessions.find((s) => s.id === sessionId);
    expect(row).toMatchObject({
      studentId: 'stu_1',
      teacherId: 'tch_a',
      agentId: 'agt_a',
      agentVersion: 2,
      packageId: 'pkg_a',
      packageVersion: 2,
      endedAt: null,
    });
    expect(r.entitlements.calls[0]?.x).toEqual({
      studentId: 'stu_1',
      agentId: 'agt_a',
      source: 'subscription',
    });
  });

  it('no live subscription with the teacher is 403 no_access', async () => {
    const r = routes();
    // stu_1's subscription with teacher B has ended; stu_2's with A is paused.
    const ended = await r.start(post('/api/sessions', 'clear', { agentId: 'agt_b' }));
    expect(ended.status).toBe(403);
    expect(await errorOf(ended)).toBe('no_access');
    const paused = await r.start(post('/api/sessions', 'two', { agentId: 'agt_a' }));
    expect(paused.status).toBe(403);
    expect(await errorOf(paused)).toBe('no_access');
  });

  it('a draft, suspended or unknown agent is 404', async () => {
    const r = routes();
    for (const agentId of ['agt_a_draft', 'agt_b_susp', 'agt_none']) {
      const res = await r.start(post('/api/sessions', 'clear', { agentId }));
      expect(res.status).toBe(404);
      expect(await errorOf(res)).toBe('not_found');
    }
  });

  it('a live owner whose agent row has no live version is 404', async () => {
    const r = routes();
    r.backend.agents.get = async () => ({ status: 'live', liveVersion: null });
    expect((await r.start(post('/api/sessions', 'clear', { agentId: 'agt_a' }))).status).toBe(404);
  });

  it('a body naming a student, or bad JSON, is 400 validation', async () => {
    const r = routes();
    const named = await r.start(post('/api/sessions', 'clear', { agentId: 'agt_a', studentId: 'stu_2' }));
    expect(named.status).toBe(400);
    expect(await errorOf(named)).toBe('validation');
    expect((await r.start(post('/api/sessions', 'clear', '{nope'))).status).toBe(400);
  });

  it('a repository failure is 500 provider_error, logged by error name only', async () => {
    const r = routes();
    r.backend.sessions.create = async () => {
      throw new Error('relation "sessions" violates something about stu_1');
    };
    const res = await r.start(post('/api/sessions', 'clear', { agentId: 'agt_a' }));
    expect(res.status).toBe(500);
    expect(await errorOf(res)).toBe('provider_error');
    expect(r.logs).toEqual([{ event: 'sessions.start_failed', fields: { error: 'Error' } }]);
  });

  it('a backend that cannot be built is 503 provider_error (retryable)', async () => {
    const handlers = createSessionHandlers(() => Promise.reject(new TurnUnavailableError('REDIS_URL')));
    const start = guard.withRole(['student'], handlers.startSession);
    const res = await start(post('/api/sessions', 'clear', { agentId: 'agt_a' }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: 'provider_error', retryable: true } });
  });
});

describe('POST /api/sessions/:id/turns', () => {
  it('streams SSE with the right headers: tokens, then done', async () => {
    const r = routes({ stream: [says('Hello', ' there.')] });
    const res = await r.turn(post('/api/sessions/ses_1a/turns', 'clear', turnBody()), ctx('ses_1a'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-cache, no-transform');
    expect(res.headers.get('x-accel-buffering')).toBe('no');
    const got = await events(res);
    const tokens = got.filter((e) => e.type === 'token').map((e) => (e as { text: string }).text);
    expect(tokens.join('')).toBe('Hello there.');
    expect(got.at(-1)?.type).toBe('done');
    expect(r.scopes).toEqual([{ studentId: 'stu_1', teacherId: 'tch_a' }]);
  }, 20_000);

  it("uses the principal's id, never one from the body (400, nothing run)", async () => {
    const r = routes();
    const res = await r.turn(
      post('/api/sessions/ses_2a/turns', 'clear', turnBody('hi', { studentId: 'stu_2' })),
      ctx('ses_2a'),
    );
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe('validation');
    const withSession = await r.turn(
      post('/api/sessions/ses_1a/turns', 'clear', turnBody('hi', { sessionId: 'ses_2a' })),
      ctx('ses_1a'),
    );
    expect(withSession.status).toBe(400);
    expect(r.seen.streams).toBe(0);
    // A good body: the turn's student is the principal, and the transcript is the own session's.
    const ok = await r.turn(post('/api/sessions/ses_1a/turns', 'clear', turnBody()), ctx('ses_1a'));
    expect((await events(ok)).at(-1)?.type).toBe('done');
    expect(r.entitlements.calls.map((c) => (c.x as { studentId: string }).studentId)).toEqual([
      'stu_1',
    ]);
    const stored = await r.transcripts.history('ses_1a', 10);
    expect(stored.map((m) => m.role)).toEqual(['student', 'agent']);
    expect(await r.transcripts.history('ses_2a', 10)).toEqual([]);
  }, 20_000);

  it("another student's, another agent's, an ended or unknown session is 404 JSON", async () => {
    const r = routes();
    const cases: [string, object][] = [
      ['ses_2a', {}], // stu_2's session with teacher A
      ['ses_1a_ended', {}],
      ['ses_none', {}],
      ['ses_1b', {}], // own session with teacher B, but the body names agt_a (teacher A)
    ];
    for (const [id, extra] of cases) {
      const res = await r.turn(post(`/api/sessions/${id}/turns`, 'clear', turnBody('hi', extra)), ctx(id));
      expect(res.status, id).toBe(404);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(await errorOf(res)).toBe('not_found');
    }
    // A session id that is not an id at all.
    const bad = await r.turn(post('/api/sessions/x/turns', 'clear', turnBody()), ctx('../etc'));
    expect(bad.status).toBe(404);
    expect(r.seen.streams).toBe(0);
  });

  it("an own session of another agent of the same teacher is 404", async () => {
    const r = routes();
    r.world.sessions.push({
      id: 'ses_1a_other',
      studentId: 'stu_1',
      teacherId: 'tch_a',
      agentId: 'agt_other',
      agentVersion: 1,
      packageId: 'pkg_a',
      packageVersion: 2,
      endedAt: null,
    });
    const res = await r.turn(post('/api/sessions/ses_1a_other/turns', 'clear', turnBody()), ctx('ses_1a_other'));
    expect(res.status).toBe(404);
  });

  it('a failed provider stream is retried, and the student sees only the retry', async () => {
    const r = routes({ stream: [scriptedStreamProviderError, says('Second try.')] });
    const got = await events(
      await r.turn(post('/api/sessions/ses_1a/turns', 'clear', turnBody()), ctx('ses_1a')),
    );
    // Any `replace ''` (a cleared partial) comes before the retry's tokens.
    const lastBlank = got.findLastIndex((e) => e.type === 'replace' && e.text === '');
    const shown = got.slice(lastBlank + 1).filter((e) => e.type === 'token');
    expect(shown.map((e) => (e as { text: string }).text).join('')).toBe('Second try.');
    expect(r.seen.streams).toBeGreaterThanOrEqual(2);
    expect(got.at(-1)?.type).toBe('done');
  }, 20_000);

  it('a question about a locked module shows locked', async () => {
    const r = routes();
    const got = await events(
      await r.turn(
        post('/api/sessions/ses_1a/turns', 'clear', turnBody('Explain photosynthesis sunlight chlorophyll sugar')),
        ctx('ses_1a'),
      ),
    );
    expect(got.some((e) => e.type === 'locked')).toBe(true);
    expect(got.at(-1)?.type).toBe('done');
  }, 20_000);

  it("a pre-guard failure ends with error guard_blocked and no reply", async () => {
    // No classifier answers: preGuard fails closed.
    const r = routes({ objects: [] });
    const got = await events(
      await r.turn(post('/api/sessions/ses_1a/turns', 'clear', turnBody()), ctx('ses_1a')),
    );
    expect(got.at(-1)).toMatchObject({ type: 'error', code: 'guard_blocked' });
    expect(got.some((e) => e.type === 'token')).toBe(false);
    expect(r.seen.streams).toBe(0);
  }, 20_000);

  it('aborting the request stops the stream, and the gateway sees the cancel', async () => {
    const r = routes({
      stream: [
        {
          // Short sleeps between chunks: the stream is still going when the client hangs up.
          steps: [
            { type: 'text', text: 'Let me think' },
            ...Array.from({ length: 100 }, () => [
              { type: 'delay' as const, ms: 100 },
              { type: 'text' as const, text: '.' },
            ]).flat(),
          ],
        },
      ],
    });
    const abort = new AbortController();
    const res = await r.turn(
      post('/api/sessions/ses_1a/turns', 'clear', turnBody(), abort.signal),
      ctx('ses_1a'),
    );
    // The reply is held until it is checked, so hang up while the model is still streaming.
    const started = Date.now();
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    setTimeout(() => abort.abort(), 500);
    let text = '';
    for (let c = await reader.read(); !c.done; c = await reader.read()) text += decoder.decode(c.value);
    // Far less than the 10 s the script would take to the end, and no reply was finished.
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(text).not.toContain('event: done');
    await vi_waitFor(() => r.seen.closedEarly === 1);
  }, 20_000);

  it('a hint request runs as a turn', async () => {
    const r = routes();
    const body = turnBody(undefined, { kind: 'hint_request' });
    const got = await events(await r.turn(post('/api/sessions/ses_1a/turns', 'clear', body), ctx('ses_1a')));
    expect(['done', 'error']).toContain(got.at(-1)?.type);
  }, 20_000);

  it('a lookup failure before streaming is 500 JSON; an unavailable backend part is 503', async () => {
    const r = routes();
    r.backend.sessions.get = async () => {
      throw new Error('db down');
    };
    const res = await r.turn(post('/api/sessions/ses_1a/turns', 'clear', turnBody()), ctx('ses_1a'));
    expect(res.status).toBe(500);
    r.backend.sessions.get = async () => ({ agentId: 'agt_a', endedAt: null });
    r.backend.depsFor = () => {
      throw new TurnUnavailableError('provider_key');
    };
    const unavailable = await r.turn(post('/api/sessions/ses_1a/turns', 'clear', turnBody()), ctx('ses_1a'));
    expect(unavailable.status).toBe(503);
    expect(r.logs.map((l) => l.event)).toEqual(['turns.start_failed', 'turns.start_failed']);
  });

  it('a backend that cannot be built is 503 before any stream', async () => {
    const handlers = createSessionHandlers(() => Promise.reject(new Error('boom')));
    const turn = guard.withRole(['student'], handlers.postTurn);
    const res = await turn(post('/api/sessions/ses_1a/turns', 'clear', turnBody()), ctx('ses_1a'));
    expect(res.status).toBe(503);
  });
});

describe('request body cap (64 KB) on both routes', () => {
  const BIG = 'x'.repeat(MAX_BODY_BYTES + 1);

  /** A request whose body is a stream: no content-length, or a false one. */
  function streamed(path: string, chunks: string[], contentLength?: string) {
    currentToken = 'clear';
    const enc = new TextEncoder();
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const next = chunks[pulled++];
        if (next === undefined) controller.close();
        else controller.enqueue(enc.encode(next));
      },
    });
    const req = new NextRequest(`${ORIGIN}${path}`, {
      method: 'POST',
      headers: {
        origin: ORIGIN,
        'content-type': 'application/json',
        cookie: `${COOKIE}=clear`,
        ...(contentLength === undefined ? {} : { 'content-length': contentLength }),
      },
      body,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    return { req, pulled: () => pulled };
  }

  it('a content-length over the cap is 413 input_too_large before any work', async () => {
    const r = routes();
    const start = await r.start(post('/api/sessions', 'clear', { agentId: 'agt_a', pad: BIG }));
    expect(start.status).toBe(413);
    expect(await errorOf(start)).toBe('input_too_large');
    const turn = await r.turn(
      post('/api/sessions/ses_1a/turns', 'clear', turnBody('hi', { pad: BIG })),
      ctx('ses_1a'),
    );
    expect(turn.status).toBe(413);
    expect(await errorOf(turn)).toBe('input_too_large');
    expect(r.seen.streams).toBe(0);
    expect(r.entitlements.calls).toHaveLength(0);
  });

  it('a body with no content-length is cut off at the cap while reading', async () => {
    const r = routes();
    const chunk = 'y'.repeat(16 * 1024);
    const chunks = ['{"agentId":"agt_a","pad":"', ...Array<string>(64).fill(chunk), '"}'];
    const s = streamed('/api/sessions', chunks);
    const res = await r.start(s.req);
    expect(res.status).toBe(413);
    expect(await errorOf(res)).toBe('input_too_large');
    // It stopped reading soon after the cap, not at the end of the 1 MB body.
    expect(s.pulled()).toBeLessThan(10);
  });

  it('a false, small content-length can not bypass the cap', async () => {
    const r = routes();
    const s = streamed('/api/sessions/ses_1a/turns', [JSON.stringify(turnBody('hi', { pad: BIG }))], '10');
    const res = await r.turn(s.req, ctx('ses_1a'));
    expect(res.status).toBe(413);
    expect(r.seen.streams).toBe(0);
  });

  it('a streamed body under the cap is read whole', async () => {
    const r = routes();
    const json = JSON.stringify({ agentId: 'agt_a' });
    const s = streamed('/api/sessions', [json.slice(0, 5), json.slice(5)]);
    expect((await r.start(s.req)).status).toBe(201);
  });

  it('a body that fails mid-read is a 400, not a crash', async () => {
    const r = routes();
    currentToken = 'clear';
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('socket reset'));
      },
    });
    const req = new NextRequest(`${ORIGIN}/api/sessions`, {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json', cookie: `${COOKIE}=clear` },
      body,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    expect((await r.start(req)).status).toBe(400);
  });
});

describe('sseBody', () => {
  const log = () => {
    const lines: string[] = [];
    return { lines, log: { error: (event: string) => void lines.push(event) } };
  };

  it('a throw after headers becomes one final retryable provider_error event, logged', async () => {
    const l = log();
    let returned = false;
    const run = {
      events: {
        [Symbol.asyncIterator]: () => ({
          next: () => Promise.reject(new Error('runner bug')),
          return: () => {
            returned = true;
            return Promise.resolve({ done: true as const, value: undefined });
          },
        }),
      },
      finished: Promise.resolve({ trace: null, background: [] }),
    };
    const got = await events(new Response(sseBody(run, l.log)));
    expect(got).toEqual([{ type: 'error', code: 'provider_error', retryable: true }]);
    expect(l.lines).toEqual(['turn.stream_failed']);
    expect(returned).toBe(true);
  });

  it('cancelling the body closes the event stream', async () => {
    const l = log();
    let returned = false;
    const run = {
      events: {
        [Symbol.asyncIterator]: () => ({
          next: () => Promise.resolve({ done: false as const, value: { type: 'token' as const, text: 'a' } }),
          return: () => {
            returned = true;
            return Promise.resolve({ done: true as const, value: undefined });
          },
        }),
      },
      finished: Promise.resolve({ trace: null, background: [] }),
    };
    const body = sseBody(run, l.log);
    const reader = body.getReader();
    await reader.read();
    await reader.cancel();
    expect(returned).toBe(true);
  });
});

/** Polls until `ok()` (the gateway's finally runs a tick after the stream stops). */
async function vi_waitFor(ok: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !ok(); i += 1) await new Promise((r) => setTimeout(r, 20));
  expect(ok()).toBe(true);
}

export type { TurnBackend };
