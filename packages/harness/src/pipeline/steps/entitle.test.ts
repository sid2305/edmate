import type { Entitlement, EntitlementStore, TurnConfigStore, TurnInput } from '@edmate/contracts';
import { demoTurnInput } from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { accessTurns, type AccessTurnOutcome } from '../../testing/accessTurn.js';
import { stepEnvExtras } from '../../testing/testSteps.js';
import { type AccessOptions, memoryTurnConfigStore } from '../../testing/memoryAccess.js';
import { cancelSource } from '../clock.js';
import { TurnRejection } from '../errors.js';
import { MESSAGE_WINDOW_MS, RATE_LIMIT_WINDOW_MS } from '../spec.js';
import type { FallbackReplies } from '../types.js';
import { DEFAULT_LIMIT_REACHED_REPLY, entitle } from './entitle.js';

/** stu_1's own open session with teacher A's live agent; subscription sub_1a (pkg_a v2). */
const input: TurnInput = {
  ...demoTurnInput,
  studentId: 'stu_1',
  agentId: 'agt_a',
  sessionId: 'ses_1a',
};
const previewIn: TurnInput = { ...input, studentId: 'tch_a', sessionId: 'ses_preview_a' };
const evalIn: TurnInput = { ...input, studentId: 'stu_eval', sessionId: 'ses_eval_a' };
const PREVIEW: AccessOptions = { market: 'IN', preview: { packageId: 'pkg_a' } };
const EVAL: AccessOptions = {
  market: 'IN',
  eval: { teacherId: 'tch_a', packageId: 'pkg_a', version: 2, market: 'IN' },
};

function expectRejected(
  out: AccessTurnOutcome,
  modelCalls: string[],
  code: string,
  retryable = false,
) {
  expect(out.code).toBe(code);
  expect(out.events).toEqual([{ type: 'error', code, retryable }]);
  expect(out.started).toEqual(['admit', 'entitle']);
  expect(modelCalls).toEqual([]);
  expect(out.trace).toBeNull();
}

