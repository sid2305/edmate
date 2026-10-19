import {
  type Message,
  type ModelRequest,
  type ProfileStore,
  type RetrievalIndex,
  type TranscriptStore,
  type TurnContext,
  TurnContextSchema,
  TurnEventSchema,
  TurnTraceSchema,
  type TurnEvent,
} from '@edmate/contracts';
import {
  demoChunk,
  demoChunkScored,
  demoLearnerProfile,
  demoLocalePack,
  demoPedagogyDecision,
  demoTurnInput,
  usageMain,
  usageSmall,
} from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { driveEvents, driveTurn } from '../testing/driveTurn.js';
import {
  memorySessionStateStore,
  memoryTranscriptStore,
  memoryTurnLog,
} from '../testing/memoryPorts.js';
import { memoryRetrieval, OUT_OF_SCOPE_TEXT, retrievalWorld } from '../testing/memoryRetrieval.js';
import { scriptedStreamText } from '../testing/gatewayFixtures.js';
import {
  FIXTURE_PROMPT_PACK_VERSION,
  fixturePromptPackSet,
} from '../testing/promptPackFixtures.js';
import {
  type StepOverrides,
  TEST_CARING_REPLY,
  testAskDecision,
  testDecideResult,
  stepEnvExtras,
  testDeps,
  testSteps,
} from '../testing/testSteps.js';
import { hasDistressKeyword } from '../guardrails/distressKeywords.js';
import type { PiiScrubCtx } from '../guardrails/piiScrub.js';
import { fakeGuard } from '../testing/guardFixtures.js';
import { prng } from '../testing/prng.js';
import type { GatewayScript } from '../testing/scriptedGateway.js';
import {
  HarnessError,
  InvalidEventError,
  ScrubFailedError,
  StepNotImplementedError,
} from './errors.js';
import { createScrub } from './steps/scrub.js';
import { runTurn } from './runner.js';
import { STEP_NAMES, STEP_SPEC } from './spec.js';
import type { BuiltContext, StepEnv } from './types.js';
import { buildContext } from './steps/buildContext.js';
import { decide } from './steps/decide.js';
import { GuardRegistry } from '../guardrails/registry.js';
import { buildCaringReply } from './steps/escalate.js';
import { createPreGuardStep } from './steps/preGuard.js';
import { defaultSteps } from './steps/index.js';

function starts(log: { step: string; phase: string }[]): string[] {
  return log.filter((l) => l.phase === 'start').map((l) => l.step);
}

function terminalCount(events: TurnEvent[]): number {
  return events.filter((e) => e.type === 'done' || e.type === 'error').length;
}

describe('runTurn happy path', () => {
  it('streams tokens then done, and runs the steps in spec order', async () => {
    const t = testDeps();
    const steps = testSteps();
    const { events, result } = await driveTurn(
      runTurn(demoTurnInput, { deps: t.deps, steps }),
      t.clock,
    );

    expect(events).toEqual([
      { type: 'token', text: 'What do you notice ' },
      { type: 'token', text: 'about the denominators?' },
      { type: 'done', messageId: 'message_1', usage: [usageMain] },
    ]);
    for (const e of events) expect(TurnEventSchema.safeParse(e).success).toBe(true);
    expect(starts(steps.log)).toEqual([
      'admit',
      'entitle',
      'scrub',
      'preGuard',
      'route',
      'buildContext',
      'decide',
      'generate',
      'postGuard',
      'meter',
      'commit',
    ]);
    expect(t.portCalls).toEqual([]);
    expect(result.background).toEqual([]);
  });

  it('records one schema-valid trace with every executed step in spec order', async () => {
    const t = testDeps();
    const { result } = await driveTurn(
      runTurn(demoTurnInput, { deps: t.deps, steps: testSteps() }),
      t.clock,
    );
    expect(t.traces.records).toHaveLength(1);
    const trace = t.traces.records[0];
    expect(TurnTraceSchema.parse(trace)).toEqual(trace);
    expect(result.trace).toEqual(trace);
    expect(trace?.steps.map((s) => s.name)).toEqual(STEP_NAMES.filter((n) => n !== 'escalate'));
    expect(trace?.steps.every((s) => s.outcome === 'ok')).toBe(true);
    expect(trace).toMatchObject({
      turnId: 'turn_1',
      sessionId: demoTurnInput.sessionId,
      intent: 'on_task',
      move: demoPedagogyDecision.move,
      usage: [usageMain],
      guards: [
        { name: 'piiScrub', ok: true },
        { name: 'moderationIn', ok: true },
        { name: 'answerLeak', ok: true },
      ],
    });
  });

  it('meters every usage row with the turn and entitlement', async () => {
    const t = testDeps();
    const steps = testSteps({
      route: {
        run: () => Promise.resolve({ intent: 'on_task', attempt: 'none', usage: [usageSmall] }),
      },
    });
    const { events } = await driveTurn(runTurn(demoTurnInput, { deps: t.deps, steps }), t.clock);
    expect(events.at(-1)).toEqual({
      type: 'done',
      messageId: 'message_1',
      usage: [usageSmall, usageMain],
    });
    expect(t.usage.rows.map((r) => r.usage)).toEqual([usageSmall, usageMain]);
    expect(t.usage.rows[0]?.ctx).toEqual({
      teacherId: 'tch_test_01',
      packageId: 'pkg_test_paid',
      studentId: 'stu_test_01',
      turnId: 'turn_1',
      source: 'subscription',
    });
  });

  it('commits the reply, the scrubbed input, the context and the decision', async () => {
    const t = testDeps();
    const steps = testSteps({
      scrub: () => Promise.resolve({ text: 'How do I add [number] and 1/3?', guards: [] }),
    });
    await driveTurn(runTurn(demoTurnInput, { deps: t.deps, steps }), t.clock);
    expect(steps.commits).toHaveLength(1);
    expect(steps.commits[0]).toMatchObject({
      turnId: 'turn_1',
      messageId: 'message_1',
      outcome: 'replied',
      intent: 'on_task',
      replyText: 'What do you notice about the denominators?',
      decision: demoPedagogyDecision,
      input: { text: 'How do I add [number] and 1/3?' },
    });
    expect(steps.commits[0]?.context?.retrieved).toHaveLength(1);
  });

  it('gives identical events and traces when the same scenario runs twice', async () => {
    const once = async () => {
      const t = testDeps();
      const out = await driveTurn(
        runTurn(demoTurnInput, { deps: t.deps, steps: testSteps() }),
        t.clock,
      );
      return { timed: out.timed, trace: out.result.trace, records: t.traces.records };
    };
    expect(await once()).toEqual(await once());
  });

  it('emits done before a commit that never resolves', async () => {
    const t = testDeps();
    const steps = testSteps({ commit: () => new Promise<void>(() => undefined) });
    const run = runTurn(demoTurnInput, { deps: t.deps, steps });
    const timed = await driveEvents(run, t.clock);
    expect(timed.at(-1)?.event.type).toBe('done');
    expect(t.traces.records).toEqual([]);
  });

  it('keeps running to commit and trace when the consumer stops early', async () => {
    const t = testDeps();
    const steps = testSteps();
    const run = runTurn(demoTurnInput, { deps: t.deps, steps });
    const seen: TurnEvent[] = [];
    const consume = (async () => {
      for await (const e of run.events) {
        seen.push(e);
        break;
      }
    })();
    const result = await t.clock.drive(Promise.all([consume, run.finished]).then(([, r]) => r));
    expect(seen).toHaveLength(1);
    expect(steps.commits).toHaveLength(1);
    expect(t.traces.records).toHaveLength(1);
    expect(result.trace).not.toBeNull();
  });

  it('allows the events to be iterated only once', () => {
    const t = testDeps();
    const run = runTurn(demoTurnInput, { deps: t.deps, steps: testSteps() });
    run.events[Symbol.asyncIterator]();
    expect(() => run.events[Symbol.asyncIterator]()).toThrow(/once/);
  });
});

