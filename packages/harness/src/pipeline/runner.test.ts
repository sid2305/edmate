import {
  type Message,
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
  demoLearnerProfile,
  demoPedagogyDecision,
  demoTurnInput,
  usageMain,
  usageSmall,
} from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { driveEvents, driveTurn } from '../testing/driveTurn.js';
import { memoryRetrieval, OUT_OF_SCOPE_TEXT, retrievalWorld } from '../testing/memoryRetrieval.js';
import { testDeps, testSteps } from '../testing/testSteps.js';
import { InvalidEventError, StepNotImplementedError } from './errors.js';
import { runTurn } from './runner.js';
import { STEP_NAMES } from './spec.js';
import { buildContext } from './steps/buildContext.js';
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
        return Promise.resolve({ draft: 'ok', usage: [] });
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
        return Promise.resolve({ draft: 'x', usage: [] });
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
          return { draft: 'late', usage: [] };
        }
        emit({ type: 'token', text: 'retry' });
        late?.();
        return { draft: 'retry', usage: [] };
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
  it('every stub throws StepNotImplementedError (admit, entitle: 3.2; buildContext: 3.4)', async () => {
    const t = testDeps();
    const env = {
      input: demoTurnInput,
      deps: t.deps,
      cancel: { cancelled: false, onCancel: () => undefined },
      turnId: 'turn_x',
    };
    const anyArg = {} as never;
    const calls: (() => unknown)[] = [
      () => defaultSteps.scrub(env, anyArg),
      () => defaultSteps.preGuard(env, anyArg),
      () => defaultSteps.route.run(env, anyArg),
      () => defaultSteps.escalate(env, anyArg, undefined),
      () => defaultSteps.decide.run(env, anyArg),
      () => defaultSteps.generate(env, anyArg, () => undefined),
      () => defaultSteps.postGuard(env, anyArg),
      () => defaultSteps.meter(env, anyArg),
      () => defaultSteps.commit(env, anyArg),
    ];
    for (const call of calls) await expect(call()).rejects.toBeInstanceOf(StepNotImplementedError);
    expect(() => defaultSteps.decide.fallback(anyArg)).toThrow(StepNotImplementedError);
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

  it('fails closed: past admit and entitle, the stub scrub blocks the turn', async () => {
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
    expect(t.portCalls).toEqual([]);
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
        run: (_env, ctx) => {
          seen.push(ctx);
          return Promise.resolve(demoPedagogyDecision);
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