describe('entitle: each rejection returns its code (through runTurn)', () => {
  it('passes the own open session and returns the server-side entitlement and config', async () => {
    const a = accessTurns();
    const out = await a.run(input);
    expect(out.code).toBe('passed');
    expect(out.entitled?.entitlement).toMatchObject({
      source: 'subscription',
      subscriptionId: 'sub_1a',
      teacherId: 'tch_a',
      packageId: 'pkg_a',
      packageVersion: 2,
    });
    // ADR-0004 (b): pinned to v1 by the session row while v2 is live.
    expect(out.entitled?.agent.version).toBe(1);
    expect(out.entitled?.pkg.version).toBe(2);
    expect(a.modelCalls).toEqual([]);
  });

  it("passes the session's raw help state through unchanged (ADR-0005; buildContext parses it)", async () => {
    const stored = { v: 1, rung: 3, anything: ['as stored'] };
    const a = accessTurns();
    const session = a.world.sessions.find((x) => x.id === 'ses_1a');
    if (session === undefined) throw new Error('fixture');
    session.helpState = stored;
    const out = await a.run(input);
    expect(out.code).toBe('passed');
    expect(out.entitled?.helpState).toEqual(stored);
    const none = await accessTurns().run(input);
    expect(none.entitled?.helpState).toBeUndefined();
  });

  it.each([
    ['no live subscription (resolve null)', { agentId: 'agt_b', sessionId: 'ses_1b' }],
    ['a paused subscription', { studentId: 'stu_2', sessionId: 'ses_2a' }],
    ['an unknown agent', { agentId: 'agt_nowhere' }],
    ['a draft agent', { agentId: 'agt_a_draft', sessionId: 'ses_1a_draft' }],
    ["another student's session", { sessionId: 'ses_2a' }],
    ["another teacher's session", { sessionId: 'ses_1b' }],
    ["another agent's session", { sessionId: 'ses_1a_draft' }],
    ['an ended session', { sessionId: 'ses_1a_ended' }],
    ['an unknown session', { sessionId: 'ses_nowhere' }],
    ['a malformed session id', { sessionId: "x' or 1=1" }],
    ['a session id that is not a string', { sessionId: 7 }],
    ['a malformed student id', { studentId: '' }],
    ['a malformed agent id', { agentId: 'a b' }],
  ])('%s → no_access', async (_label, patch) => {
    const a = accessTurns();
    expectRejected(await a.run({ ...input, ...patch } as TurnInput), a.modelCalls, 'no_access');
  });

  // Task 3.16: the session is pinned to the package version it started under.
  it.each([
    ['the package changed (downgrade)', { packageId: 'pkg_a_draft', packageVersion: 1 }],
    ['the package version changed', { packageId: 'pkg_a', packageVersion: 1 }],
  ])('%s since the session started → no_access, and the session ends', async (_label, pin) => {
    const a = accessTurns();
    const session = a.world.sessions.find((x) => x.id === 'ses_1a');
    if (session === undefined) throw new Error('fixture');
    Object.assign(session, pin);
    expectRejected(await a.run(input), a.modelCalls, 'no_access');
    expect(session.endedAt).not.toBeNull();
    expect(a.turnConfig.calls).toHaveLength(1);
  });

  it('malformed ids never reach the stores', async () => {
    const a = accessTurns();
    await a.run({ ...input, sessionId: 7 } as unknown as TurnInput);
    await a.run({ ...input, agentId: 'a b' });
    expect(a.entitlements.calls).toEqual([]);
    expect(a.turnConfig.calls).toEqual([]);
  });

  describe('paused and ended are refused for all three sources', () => {
    const base: Record<Entitlement['source'], Entitlement> = {
      subscription: {
        source: 'subscription',
        subscriptionId: 'sub_1a',
        studentId: 'stu_1',
        teacherId: 'tch_a',
        agentId: 'agt_a',
        market: 'IN',
        packageId: 'pkg_a',
        packageVersion: 2,
        status: 'active',
        periodEnd: '2026-12-01T00:00:00.000Z',
        allowedModuleIds: ['mod_a1'],
        lockedModuleIds: [],
        skills: ['explain'],
      },
      teacher_preview: {
        source: 'teacher_preview',
        studentId: 'tch_a',
        teacherId: 'tch_a',
        agentId: 'agt_a',
        market: 'IN',
        packageId: 'pkg_a',
        packageVersion: 2,
        status: 'active',
        periodEnd: '2026-12-01T00:00:00.000Z',
        allowedModuleIds: ['mod_a1'],
        lockedModuleIds: [],
        skills: ['explain'],
      },
      eval: {
        source: 'eval',
        studentId: 'stu_eval',
        teacherId: 'tch_a',
        agentId: 'agt_a',
        market: 'IN',
        packageId: 'pkg_a',
        packageVersion: 2,
        status: 'active',
        periodEnd: '2026-12-01T00:00:00.000Z',
        allowedModuleIds: ['mod_a1'],
        lockedModuleIds: [],
        skills: ['explain'],
      },
    };
    const inputs = { subscription: input, teacher_preview: previewIn, eval: evalIn };
    for (const source of ['subscription', 'teacher_preview', 'eval'] as const) {
      for (const status of ['paused', 'ended', 'active'] as const) {
        it(`${source} ${status}`, async () => {
          const store: EntitlementStore = {
            resolve: () => Promise.resolve({ ...base[source], status }),
          };
          const a = accessTurns({ source, overrides: { entitlements: store } });
          const out = await a.run(inputs[source]);
          if (status === 'active') expect(out.code).toBe('passed');
          else expectRejected(out, a.modelCalls, 'no_access');
        });
      }
    }

    it('an entitlement for another source, student or agent is refused', async () => {
      for (const e of [
        { ...base.eval, studentId: 'stu_1' },
        { ...base.subscription, studentId: 'stu_2' },
        { ...base.subscription, agentId: 'agt_b' },
      ]) {
        const a = accessTurns({
          overrides: { entitlements: { resolve: () => Promise.resolve(e) } },
        });
        expectRejected(await a.run(input), a.modelCalls, 'no_access');
      }
    });
  });

  describe('ADR-0004: every loaded object must belong to the entitlement', () => {
    const patches: [
      string,
      (c: NonNullable<Awaited<ReturnType<TurnConfigStore['load']>>>) => unknown,
    ][] = [
      ['agent id', (c) => ({ ...c, agent: { ...c.agent, id: 'agt_b' } })],
      ['agent teacher', (c) => ({ ...c, agent: { ...c.agent, teacherId: 'tch_b' } })],
      ['package id', (c) => ({ ...c, pkg: { ...c.pkg, id: 'pkg_b' } })],
      ['package teacher', (c) => ({ ...c, pkg: { ...c.pkg, teacherId: 'tch_b' } })],
      ['package agent', (c) => ({ ...c, pkg: { ...c.pkg, agentId: 'agt_b' } })],
      ['package version', (c) => ({ ...c, pkg: { ...c.pkg, version: 1 } })],
      ['package modules (allowed beyond it)', (c) => ({ ...c, pkg: { ...c.pkg, moduleIds: [] } })],
      ['package skills (allowed beyond it)', (c) => ({ ...c, pkg: { ...c.pkg, skills: [] } })],
      ['style card id', (c) => ({ ...c, styleCard: { ...c.styleCard, id: 'sty_b' } })],
      ['style card teacher', (c) => ({ ...c, styleCard: { ...c.styleCard, teacherId: 'tch_b' } })],
      ['locale market', (c) => ({ ...c, locale: { ...c.locale, market: 'global' } })],
      ['a schema-invalid object', (c) => ({ ...c, agent: { id: 'agt_a' } })],
      ['null', () => null],
    ];
    it.each(patches)('%s mismatch → no_access', async (_label, patch) => {
      const a = accessTurns();
      const real = memoryTurnConfigStore(a.world);
      a.t.deps.turnConfig = {
        load: async (e, sid) => {
          const cfg = await real.load(e, sid);
          if (cfg === null) throw new Error('fixture session should load');
          return patch(cfg) as never;
        },
      };
      expectRejected(await a.run(input), a.modelCalls, 'no_access');
    });
  });

  it('a store that throws or hangs is no_access (retryable), with no later step', async () => {
    const failing = accessTurns({
      overrides: { entitlements: { resolve: () => Promise.reject(new Error('db down')) } },
    });
    expectRejected(await failing.run(input), failing.modelCalls, 'no_access', true);
    const hanging = accessTurns({
      overrides: { turnConfig: { load: () => new Promise(() => undefined) } },
    });
    expectRejected(await hanging.run(input), hanging.modelCalls, 'no_access', true);
  });
});