describe('runTurn events from steps', () => {
  it('treats an invalid emitted event as a generate failure and retries', async () => {
    const t = testDeps();
    let calls = 0;
    const steps = testSteps({
      generate: (_env, _x, emit) => {
        calls++;
        if (calls === 1) emit({ type: 'token', text: 5 } as unknown as TurnEvent);
        else emit({ type: 'token', text: 'ok' });
        return Promise.resolve({ draft: 'ok' });
      },
    });
    const { events, result } = await driveTurn(
      runTurn(demoTurnInput, { deps: t.deps, steps }),
      t.clock,
    );
    expect(calls).toBe(2);
    expect(events).toEqual([
      { type: 'token', text: 'ok' },
      { type: 'done', messageId: 'message_1', usage: [] },
    ]);
    expect(result.trace?.steps.find((s) => s.name === 'generate')?.outcome).toBe('fallback');
  });

  it('does not let a step send done or error itself', async () => {
    const t = testDeps();
    let thrown: unknown;
    const steps = testSteps({
      generate: (_env, _x, emit) => {
        try {
          emit({ type: 'done', messageId: 'message_9', usage: [] });
        } catch (e) {
          thrown = e;
        }
        return Promise.resolve({ draft: 'x' });
      },
    });
    const { events } = await driveTurn(runTurn(demoTurnInput, { deps: t.deps, steps }), t.clock);
    expect(thrown).toBeInstanceOf(InvalidEventError);
    expect(events).toEqual([{ type: 'error', code: 'provider_error', retryable: true }]);
  });

  it('drops events a step emits after its timeout', async () => {
    const t = testDeps();
    let late: (() => void) | undefined;
    const steps = testSteps({
      generate: async (env, x, emit) => {
        if (x.attempt === 'primary') {
          late = () => emit({ type: 'token', text: 'late' });
          await env.deps.clock.sleep(20_000);
          return { draft: 'late' };
        }
        emit({ type: 'token', text: 'retry' });
        late?.();
        return { draft: 'retry' };
      },
    });
    const { events } = await driveTurn(runTurn(demoTurnInput, { deps: t.deps, steps }), t.clock);
    expect(events.map((e) => e.type)).toEqual(['token', 'done']);
    expect(events[0]).toEqual({ type: 'token', text: 'retry' });
  });
});

describe('runTurn runner bugs', () => {
  it('ends the stream with provider_error when the id source throws', async () => {
    const t = testDeps({
      overrides: {
        ids: {
          next: () => {
            throw new Error('id source down');
          },
        },
      },
    });
    const { events, result } = await driveTurn(
      runTurn(demoTurnInput, { deps: t.deps, steps: testSteps() }),
      t.clock,
    );
    expect(events).toEqual([{ type: 'error', code: 'provider_error', retryable: true }]);
    expect(result.trace).toBeNull();
    expect(result.background.map((b) => b.task)).toEqual(['runner']);
  });

  it('reports a bug after done without a second terminal event', async () => {
    const t = testDeps({
      overrides: {
        traces: {
          record: () => {
            throw new Error('sync throw');
          },
        },
      },
    });
    const { events, result } = await driveTurn(
      runTurn(demoTurnInput, { deps: t.deps, steps: testSteps() }),
      t.clock,
    );
    expect(terminalCount(events)).toBe(1);
    expect(events.at(-1)?.type).toBe('done');
    expect(result.background.map((b) => b.task)).toEqual(['trace']);
  });
});

describe('defaultSteps (stubs)', () => {
  it('every stub throws StepNotImplementedError (admit, entitle: 3.2; buildContext: 3.4; decide: 3.6; generate: 3.7; meter, commit: 3.8; preGuard, escalate: 4.3)', async () => {
    const t = testDeps();
    const env = {
      input: demoTurnInput,
      deps: t.deps,
      cancel: { cancelled: false, onCancel: () => undefined },
      turnId: 'turn_x',
      ...stepEnvExtras(),
    };
    const anyArg = {} as never;
    const calls: (() => unknown)[] = [
      () => defaultSteps.route.run(env, anyArg),
      () => defaultSteps.postGuard(env, anyArg),
    ];
    for (const call of calls) await expect(call()).rejects.toBeInstanceOf(StepNotImplementedError);
    expect(defaultSteps.route.onFailure(env, anyArg)).toEqual({
      intent: 'on_task',
      attempt: 'none',
    });
  });

  it('fails closed: the real entitle with a failing store refuses the turn', async () => {
    const t = testDeps();
    const { events } = await driveTurn(
      runTurn(demoTurnInput, { deps: t.deps, steps: defaultSteps }),
      t.clock,
    );
    expect(events).toEqual([{ type: 'error', code: 'no_access', retryable: true }]);
    expect(t.portCalls).toEqual(['entitlements.resolve']);
  });

  it('fails closed: past admit, entitle and the real scrub, the real preGuard with no classifier blocks the turn', async () => {
    const t = testDeps();
    const happy = testSteps();
    const steps = {
      ...defaultSteps,
      admit: happy.admit,
      entitle: happy.entitle,
      commit: happy.commit,
    };
    const { events } = await driveTurn(runTurn(demoTurnInput, { deps: t.deps, steps }), t.clock);
    expect(events).toEqual([{ type: 'error', code: 'guard_blocked', retryable: true }]);
    // The real buildContext and preGuard run side by side; they only read (and hit unused stores).
    expect([...t.portCalls].sort()).toEqual(['profiles.get', 'transcripts.history']);
  });
});