describe('entitle: rolling 24-hour message limit → limit_reached', () => {
  /** Spaces turns 7 s apart so the rate limit (10/min) never fires, even for two at once. */
  async function turns(a: ReturnType<typeof accessTurns>, n: number, i: TurnInput) {
    const codes: string[] = [];
    for (let k = 0; k < n; k++) {
      codes.push((await a.run(i)).code);
      await a.t.clock.advance(RATE_LIMIT_WINDOW_MS / 10 + 1_000);
    }
    return codes;
  }

  it('message dailyMessageLimit + 1 is refused; it is allowed 24 h + 1 ms after message 1', async () => {
    const a = accessTurns();
    const t0 = a.t.clock.now();
    expect(await turns(a, 20, input)).toEqual(Array(20).fill('passed'));
    const out = await a.run(input);
    expectRejected(out, a.modelCalls, 'limit_reached');
    expect(out.retryable).toBe(false);
    // Refused turns do not count: still refused, and message 1 frees exactly one slot.
    await a.t.clock.advance(t0 + MESSAGE_WINDOW_MS - 1 - a.t.clock.now());
    expect((await a.run(input)).code).toBe('limit_reached');
    await a.t.clock.advance(2);
    expect((await a.run(input)).code).toBe('passed');
    expect((await a.run(input)).code).toBe('limit_reached');
  });

  it('counts per student x package', async () => {
    const a = accessTurns();
    await turns(a, 20, input);
    expect((await a.run(input)).code).toBe('limit_reached');
    // stu_2's trial with teacher B is counted separately.
    expect(
      (await a.run({ ...input, studentId: 'stu_2', agentId: 'agt_b', sessionId: 'ses_2b' })).code,
    ).toBe('passed');
  });

  it('a limit of 0 refuses every message', async () => {
    const a = accessTurns();
    for (const p of a.world.packages) p.dailyMessageLimit = 0;
    expect((await a.run(input)).code).toBe('limit_reached');
  });

  it('does not apply to teacher preview or eval', async () => {
    const preview = accessTurns({ source: 'teacher_preview', opts: PREVIEW });
    expect(await turns(preview, 25, previewIn)).toEqual(Array(25).fill('passed'));
    const ev = accessTurns({ source: 'eval', opts: EVAL });
    expect(await turns(ev, 25, evalIn)).toEqual(Array(25).fill('passed'));
  });

  it('a counter that throws is no_access (retryable)', async () => {
    const a = accessTurns({
      overrides: {
        limits: {
          rate: { tryTake: () => true },
          messages: {
            tryTake: () => {
              throw new Error('counter down');
            },
          },
        },
      },
    });
    expectRejected(await a.run(input), a.modelCalls, 'no_access', true);
  });

  it('concurrent turns at limit - 1 cannot both pass', async () => {
    const a = accessTurns();
    await turns(a, 19, input);
    const [x, y] = await Promise.all([a.run(input), a.run(input)]);
    expect([x.code, y.code].sort()).toEqual(['limit_reached', 'passed']);
  });
});

describe('entitle: limit_reached carries a friendly message (task 2.5)', () => {
  /** Calls the real entitle directly, so the thrown TurnRejection itself can be inspected. */
  async function rejection(a: ReturnType<typeof accessTurns>, i: TurnInput): Promise<unknown> {
    for (const p of a.world.packages) p.dailyMessageLimit = 0;
    const env = {
      input: i,
      deps: a.t.deps,
      cancel: cancelSource().token,
      turnId: 'turn_x',
      ...stepEnvExtras(),
    };
    return entitle(env).then(
      () => new Error('entitle passed'),
      (e: unknown) => e,
    );
  }

  const friendly = (lang: string): string => `[${lang}] you have used today's messages`;
  const withText = (limitReached: (lang: string) => string): FallbackReplies => ({
    safeReply: () => 'safe',
    distress: () => 'distress',
    limitReached,
  });

  it("uses the injected fallbackReplies.limitReached text in the student's language", async () => {
    const langs: string[] = [];
    const a = accessTurns({
      overrides: {
        fallbackReplies: withText((lang) => {
          langs.push(lang);
          return friendly(lang);
        }),
      },
    });
    const err = await rejection(a, { ...input, lang: 'hi' });
    expect(err).toBeInstanceOf(TurnRejection);
    expect(err).toMatchObject({ code: 'limit_reached', retryable: false });
    expect((err as TurnRejection).message).toBe(friendly('hi'));
    expect((err as TurnRejection).message).not.toContain('turn rejected');
    expect(langs).toEqual(['hi']);
  });

  it('the wire event stays the frozen { type, code, retryable } shape', async () => {
    const a = accessTurns({ overrides: { fallbackReplies: withText(friendly) } });
    for (const p of a.world.packages) p.dailyMessageLimit = 0;
    const out = await a.run(input);
    expect(out.events).toEqual([{ type: 'error', code: 'limit_reached', retryable: false }]);
  });

  it.each([
    ['no limitReached text is injected', undefined],
    ['the injected text is empty', () => ''],
    ['the injected text is blank', () => '   '],
    [
      'the injected function throws',
      () => {
        throw new Error('locale missing');
      },
    ],
    ['the injected function returns a non-string', () => 42 as unknown as string],
  ] as [string, ((lang: string) => string) | undefined][])(
    'falls back to the built-in friendly English text when %s',
    async (_l, fn) => {
      const replies: FallbackReplies = {
        safeReply: () => 'safe',
        distress: () => 'distress',
        ...(fn === undefined ? {} : { limitReached: fn }),
      };
      const a = accessTurns({ overrides: { fallbackReplies: replies } });
      const err = await rejection(a, input);
      expect(err).toBeInstanceOf(TurnRejection);
      expect((err as TurnRejection).code).toBe('limit_reached');
      expect((err as TurnRejection).message).toBe(DEFAULT_LIMIT_REACHED_REPLY);
    },
  );

  it('the built-in text is friendly, country-neutral and names no ids or numbers', () => {
    expect(DEFAULT_LIMIT_REACHED_REPLY).toMatch(/24 hours/);
    expect(DEFAULT_LIMIT_REACHED_REPLY).not.toMatch(/turn rejected|limit_reached|error/i);
    expect(DEFAULT_LIMIT_REACHED_REPLY.replace('24', '')).not.toMatch(/\d/);
  });

  it('the default test deps (no override) still give the built-in text', async () => {
    const err = await rejection(accessTurns(), input);
    expect((err as TurnRejection).message).toBe(DEFAULT_LIMIT_REACHED_REPLY);
  });
});