describe('runTurn with the real scrub (4.2)', () => {
  // Fake numbers from the eval cases; never in a test name.
  const PHONE = '90000 11111';
  const piiInput = { ...demoTurnInput, text: `save my number ${PHONE} and text me` };
  const scrubbedText = 'save my number [phone] and text me';

  it('threads the scrubbed text to every later step, the model and CommitRecord.input', async () => {
    const t = testDeps();
    const steps = testSteps({ scrub: defaultSteps.scrub });
    const { events, result } = await driveTurn(runTurn(piiInput, { deps: t.deps, steps }), t.clock);
    const seen = t.gateway.requests.map((r) => JSON.stringify(r));
    expect(events.at(-1)?.type).toBe('done');
    for (const s of ['preGuard', 'route', 'buildContext', 'decide', 'generate', 'commit']) {
      const entry = steps.log.find((l) => l.step === s && l.phase === 'start');
      expect(entry?.text, s).toBe(scrubbedText);
    }
    expect(steps.log.find((l) => l.step === 'scrub')?.text).toBe(piiInput.text);
    expect(steps.commits[0]?.input?.text).toBe(scrubbedText);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain(scrubbedText);
    expect(seen.join('')).not.toContain(PHONE);
    expect(result.trace?.guards.slice(0, 2)).toEqual([
      { name: 'piiScrub', ok: false, action: 'rewrite' },
      { name: 'piiScrub', ok: true },
    ]);
    expect(JSON.stringify(result)).not.toContain(PHONE);
  });

  describe('the distress keyword check on the raw text (fix round, safety review)', () => {
    const MARKER = 'RAWDISTRESSMARKER';
    const raw = { ...demoTurnInput, text: `I feel ${MARKER} today` };
    // A scrub that removes the words the keyword check needs (what over-redaction would do).
    const wipe = (env: StepEnv) =>
      Promise.resolve({ text: (env.input.text ?? '').replace(MARKER, '[name]'), guards: [] });
    const deps = (impl: (text: string) => boolean) => {
      const seen: string[] = [];
      const t = testDeps({
        overrides: {
          distressCheck: (text) => {
            seen.push(text);
            return impl(text);
          },
        },
      });
      return { t, seen };
    };

    it('runs before the scrub; a hit escalates even when the scrub removed the words', async () => {
      const { t, seen } = deps((text) => text.includes(MARKER));
      const steps = testSteps({ scrub: wipe });
      const { events, result } = await driveTurn(runTurn(raw, { deps: t.deps, steps }), t.clock);
      expect(seen[0]).toBe(raw.text);
      expect(events).toEqual([
        { type: 'safety', level: 'alert' },
        { type: 'token', text: TEST_CARING_REPLY },
        { type: 'done', messageId: 'message_1', usage: [] },
      ]);
      expect(t.alerts.raised).toHaveLength(1);
      expect(steps.commits[0]).toMatchObject({ outcome: 'escalated', intent: 'distress' });
      // Only the boolean is kept: the raw text reaches no step after the scrub, no alert or trace.
      const after = steps.log.filter((l) => !['admit', 'entitle', 'scrub'].includes(l.step));
      expect(after.map((l) => l.text)).not.toContain(raw.text);
      const kept = JSON.stringify([result, steps.commits, t.alerts.raised, t.traces.records]);
      expect(kept).not.toContain(MARKER);
    });

    it('no hit on the raw text → the turn replies as usual', async () => {
      const { t, seen } = deps(() => false);
      const steps = testSteps({ scrub: wipe });
      const { events } = await driveTurn(runTurn(raw, { deps: t.deps, steps }), t.clock);
      expect(events.at(-1)?.type).toBe('done');
      expect(t.alerts.raised).toEqual([]);
      expect(seen).toEqual([raw.text]);
    });

    it('a throwing check is reported without the text and the turn goes on', async () => {
      const { t } = deps((text) => {
        throw new Error(`cannot check ${text}`);
      });
      const steps = testSteps({ scrub: wipe });
      const { events, result } = await driveTurn(runTurn(raw, { deps: t.deps, steps }), t.clock);
      expect(events.at(-1)?.type).toBe('done');
      expect(result.background.map((b) => String(b.error))).toEqual([
        'Error: distressCheck failed on the unscrubbed text',
      ]);
    });
  });

  it('scrubs the skill payload before any later step sees it', async () => {
    const t = testDeps();
    const steps = testSteps({ scrub: defaultSteps.scrub });
    let payloadSeen: unknown;
    const input = { ...demoTurnInput, skillPayload: { note: `call ${PHONE}` } };
    const route = steps.route.run;
    steps.route.run = (env, e) => {
      payloadSeen = env.input.skillPayload;
      return route(env, e);
    };
    await driveTurn(runTurn(input, { deps: t.deps, steps }), t.clock);
    expect(payloadSeen).toEqual({ note: 'call [phone]' });
    expect(JSON.stringify(steps.commits)).not.toContain(PHONE);
  });

  it('a scrub that drops the payload fails closed', async () => {
    const t = testDeps();
    const steps = testSteps({
      scrub: (env) => Promise.resolve({ text: env.input.text ?? '', guards: [] }),
    });
    const input = { ...demoTurnInput, skillPayload: { a: 1 } };
    const { events, result } = await driveTurn(runTurn(input, { deps: t.deps, steps }), t.clock);
    expect(events).toEqual([{ type: 'error', code: 'guard_blocked', retryable: true }]);
    expect(result.background.map((b) => (b.error as Error).cause)).toEqual([
      { guardCause: 'step_invalid_result' },
    ]);
  });

  it.each([
    [
      'the step throws a ScrubFailedError',
      () => Promise.reject(new ScrubFailedError({ guardCause: 'error', errorName: 'TypeError' })),
      { guardCause: 'error', errorName: 'TypeError' },
    ],
    [
      'the step throws a plain Error',
      () => Promise.reject(new RangeError(`bad ${PHONE}`)),
      { guardCause: 'step_error', errorName: 'RangeError' },
    ],
    [
      'the step throws a non-Error',
      () => Promise.reject(`raw ${PHONE}`),
      { guardCause: 'step_error', errorName: 'string' },
    ],
    [
      'the step throws an Error with a non-string name',
      () => Promise.reject(Object.assign(new Error(PHONE), { name: 7 })),
      { guardCause: 'step_error', errorName: 'Error' },
    ],
    [
      'the step returns a bad result',
      () => Promise.resolve({ text: 1 } as never),
      { guardCause: 'step_invalid_result' },
    ],
    [
      'the step times out',
      () => new Promise<never>(() => undefined),
      { guardCause: 'step_timeout' },
    ],
  ] as const)('a failed scrub is reported on background: %s', async (_label, scrub, cause) => {
    const t = testDeps();
    const steps = testSteps({ scrub: scrub as never });
    const { events, result } = await driveTurn(runTurn(piiInput, { deps: t.deps, steps }), t.clock);
    expect(events).toEqual([{ type: 'error', code: 'guard_blocked', retryable: true }]);
    expect(result.background).toHaveLength(1);
    const bg = result.background[0];
    expect(bg?.task).toBe('runner');
    expect(bg?.error).toBeInstanceOf(ScrubFailedError);
    expect((bg?.error as Error).cause).toEqual(cause);
    expect(steps.commits[0]?.input).toBeNull();
  });

  it('a scrub failure reaches the background log as a HarnessError: name and fixed message only', async () => {
    const log = memoryTurnLog();
    const t = testDeps({ overrides: { log } });
    const guard = fakeGuard<PiiScrubCtx>('piiScrub', 'scrub', (text) => {
      throw new TypeError(`broke on ${text}`);
    });
    const steps = testSteps({ scrub: createScrub([guard]) });
    await driveTurn(runTurn(piiInput, { deps: t.deps, steps }), t.clock);
    expect(new ScrubFailedError({ guardCause: 'error' })).toBeInstanceOf(HarnessError);
    expect(log.entries).toHaveLength(1);
    expect(log.entries[0]).toMatchObject({
      task: 'runner',
      errorName: 'ScrubFailedError',
      errorMessage: 'scrub failed closed (error)',
    });
    expect(JSON.stringify(log.entries)).not.toContain(PHONE);
  });

  it('property: a guard error that quotes the input never reaches background, trace or commit', async () => {
    const r = prng(4_2);
    const phones = ['90000 11111', '80000 33333', '+91 90000 66666', '९०००० १२३४५'];
    const errors = [Error, TypeError, RangeError, SyntaxError];
    for (let i = 0; i < 40; i++) {
      const literal = r.pick(phones);
      const Ctor = r.pick(errors);
      const guard = fakeGuard<PiiScrubCtx>('piiScrub', 'scrub', (text) => {
        throw new Ctor(`guard broke on: ${text} (${literal})`);
      });
      const t = testDeps();
      const steps = testSteps({ scrub: createScrub([guard]) });
      const input = { ...demoTurnInput, text: `my number is ${literal}` };
      const { events, result } = await driveTurn(runTurn(input, { deps: t.deps, steps }), t.clock);
      expect(events.at(-1)).toEqual({ type: 'error', code: 'guard_blocked', retryable: true });
      const bg = result.background.map((b) => {
        const e = b.error as Error;
        return [b.task, String(e), e.message, e.stack, JSON.stringify({ ...e, cause: e.cause })];
      });
      expect(bg).toHaveLength(1);
      expect((result.background[0]?.error as Error).cause).toEqual({
        guardCause: 'error',
        errorName: Ctor.name,
      });
      const all = JSON.stringify([bg, result.trace, steps.commits, t.traces.records]);
      expect(all).not.toContain(literal);
    }
  });
});

describe('runTurn with the real buildContext (3.4)', () => {
  const ANSWER_KEY = 'ANSWER_KEY_MARKER';
  const stored = {
    v: 1,
    rung: 2,
    stuckTurns: 1,
    attemptLogged: false,
    pendingCheck: false,
    answerKey: [ANSWER_KEY],
  };
  const history: Message[] = [
    {
      id: 'msg_1',
      role: 'agent',
      text: 'Can you add 1/2 and 1/3 with a common denominator?',
      createdAt: '2026-10-17T09:59:00Z',
    },
  ];

  function setup(o: { retrieval?: RetrievalIndex; profileDelayMs?: number } = {}) {
    const holder: { sleep?: (ms: number) => Promise<void> } = {};
    const profiles: ProfileStore = {
      async get() {
        if (o.profileDelayMs !== undefined) await holder.sleep?.(o.profileDelayMs);
        return demoLearnerProfile;
      },
      applyEvidence: () => Promise.reject(new Error('unused')),
    };
    const transcripts: TranscriptStore = {
      history: () => Promise.resolve(history),
      append: () => Promise.reject(new Error('unused')),
    };
    const retrieval = o.retrieval ?? memoryRetrieval({ chunks: retrievalWorld() });
    const t = testDeps({ overrides: { profiles, transcripts, retrieval } });
    holder.sleep = (ms) => t.clock.sleep(ms);
    const seen: TurnContext[] = [];
    const happy = testSteps();
    const steps = testSteps({
      entitle: async (env) => ({ ...(await happy.entitle(env)), helpState: stored }),
      buildContext,
      decide: {
        run: (_env, { ctx }) => {
          seen.push(ctx);
          return Promise.resolve(testDecideResult(demoPedagogyDecision));
        },
      },
    });
    return { t, steps, seen };
  }

  it('reaches decide with a schema-valid TurnContext built from the stores', async () => {
    const { t, steps, seen } = setup();
    const { events, result } = await driveTurn(
      runTurn(demoTurnInput, { deps: t.deps, steps }),
      t.clock,
    );
    expect(events.at(-1)?.type).toBe('done');
    expect(seen).toHaveLength(1);
    const ctx = seen[0] as TurnContext;
    expect(TurnContextSchema.safeParse(ctx).success).toBe(true);
    expect(ctx.profile).toEqual(demoLearnerProfile);
    expect(ctx.history).toEqual(history);
    expect(ctx.retrieved.length).toBeGreaterThan(0);
    expect(ctx.helpRung).toBe(2);
    expect(result.trace?.steps.find((s) => s.name === 'buildContext')?.outcome).toBe('ok');
  });

  it('the help state (answerKey) and locked text never reach TurnContext, events or the trace', async () => {
    const { t, steps, seen } = setup();
    const { events, result } = await driveTurn(
      runTurn(
        { ...demoTurnInput, text: 'fractions denominator integration by parts' },
        { deps: t.deps, steps },
      ),
      t.clock,
    );
    expect(events.at(-1)?.type).toBe('done');
    expect('helpState' in (seen[0] as object)).toBe(false);
    for (const out of [seen, events, result.trace]) {
      const json = JSON.stringify(out);
      expect(json).not.toContain(ANSWER_KEY);
      expect(json).not.toContain(OUT_OF_SCOPE_TEXT);
    }
    expect(seen[0]?.lockedHit).toBe(true);
  });

  it('an index that widens the scope → fallback context; the turn still completes', async () => {
    const leaky: RetrievalIndex = {
      search: () =>
        Promise.resolve([{ ...demoChunk, moduleId: 'mod_test_04', text: OUT_OF_SCOPE_TEXT }]),
      probe: () => Promise.resolve({ hit: false, score: 0 }),
    };
    const { t, steps, seen } = setup({ retrieval: leaky });
    const { events, result } = await driveTurn(
      runTurn(demoTurnInput, { deps: t.deps, steps }),
      t.clock,
    );
    expect(events.at(-1)?.type).toBe('done');
    expect(seen[0]).toMatchObject({ retrieved: [], lockedHit: false, history: [], helpRung: 0 });
    expect(result.trace?.steps.find((s) => s.name === 'buildContext')?.outcome).toBe('fallback');
    expect(JSON.stringify([seen, events, result.trace])).not.toContain(OUT_OF_SCOPE_TEXT);
  });

  it('a slow store → timeout → fallback context; the turn still completes', async () => {
    const { t, steps, seen } = setup({ profileDelayMs: 10_000 });
    const { events, result } = await driveTurn(
      runTurn(demoTurnInput, { deps: t.deps, steps }),
      t.clock,
    );
    expect(events.at(-1)?.type).toBe('done');
    expect(seen[0]).toMatchObject({ retrieved: [], helpRung: 0 });
    expect(result.trace?.steps.find((s) => s.name === 'buildContext')?.outcome).toBe('fallback');
  });
});