describe('entitle: client-sent package ids are ignored', () => {
  it("smuggled package, version, modules and skills for teacher B's package change nothing", async () => {
    const smuggled = {
      ...input,
      packageId: 'pkg_b',
      packageVersion: 1,
      allowedModuleIds: ['mod_b1', 'mod_b2'],
      lockedModuleIds: [],
      skills: ['explain', 'coach', 'practice', 'feedback', 'revision', 'roleplay'],
      teacherId: 'tch_b',
      source: 'eval',
    } as unknown as TurnInput;
    const clean = await accessTurns().run(input);
    const a = accessTurns();
    const out = await a.run(smuggled);
    expect(out.code).toBe('passed');
    expect(out.entitled).toEqual(clean.entitled);
    expect(out.entitled?.entitlement).toMatchObject({
      teacherId: 'tch_a',
      packageId: 'pkg_a',
      packageVersion: 2,
      allowedModuleIds: ['mod_a1', 'mod_a2'],
      skills: ['explain', 'coach', 'practice'],
      source: 'subscription',
    });
    expect(a.entitlements.calls.map((c) => c.x)).toEqual([
      { studentId: 'stu_1', agentId: 'agt_a', source: 'subscription' },
    ]);
    expect(Object.keys(a.entitlements.calls[0]!.x as object).sort()).toEqual([
      'agentId',
      'source',
      'studentId',
    ]);
    // The boundary's strict parse rejects these fields (contracts: TurnInputSchema is strict).
  });
});

describe('entitle: teacher preview and eval never need a subscription', () => {
  it('preview and eval pass with no subscription rows at all', async () => {
    const preview = accessTurns({ source: 'teacher_preview', opts: PREVIEW });
    preview.world.subscriptions.length = 0;
    const p = await preview.run(previewIn);
    expect(p.code).toBe('passed');
    expect(p.entitled?.entitlement.source).toBe('teacher_preview');
    expect(p.entitled?.entitlement).not.toHaveProperty('subscriptionId');
    expect(p.entitled?.agent.version).toBe(2);

    const ev = accessTurns({ source: 'eval', opts: EVAL });
    ev.world.subscriptions.length = 0;
    const e = await ev.run(evalIn);
    expect(e.code).toBe('passed');
    expect(e.entitled?.entitlement).not.toHaveProperty('subscriptionId');
  });

  it('a student asking for a teacher preview gets no_access', async () => {
    const a = accessTurns({ source: 'teacher_preview', opts: PREVIEW });
    expectRejected(await a.run(input), a.modelCalls, 'no_access');
  });
});