describe('runTurn with the real decide (3.6)', () => {
  const ANSWER_KEY = 'ANSWER_KEY_3_6_MARKER';
  const CANARY = 'CANARY_LOCKED_MODULE_5e7f';
  const stored = {
    v: 1,
    rung: 1,
    stuckTurns: 1,
    attemptLogged: false,
    pendingCheck: false,
    answerKey: [ANSWER_KEY],
  };

  function setup(
    o: {
      built?: Partial<BuiltContext>;
      promptPackVersion?: string;
      decide?: StepOverrides['decide'];
    } = {},
  ) {
    const requests: ModelRequest[] = [];
    const t = testDeps({
      script: {
        stream: [
          {
            match: (req) => {
              requests.push(req);
              return true;
            },
            steps: scriptedStreamText.steps,
          },
        ],
      },
    });
    const happy = testSteps();
    const steps = testSteps({
      entitle: async (env) => {
        const e = await happy.entitle(env);
        return {
          ...e,
          agent: {
            ...e.agent,
            promptPackVersion: o.promptPackVersion ?? FIXTURE_PROMPT_PACK_VERSION,
          },
          helpState: stored,
        };
      },
      buildContext: async (env, e) => ({
        ...(await happy.buildContext(env, e)),
        retrieved: [demoChunkScored],
        helpRung: 1,
        helpState: {
          stuckTurns: 1,
          attemptLogged: false,
          pendingCheck: false,
          answerKey: [ANSWER_KEY],
        },
        ...o.built,
      }),
      decide: { ...decide, ...o.decide },
      // The real generate (3.7).
      generate: defaultSteps.generate,
    });
    return { t, steps, requests };
  }

  it('the help state reaches the policy; next and promptPack land on CommitRecord', async () => {
    const { t, steps, requests } = setup();
    const { events, result } = await driveTurn(
      runTurn(demoTurnInput, { deps: t.deps, steps }),
      t.clock,
    );
    expect(events.at(-1)?.type).toBe('done');
    const rec = steps.commits[0];
    // stuckTurns 1 + another turn with no attempt → climb from rung 1 to 2.
    expect(rec?.decision).toMatchObject({ move: 'hint', rung: 2, mustNotReveal: [ANSWER_KEY] });
    expect(rec?.next).toEqual({
      rung: 2,
      help: { stuckTurns: 0, attemptLogged: false, pendingCheck: false, answerKey: [ANSWER_KEY] },
    });
    expect(rec?.promptPack).toEqual({
      set: FIXTURE_PROMPT_PACK_VERSION,
      packs: { safety: '0.1.0', coach: '0.1.0', frame: '0.1.0' },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.system).toBe(rec?.decision?.systemPrompt);
    expect(result.trace?.move).toBe('hint');
    expect(result.trace?.steps.find((s) => s.name === 'decide')?.outcome).toBe('ok');
    // The answer key and `next` stay server-side: never in an event or the trace.
    const out = JSON.stringify([events, result.trace]);
    expect(out).not.toContain(ANSWER_KEY);
    expect(out).not.toContain('stuckTurns');
  });

  it('a locked-module chunk with lockedHit → the turn runs; the canary reaches no model, commit or trace', async () => {
    const { t, steps, requests } = setup({
      built: {
        retrieved: [{ ...demoChunk, moduleId: 'mod_test_04', text: CANARY }],
        lockedHit: true,
      },
    });
    const { events, result } = await driveTurn(
      runTurn(demoTurnInput, { deps: t.deps, steps }),
      t.clock,
    );
    expect(events.at(-1)?.type).toBe('done');
    expect(requests.length).toBeGreaterThan(0);
    for (const r of requests) expect(JSON.stringify(r)).not.toContain(CANARY);
    expect(steps.commits[0]?.decision?.systemPrompt).not.toContain(CANARY);
    expect(JSON.stringify(steps.commits[0]?.decision)).not.toContain(CANARY);
    expect(JSON.stringify([events, result.trace])).not.toContain(CANARY);
  });

  it('lockedHit with no allowed retrieval → move locked; no locked module id or title', async () => {
    const { t, steps, requests } = setup({ built: { retrieved: [], lockedHit: true } });
    const { events, result } = await driveTurn(
      runTurn(demoTurnInput, { deps: t.deps, steps }),
      t.clock,
    );
    expect(events.at(-1)?.type).toBe('done');
    expect(result.trace?.move).toBe('locked');
    const system = requests[0]?.system ?? '';
    expect(system).toContain(fixturePromptPackSet.packs.locked.body);
    expect(system).not.toContain('mod_test_04');
    expect(steps.commits[0]?.promptPack?.packs).toHaveProperty('locked');
  });

  it('an unknown prompt-pack version → provider_error; nothing reaches the gateway', async () => {
    const { t, steps, requests } = setup({ promptPackVersion: '9.9.9' });
    const { events, result } = await driveTurn(
      runTurn(demoTurnInput, { deps: t.deps, steps }),
      t.clock,
    );
    expect(events).toEqual([{ type: 'error', code: 'provider_error', retryable: true }]);
    expect(requests).toEqual([]);
    expect(result.trace?.steps.find((s) => s.name === 'decide')?.outcome).toBe('failed');
    expect(steps.commits[0]).toMatchObject({ outcome: 'error' });
    expect(steps.commits[0]?.decision).toBeUndefined();
  });

  it('run fails → the real fallback (`ask`, fallback pack, no material); the turn replies', async () => {
    const { t, steps, requests } = setup({
      decide: { run: () => Promise.reject(new Error('decide failed')) },
    });
    const { events, result } = await driveTurn(
      runTurn(demoTurnInput, { deps: t.deps, steps }),
      t.clock,
    );
    expect(events.at(-1)?.type).toBe('done');
    expect(result.trace?.steps.find((s) => s.name === 'decide')?.outcome).toBe('fallback');
    expect(steps.commits[0]?.decision?.move).toBe('ask');
    expect(requests[0]?.system).toContain(fixturePromptPackSet.packs.fallback.body);
    expect(requests[0]?.system).not.toContain(demoChunkScored.text);
    expect(steps.log.find((l) => l.step === 'decide.fallback')?.at).toBeTypeOf('number');
  });

  it('a fallback that returns redirect outside distress → provider_error', async () => {
    const { t, steps } = setup({
      decide: {
        run: () => Promise.reject(new Error('decide failed')),
        fallback: () => testDecideResult({ ...testAskDecision, move: 'redirect' }),
      },
    });
    const { events, result } = await driveTurn(
      runTurn(demoTurnInput, { deps: t.deps, steps }),
      t.clock,
    );
    expect(events).toEqual([{ type: 'error', code: 'provider_error', retryable: true }]);
    expect(result.background.map((b) => String(b.error))).toEqual([
      'Error: decide.fallback returned move "redirect"',
    ]);
  });
});

describe('runTurn with the real meter and commit (3.8)', () => {
  function realBackground() {
    const transcripts = memoryTranscriptStore();
    const sessionState = memorySessionStateStore();
    const t = testDeps({ overrides: { transcripts, sessionState } });
    const happy = testSteps();
    const steps = { ...happy, meter: defaultSteps.meter, commit: defaultSteps.commit };
    return { t, transcripts, sessionState, steps };
  }

  it('meters the usage and commits both messages to the input session', async () => {
    const w = realBackground();
    const { events, result } = await driveTurn(
      runTurn(demoTurnInput, { deps: w.t.deps, steps: w.steps }),
      w.t.clock,
    );
    expect(events.at(-1)).toEqual({ type: 'done', messageId: 'message_1', usage: [usageMain] });
    expect(result.background).toEqual([]);
    expect(w.t.usage.rows).toHaveLength(1);
    expect(w.t.usage.rows[0]?.ctx.turnId).toBe('turn_1');
    expect(w.transcripts.appended.map((a) => [a.sessionId, a.message.role])).toEqual([
      ['ses_test_01', 'student'],
      ['ses_test_01', 'agent'],
    ]);
    const [student, agent] = w.transcripts.appended.map((a) => a.message);
    expect(agent?.id).toBe('message_1');
    expect(student?.id).not.toBe(agent?.id);
    expect(student && agent && student.createdAt <= agent.createdAt).toBe(true);
    expect(result.trace?.steps.filter((s) => s.name === 'meter' || s.name === 'commit')).toEqual([
      { name: 'meter', ms: 0, outcome: 'ok' },
      { name: 'commit', ms: 0, outcome: 'ok' },
    ]);
  });

  it('a failed scrub still names the session on CommitRecord (sessionId from the input)', async () => {
    const t = testDeps();
    const steps = testSteps({ scrub: () => Promise.reject(new Error('scrub down')) });
    await driveTurn(runTurn(demoTurnInput, { deps: t.deps, steps }), t.clock);
    expect(steps.commits).toHaveLength(1);
    expect(steps.commits[0]).toMatchObject({ input: null, sessionId: 'ses_test_01' });
    expect(steps.commits[0]?.receivedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('a failing transcript store is reported as a failed commit, not thrown', async () => {
    const t = testDeps({
      overrides: {
        transcripts: memoryTranscriptStore({ fail: true }),
        sessionState: memorySessionStateStore(),
      },
    });
    const steps = { ...testSteps(), commit: defaultSteps.commit };
    const { events, result } = await driveTurn(
      runTurn(demoTurnInput, { deps: t.deps, steps }),
      t.clock,
    );
    expect(events.at(-1)?.type).toBe('done');
    expect(result.background.map((b) => b.task)).toEqual(['commit']);
    expect(result.trace?.steps.find((s) => s.name === 'commit')?.outcome).toBe('failed');
  });
});

describe('runTurn with the real preGuard, escalate and distressCheck (4.3)', () => {
  const realDistress = (o: StepOverrides = {}) =>
    testSteps({ preGuard: defaultSteps.preGuard, escalate: defaultSteps.escalate, ...o });
  const deps = (script?: GatewayScript) =>
    testDeps({
      ...(script === undefined ? {} : { script }),
      overrides: { transcripts: memoryTranscriptStore(), distressCheck: hasDistressKeyword },
    });
  const at = (text: string) => ({ ...demoTurnInput, text });

  it('hard keyword: escalates with the guard alert and the caring template; the turn is saved', async () => {
    const t = deps();
    const steps = realDistress();
    const { events, result } = await driveTurn(
      runTurn(at('i want to kill myself'), { deps: t.deps, steps }),
      t.clock,
    );
    expect(events).toEqual([
      { type: 'safety', level: 'alert' },
      { type: 'token', text: buildCaringReply(demoLocalePack) },
      { type: 'done', messageId: 'message_1', usage: [] },
    ]);
    expect(t.alerts.raised).toEqual([
      expect.objectContaining({ kind: 'distress', excerptRedacted: 'i want to kill myself' }),
    ]);
    expect(steps.commits).toHaveLength(1);
    expect(steps.commits[0]).toMatchObject({ outcome: 'escalated', intent: 'distress' });
    expect(result.trace).toMatchObject({ intent: 'distress', move: 'redirect' });
    expect(result.trace?.guards).toContainEqual({
      name: 'distressDetect',
      ok: false,
      action: 'escalate',
    });
  }, 2_000);

  it('the chain fails (no pre guard registered) on a hard keyword: the runner keyword check still escalates', async () => {
    const t = deps();
    const steps = realDistress({ preGuard: createPreGuardStep(new GuardRegistry('pre')) });
    const { events, result } = await driveTurn(
      runTurn(at('i want to kill myself'), { deps: t.deps, steps }),
      t.clock,
    );
    expect(events[0]).toEqual({ type: 'safety', level: 'alert' });
    expect(result.trace?.steps.find((s) => s.name === 'preGuard')?.outcome).toBe('failed');
    // The runner-built alert: no excerpt.
    expect(t.alerts.raised).toEqual([expect.objectContaining({ excerptRedacted: '' })]);
    expect(steps.commits[0]).toMatchObject({ outcome: 'escalated' });
  }, 2_000);

  it('a slow scrub plus a soft hit: preGuard times out, the runner still escalates (safety review)', async () => {
    const t = testDeps({
      overrides: {
        transcripts: { history: () => new Promise(() => undefined), append: () => Promise.resolve() },
        // The raw-text and fallback dep stays hard-only; the soft check is the runner's own.
        distressCheck: hasDistressKeyword,
      },
    });
    const steps = realDistress({
      scrub: async (env) => {
        await env.deps.clock.sleep((STEP_SPEC.preGuard.timeoutMs ?? 0) - 5);
        return { ...(env.input.text === undefined ? {} : { text: env.input.text }), guards: [] };
      },
    });
    const { events, result } = await driveTurn(
      runTurn(at('i feel so hopeless'), { deps: t.deps, steps }),
      t.clock,
    );
    expect(events[0]).toEqual({ type: 'safety', level: 'alert' });
    expect(result.trace?.steps.find((s) => s.name === 'preGuard')?.outcome).toBe('failed');
    expect(steps.commits[0]).toMatchObject({ outcome: 'escalated' });
  }, 2_000);

  it('a soft hit never escalates through the raw-text check alone (it stays hard-only)', async () => {
    const t = deps({ stream: [scriptedStreamText], generateObject: [{ value: { distress: false } }] });
    const { events } = await driveTurn(
      runTurn(at('i feel so hopeless'), { deps: t.deps, steps: realDistress() }),
      t.clock,
    );
    expect(events.some((e) => e.type === 'safety')).toBe(false);
  }, 2_000);

  it('soft keyword + classifier false → a normal reply (no alert)', async () => {
    const t = deps({ stream: [scriptedStreamText], generateObject: [{ value: { distress: false } }] });
    const { events } = await driveTurn(
      runTurn(at('this bug is hopeless'), { deps: t.deps, steps: realDistress() }),
      t.clock,
    );
    expect(events.some((e) => e.type === 'safety')).toBe(false);
    expect(events.at(-1)?.type).toBe('done');
    expect(t.alerts.raised).toEqual([]);
  }, 2_000);

  it('no keyword + classifier down → blocked (fail closed), never replied; the turn is saved', async () => {
    const t = deps({ stream: [scriptedStreamText] });
    const steps = realDistress();
    const { events } = await driveTurn(
      runTurn(at('how do i reverse a list'), { deps: t.deps, steps }),
      t.clock,
    );
    expect(events).toEqual([{ type: 'error', code: 'guard_blocked', retryable: true }]);
    expect(steps.commits[0]).toMatchObject({ outcome: 'blocked' });
    expect(t.alerts.raised).toEqual([]);
  }, 2_000);
});
