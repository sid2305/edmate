// Task 3.7 runner behaviour: the turn gateways and billing, usage priced as it streams (kept for
// failed attempts), `replace ''` before an error, cancellation, the TeacherQuestion before `done`,
// and logging every background failure (lead answer Q7). Real generate unless a test says not.
import type {
  ModelChunk,
  PedagogyDecision,
  TeacherQuestionStore,
  TurnEvent,
  TurnInput,
} from '@edmate/contracts';
import {
  demoAgentConfig,
  demoChunk,
  demoEntitlementPreview,
  demoLocalePack,
  demoPackageFree,
  demoStyleCard,
  demoTurnInput,
  modelPolicyFull,
  teacherQuestionOpen,
  turnInputHint,
  usageMain,
  usageSmall,
} from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { driveTurn } from '../testing/driveTurn.js';
import {
  memorySessionStateStore,
  memoryTeacherQuestionStore,
  memoryTranscriptStore,
  memoryTurnLog,
} from '../testing/memoryPorts.js';
import { ScriptedGateway, type StreamStep } from '../testing/scriptedGateway.js';
import { spyGateway } from '../testing/spyGateway.js';
import { type StepOverrides, testDecideResult, testDeps, testSteps } from '../testing/testSteps.js';
import { virtualClock } from '../testing/virtualClock.js';
import { BACKGROUND_LOG_MESSAGE_MAX } from './backgroundLog.js';
import { cancelSource } from './clock.js';
import { HarnessError } from './errors.js';
import { runTurn } from './runner.js';
import { passThroughGate } from './generate/streamGate.js';
import { defaultSteps } from './steps/index.js';
import { FIXTURE_PROMPT_PACK_VERSION } from '../testing/promptPackFixtures.js';
import type { PipelineDeps, Steps } from './types.js';

const say = (text: string) => ({ type: 'text', text }) satisfies ModelChunk;
const used = { type: 'usage', usage: usageMain } satisfies ModelChunk;
const wait = (ms: number) => ({ type: 'delay', ms }) satisfies StreamStep;
const fail = { type: 'error', code: 'provider_error' } satisfies StreamStep;

/**
 * testDeps with the spy on a scripted gateway; the real generate step. These tests are about the
 * runner, so text passes straight through (the sentence gate has its own tests, 4.5).
 */
function world(
  streams: StreamStep[][],
  o: {
    steps?: StepOverrides;
    overrides?: Partial<PipelineDeps>;
    metered?: boolean;
  } = {},
) {
  const clock = virtualClock();
  const spy = spyGateway(
    new ScriptedGateway({ stream: streams.map((steps) => ({ steps })) }, clock),
    o.metered === undefined ? {} : { metered: o.metered },
  );
  const t = testDeps({
    clock,
    overrides: {
      gatewayFor: (s) => spy.gatewayFor(s),
      streamGate: passThroughGate,
      ...o.overrides,
    },
  });
  const steps = testSteps({ entitle: fixtureEntitle, generate: defaultSteps.generate, ...o.steps });
  return { t, spy, steps, clock };
}

/** The happy entitle, pinned to the fixture prompt-pack set the real generate resolves. */
const fixtureEntitle: Steps['entitle'] = async (env) => {
  const e = await testSteps().entitle(env);
  return { ...e, agent: { ...e.agent, promptPackVersion: FIXTURE_PROMPT_PACK_VERSION } };
};

const started = (log: { step: string; phase: string }[], step: string) =>
  log.filter((l) => l.step === step && l.phase === 'start').length;
const genOutcome = (r: { trace: { steps: { name: string; outcome: string }[] } | null }) =>
  r.trace?.steps.find((s) => s.name === 'generate')?.outcome;

describe('metering', () => {
  it('a primary attempt that streams usage and then fails keeps its usage in the trace and done', async () => {
    const w = world([
      [say('Partial. '), used, fail],
      [say('Retry.'), used],
    ]);
    const { events, result } = await driveTurn(
      runTurn(demoTurnInput, { deps: w.t.deps, steps: w.steps }),
      w.clock,
    );
    // Shown text ends a sentence: since 4.6 a fragment is shown only once its sentence passed
    // the locked check.
    expect(events).toEqual([
      { type: 'hint_rung', rung: 1 },
      { type: 'token', text: 'Partial. ' },
      { type: 'replace', text: '' },
      { type: 'hint_rung', rung: 1 },
      { type: 'token', text: 'Retry.' },
      { type: 'done', messageId: 'message_1', usage: [usageMain, usageMain] },
    ]);
    expect(result.trace?.usage).toEqual([usageMain, usageMain]);
    expect(genOutcome(result)).toBe('fallback');
    // The test gateway is unmetered, so the meter step gets both.
    expect(w.t.usage.rows.map((r) => r.usage)).toEqual([usageMain, usageMain]);
  });

  it('a timed-out attempt keeps the usage it streamed before the timeout', async () => {
    const w = world([
      [say('Slow '), used, wait(20_000), say('never')],
      [say('Fast.'), used],
    ]);
    const { events, result } = await driveTurn(
      runTurn(demoTurnInput, { deps: w.t.deps, steps: w.steps }),
      w.clock,
    );
    expect(events.at(-1)).toEqual({
      type: 'done',
      messageId: 'message_1',
      usage: [usageMain, usageMain],
    });
    expect(w.spy.returns).toBe(1);
    expect(genOutcome(result)).toBe('fallback');
  }, 10_000);

  it('the turn gateway is billed from the entitlement (source teacher_preview), never the input', async () => {
    const input: TurnInput = { ...demoTurnInput, studentId: demoEntitlementPreview.studentId };
    const w = world([[say('Hi.'), used]], {
      steps: {
        entitle: () =>
          Promise.resolve({
            entitlement: demoEntitlementPreview,
            agent: { ...demoAgentConfig, promptPackVersion: FIXTURE_PROMPT_PACK_VERSION },
            pkg: demoPackageFree,
            locale: demoLocalePack,
            styleCard: demoStyleCard,
          }),
        buildContext: async (env, e) => ({
          ...(await testSteps().buildContext(env, e)),
          retrieved: [demoChunk],
        }),
      },
    });
    const { events } = await driveTurn(runTurn(input, { deps: w.t.deps, steps: w.steps }), w.clock);
    expect(events.at(-1)?.type).toBe('done');
    const billing = {
      teacherId: demoEntitlementPreview.teacherId,
      packageId: demoEntitlementPreview.packageId,
      studentId: demoEntitlementPreview.studentId,
      turnId: 'turn_1',
      source: 'teacher_preview',
    };
    expect(w.spy.built.length).toBeGreaterThanOrEqual(2);
    for (const b of w.spy.built) expect(b.billing).toEqual(billing);
    // The composition root's source ('subscription' in testDeps) is not what is billed.
    expect(w.t.deps.entitlementSource).toBe('subscription');
  });

  it('guards get the full policy; the primary has no fallback; the retry runs on the fallback model', async () => {
    const w = world([[fail], [say('ok'), used]], {
      steps: {
        entitle: async (env) => ({
          ...(await fixtureEntitle(env)),
          agent: {
            ...demoAgentConfig,
            promptPackVersion: FIXTURE_PROMPT_PACK_VERSION,
            modelPolicy: modelPolicyFull,
          },
        }),
      },
    });
    await driveTurn(runTurn(demoTurnInput, { deps: w.t.deps, steps: w.steps }), w.clock);
    expect(w.spy.built.map((b) => b.policy)).toEqual([
      modelPolicyFull,
      { tiers: modelPolicyFull.tiers },
      { tiers: { ...modelPolicyFull.tiers, main: modelPolicyFull.fallback } },
    ]);
  });

  it('with no fallback configured the retry uses the main model again', async () => {
    const w = world([[fail], [say('ok'), used]]);
    await driveTurn(runTurn(demoTurnInput, { deps: w.t.deps, steps: w.steps }), w.clock);
    const tiers = demoAgentConfig.modelPolicy.tiers;
    expect(w.spy.built.map((b) => b.policy)).toEqual([{ tiers }, { tiers }, { tiers }]);
  });

  it('a metered turn gateway keeps its usage out of meter (no double billing); step usage is still metered', async () => {
    const w = world([[say('Hi.'), used]], {
      metered: true,
      steps: {
        route: {
          run: () => Promise.resolve({ intent: 'on_task', attempt: 'none', usage: [usageSmall] }),
        },
      },
    });
    const { events } = await driveTurn(
      runTurn(demoTurnInput, { deps: w.t.deps, steps: w.steps }),
      w.clock,
    );
    expect(events.at(-1)).toMatchObject({ type: 'done', usage: [usageSmall, usageMain] });
    expect(w.t.usage.rows.map((r) => r.usage)).toEqual([usageSmall]);
  });

  it('usage is priced as it arrives, so done.usage never reads as free', async () => {
    const w = world([[say('Hi.'), used]], { overrides: { priceUsage: () => 1_234 } });
    const { events } = await driveTurn(
      runTurn(demoTurnInput, { deps: w.t.deps, steps: w.steps }),
      w.clock,
    );
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      usage: [{ ...usageMain, costMicroUsd: 1_234 }],
    });
  });

  it('a gatewayFor that throws: every model call is refused, the turn fails closed and the error is reported', async () => {
    const w = world([[say('never')]], {
      overrides: {
        gatewayFor: () => {
          throw new Error('router config broken');
        },
      },
    });
    const { events, result } = await driveTurn(
      runTurn(demoTurnInput, { deps: w.t.deps, steps: w.steps }),
      w.clock,
    );
    expect(events).toEqual([{ type: 'error', code: 'provider_error', retryable: true }]);
    // The guards' gateway failure, then each generate attempt (by name only).
    expect(result.background.map((b) => [b.task, String(b.error)])).toEqual([
      ['runner', 'Error: router config broken'],
      ['generate', 'GenerateAttemptFailed: generate primary attempt failed: error (Error)'],
      ['generate', 'GenerateAttemptFailed: generate fallback attempt failed: error (Error)'],
    ]);
    expect(JSON.stringify(result.background.map((b) => String(b.error)).slice(1))).not.toContain(
      'router config broken',
    );
    expect(w.spy.requests).toEqual([]);
  });

  it('a gatewayFor that returns something unusable fails closed the same way', async () => {
    const w = world([[say('never')]], {
      overrides: { gatewayFor: () => ({ gateway: {}, metered: false }) as never },
    });
    const { events } = await driveTurn(
      runTurn(demoTurnInput, { deps: w.t.deps, steps: w.steps }),
      w.clock,
    );
    expect(events).toEqual([{ type: 'error', code: 'provider_error', retryable: true }]);
  });

  it('the guards see the refusing gateway when the turn gateway cannot be built', async () => {
    let refused: unknown;
    const w = world([], {
      overrides: {
        gatewayFor: () => {
          throw new Error('no router');
        },
      },
      steps: {
        preGuard: async (env) => {
          refused = await env.gateway.generateObject({} as never, {} as never).catch((e) => e);
          return { result: 'ok', guards: [], usage: [] };
        },
      },
    });
    await driveTurn(runTurn(demoTurnInput, { deps: w.t.deps, steps: w.steps }), w.clock);
    expect(String(refused)).toMatch(/no model call/);
  });

  it('an invalid ceiling fails closed: no model call, turn_cost_exceeded, and it is reported', async () => {
    const w = world([[say('never'), used]], { overrides: { maxTurnCostMicroUsd: -5 } });
    const { events, result } = await driveTurn(
      runTurn(demoTurnInput, { deps: w.t.deps, steps: w.steps }),
      w.clock,
    );
    expect(events).toEqual([{ type: 'error', code: 'turn_cost_exceeded', retryable: false }]);
    expect(w.spy.requests).toEqual([]);
    expect(result.background.map((b) => String(b.error))).toEqual([
      'Error: maxTurnCostMicroUsd is invalid; every model call is refused',
      'GenerateAttemptFailed: generate primary attempt failed: error (TurnAbort)',
    ]);
  });

  it('unpriced usage aborts the turn with turn_cost_exceeded (Q2)', async () => {
    const w = world([[say('Hi. '), used, say('never')]], {
      overrides: { priceUsage: () => undefined },
    });
    const { events } = await driveTurn(
      runTurn(demoTurnInput, { deps: w.t.deps, steps: w.steps }),
      w.clock,
    );
    expect(events.slice(-2)).toEqual([
      { type: 'replace', text: '' },
      { type: 'error', code: 'turn_cost_exceeded', retryable: false },
    ]);
    expect(started(w.steps.log, 'generate')).toBe(1);
  });

  it('admit and entitle get a gateway that refuses calls and a recorder that refuses usage', async () => {
    const seen: string[] = [];
    const w = world([[say('Hi.'), used]], {
      steps: {
        admit: async (env) => {
          await env.gateway.embed(['x']).catch((e: unknown) => seen.push(String(e)));
          try {
            env.usage.record(usageMain);
          } catch (e) {
            seen.push(String(e));
          }
        },
      },
    });
    await driveTurn(runTurn(demoTurnInput, { deps: w.t.deps, steps: w.steps }), w.clock);
    expect(seen).toEqual([
      'Error: no model call: before entitle',
      'Error: no model usage before entitle',
    ]);
  });
});

describe("replace '' before an error", () => {
  it('both attempts stream then fail: each attempt is cleared, then the error', async () => {
    const w = world([
      [say('One. '), fail],
      [say('Two. '), fail],
    ]);
    const { events } = await driveTurn(
      runTurn(demoTurnInput, { deps: w.t.deps, steps: w.steps }),
      w.clock,
    );
    const steps = w.steps;
    expect(events.filter((e) => e.type !== 'hint_rung')).toEqual([
      { type: 'token', text: 'One. ' },
      { type: 'replace', text: '' },
      { type: 'token', text: 'Two. ' },
      { type: 'replace', text: '' },
      { type: 'error', code: 'provider_error', retryable: true },
    ]);
    expect(started(steps.log, 'postGuard')).toBe(0);
  });

  it('no replace when nothing was shown', async () => {
    const w = world([[fail], [fail]]);
    const { events } = await driveTurn(
      runTurn(demoTurnInput, { deps: w.t.deps, steps: w.steps }),
      w.clock,
    );
    expect(events.filter((e) => e.type !== 'hint_rung')).toEqual([
      { type: 'error', code: 'provider_error', retryable: true },
    ]);
  });
});

describe('client disconnect', () => {
  async function detachAfterFirstToken(w: ReturnType<typeof world>) {
    const run = runTurn(demoTurnInput, { deps: w.t.deps, steps: w.steps });
    const seen: TurnEvent[] = [];
    const consume = (async () => {
      for await (const e of run.events) {
        seen.push(e);
        if (e.type === 'token') break;
      }
    })();
    const result = await w.clock.drive(Promise.all([consume, run.finished]).then(([, r]) => r));
    return { seen, result };
  }

  it('the consumer returns mid-stream: generate stops, the stream is closed, no retry, no postGuard', async () => {
    const w = world([
      [say('First. '), wait(2_000), say('second'), used],
      [say('retry'), used],
    ]);
    const { seen, result } = await detachAfterFirstToken(w);
    expect(seen.map((e) => e.type)).toEqual(['hint_rung', 'token']);
    expect(w.spy.returns).toBe(1);
    expect(w.spy.requests).toHaveLength(1);
    expect(started(w.steps.log, 'generate')).toBe(1);
    expect(started(w.steps.log, 'postGuard')).toBe(0);
    expect(w.steps.commits[0]).toMatchObject({
      outcome: 'error',
      input: { text: demoTurnInput.text },
    });
    expect(w.steps.commits[0]?.replyText).toBeUndefined();
    expect(genOutcome(result)).toBe('failed');
    expect(result.trace).not.toBeNull();
  }, 10_000);

  it('generate stops at once: the turn finishes before the stream would have', async () => {
    const w = world([[say('First. '), wait(10_000), say('second'), used]]);
    const t0 = w.clock.now();
    const { result } = await detachAfterFirstToken(w);
    expect(result.trace?.steps.find((s) => s.name === 'generate')?.ms).toBeLessThan(10_000);
    expect(w.clock.now() - t0).toBeLessThan(10_000);
  }, 10_000);

  it('RunTurnOptions.cancel during generate works the same way', async () => {
    const w = world([
      [say('First. '), wait(2_000), say('second'), used],
      [say('retry'), used],
    ]);
    const c = cancelSource();
    const steps = testSteps({
      entitle: fixtureEntitle,
      generate: (env, x, emit) =>
        defaultSteps.generate(env, x, (e) => {
          emit(e);
          if (e.type === 'token') c.cancel();
        }),
    });
    const { events, result } = await driveTurn(
      runTurn(demoTurnInput, { deps: w.t.deps, steps, cancel: c.token }),
      w.clock,
    );
    expect(events.map((e) => e.type)).toEqual(['hint_rung', 'token', 'replace', 'error']);
    expect(events.at(-1)).toEqual({ type: 'error', code: 'provider_error', retryable: true });
    expect(w.spy.returns).toBe(1);
    expect(w.spy.requests).toHaveLength(1);
    expect(started(steps.log, 'postGuard')).toBe(0);
    expect(steps.commits[0]?.outcome).toBe('error');
    expect(genOutcome(result)).toBe('failed');
  }, 10_000);

  it('a turn cancelled before generate makes no model call', async () => {
    const w = world([[say('never'), used]]);
    const c = cancelSource();
    const steps = testSteps({
      entitle: fixtureEntitle,
      generate: defaultSteps.generate,
      decide: {
        run: () => {
          c.cancel();
          return Promise.resolve(testDecideResult(hintDecision()));
        },
      },
    });
    const { events, result } = await driveTurn(
      runTurn(demoTurnInput, { deps: w.t.deps, steps, cancel: c.token }),
      w.clock,
    );
    expect(events).toEqual([{ type: 'error', code: 'provider_error', retryable: true }]);
    expect(w.spy.requests).toEqual([]);
    expect(started(steps.log, 'generate')).toBe(0);
    expect(genOutcome(result)).toBe('failed');
    expect(steps.commits[0]?.outcome).toBe('error');
  });

  it('a cancel fired before the turn starts also makes no model call', async () => {
    const w = world([[say('never'), used]]);
    const c = cancelSource();
    c.cancel();
    const { events } = await driveTurn(
      runTurn(demoTurnInput, { deps: w.t.deps, steps: w.steps, cancel: c.token }),
      w.clock,
    );
    expect(events.at(-1)?.type).toBe('error');
    expect(w.spy.requests).toEqual([]);
  });
});

const askTeacherDecision: PedagogyDecision = {
  move: 'ask_teacher',
  rung: 0,
  mustNotReveal: [],
  systemPrompt: 'Tell the student the question has gone to the teacher.',
  tools: [],
  maxOutputTokens: 120,
};

function hintDecision(): PedagogyDecision {
  return { ...askTeacherDecision, move: 'hint', rung: 1 };
}

describe('teacher_question (ask_teacher, lead answer Q3)', () => {
  function askWorld(store: TeacherQuestionStore, input: TurnInput = demoTurnInput) {
    const w = world([[say('I sent that to your teacher.'), used]], {
      overrides: { teacherQuestions: store },
      steps: {
        scrub: () => Promise.resolve({ text: 'How do I add [number] and 1/3?', guards: [] }),
        decide: { run: () => Promise.resolve(testDecideResult(askTeacherDecision)) },
      },
    });
    return {
      ...w,
      run: () => driveTurn(runTurn(input, { deps: w.t.deps, steps: w.steps }), w.clock),
    };
  }

  it('opens the question with the scrubbed text before done; the event and commit carry its id', async () => {
    const store = memoryTeacherQuestionStore({ similar: [teacherQuestionOpen] });
    const w = askWorld(store);
    const { events, result } = await w.run();
    expect(events.slice(-2)).toEqual([
      { type: 'teacher_question', questionId: 'tq_mem_1' },
      { type: 'done', messageId: 'message_1', usage: [usageMain] },
    ]);
    expect(store.searched).toEqual([
      { teacherId: 'tch_test_01', text: 'How do I add [number] and 1/3?' },
    ]);
    expect(store.opened).toEqual([
      {
        teacherId: 'tch_test_01',
        agentId: 'agt_test_01',
        studentId: 'stu_test_01',
        text: 'How do I add [number] and 1/3?',
        similarIds: [teacherQuestionOpen.id],
      },
    ]);
    expect(JSON.stringify(store.opened)).not.toContain(demoTurnInput.text);
    expect(w.steps.commits[0]?.teacherQuestionId).toBe('tq_mem_1');
    expect(result.background).toEqual([]);
  });

  it('teacher_question comes before postGuard’s replace', async () => {
    const store = memoryTeacherQuestionStore();
    const w = askWorld(store);
    w.steps.postGuard = () =>
      Promise.resolve({ result: 'replace', text: 'rewritten', guards: [], usage: [] });
    const { events } = await w.run();
    expect(events.slice(-4)).toEqual([
      { type: 'teacher_question', questionId: 'tq_mem_1' },
      { type: 'replace', text: '' },
      { type: 'replace', text: 'rewritten' },
      { type: 'done', messageId: 'message_1', usage: expect.anything() as unknown },
    ]);
  });

  it('a failing store: no event, done still sent, the failure is reported, no id on commit', async () => {
    const w = askWorld(memoryTeacherQuestionStore({ fail: true }));
    const { events, result } = await w.run();
    expect(events.map((e) => e.type)).not.toContain('teacher_question');
    expect(events.at(-1)?.type).toBe('done');
    expect(result.background.map((b) => b.task)).toEqual(['teacher_question']);
    expect(w.steps.commits[0]?.teacherQuestionId).toBeUndefined();
  });

  it('a store that hangs: given up after 500 ms; done still sent', async () => {
    const hanging: TeacherQuestionStore = {
      findSimilar: () => Promise.resolve([]),
      open: () => new Promise(() => undefined),
    };
    const w = askWorld(hanging);
    const { events, result, timed } = await w.run();
    expect(events.at(-1)?.type).toBe('done');
    expect(result.background.map((b) => String(b.error))).toEqual([
      'Error: TeacherQuestionStore timed out',
    ]);
    expect((timed.at(-1)?.at ?? 0) - (timed.at(-2)?.at ?? 0)).toBe(500);
  });

  it("findSimilar returning another teacher's question fails closed", async () => {
    const store = memoryTeacherQuestionStore({
      similar: [{ ...teacherQuestionOpen, teacherId: 'tch_other' }],
    });
    const w = askWorld(store);
    const { events, result } = await w.run();
    expect(events.map((e) => e.type)).not.toContain('teacher_question');
    expect(store.opened).toEqual([]);
    expect(result.background.map((b) => b.task)).toEqual(['teacher_question']);
  });

  it('a store that opens a question for someone else fails closed', async () => {
    const lying: TeacherQuestionStore = {
      findSimilar: () => Promise.resolve([]),
      open: () => Promise.resolve({ ...teacherQuestionOpen, studentId: 'stu_other' }),
    };
    const w = askWorld(lying);
    const { events, result } = await w.run();
    expect(events.map((e) => e.type)).not.toContain('teacher_question');
    expect(result.background.map((b) => b.task)).toEqual(['teacher_question']);
  });

  it('a turn with no text opens nothing', async () => {
    const store = memoryTeacherQuestionStore();
    const w = askWorld(store, turnInputHint);
    w.steps.scrub = () => Promise.resolve({ guards: [] });
    const { events, result } = await w.run();
    expect(events.at(-1)?.type).toBe('done');
    expect(store.opened).toEqual([]);
    expect(store.searched).toEqual([]);
    expect(result.background).toEqual([]);
  });

  it('other moves never touch the store', async () => {
    const w = world([[say('Hi.'), used]]);
    const { result } = await driveTurn(
      runTurn(demoTurnInput, { deps: w.t.deps, steps: w.steps }),
      w.clock,
    );
    expect(w.t.portCalls).toEqual([]);
    expect(result.background).toEqual([]);
  });
});

describe('background failures are logged (lead answer Q7)', () => {
  it('logs each failure with the task, the ids and the error name; a foreign error gets no message', async () => {
    const log = memoryTurnLog();
    const w = world([[say('Hi.'), used]], {
      overrides: {
        log,
        transcripts: memoryTranscriptStore({ fail: true }),
        sessionState: memorySessionStateStore(),
      },
      steps: { commit: defaultSteps.commit },
    });
    const { result } = await driveTurn(
      runTurn(demoTurnInput, { deps: w.t.deps, steps: w.steps }),
      w.clock,
    );
    expect(result.background.map((b) => b.task)).toEqual(['commit']);
    expect(log.entries).toEqual([
      {
        task: 'commit',
        turnId: 'turn_1',
        sessionId: 'ses_test_01',
        agentId: 'agt_test_01',
        studentId: 'stu_test_01',
        errorName: 'Error',
        errorMessage: '',
      },
    ]);
    const json = JSON.stringify(log.entries);
    expect(json).not.toContain(demoTurnInput.text);
    expect(json).not.toContain('denominators');
  });

  it('logs before finished resolves, once per failure, in order', async () => {
    const log = memoryTurnLog();
    const w = world([[say('Hi.'), used]], {
      overrides: { log },
      steps: {
        meter: () => Promise.reject(new TypeError('meter down')),
        commit: () => Promise.reject(new Error('commit down')),
      },
    });
    const { result } = await driveTurn(
      runTurn(demoTurnInput, { deps: w.t.deps, steps: w.steps }),
      w.clock,
    );
    expect(log.entries.map((e) => [e.task, e.errorName])).toEqual(
      result.background.map((b) => [b.task, (b.error as Error).name]),
    );
    expect(log.entries).toHaveLength(2);
  });

  it('a runner bug before the turn id is drawn is logged without a turn id', async () => {
    const log = memoryTurnLog();
    const w = world([], {
      overrides: {
        log,
        ids: {
          next: () => {
            throw new Error('id source down');
          },
        },
      },
    });
    await driveTurn(runTurn(demoTurnInput, { deps: w.t.deps, steps: w.steps }), w.clock);
    expect(log.entries).toEqual([
      {
        task: 'runner',
        sessionId: 'ses_test_01',
        agentId: 'agt_test_01',
        studentId: 'stu_test_01',
        errorName: 'Error',
        errorMessage: '',
      },
    ]);
  });

  it('ids that are not valid ids (could be text) are logged as "invalid"; long messages are cut', async () => {
    const log = memoryTurnLog();
    const w = world([], {
      overrides: { log },
      steps: {
        admit: () => Promise.resolve(),
        commit: () => Promise.reject(new HarnessError('x'.repeat(1_000))),
      },
    });
    const input = { ...demoTurnInput, sessionId: 'my phone is 555 0100' };
    await driveTurn(runTurn(input, { deps: w.t.deps, steps: w.steps }), w.clock);
    expect(log.entries[0]?.sessionId).toBe('invalid');
    expect(log.entries.find((e) => e.task === 'commit')?.errorMessage).toHaveLength(
      BACKGROUND_LOG_MESSAGE_MAX,
    );
  });

  it('a non-Error throw is logged by type, with no message', async () => {
    const log = memoryTurnLog();
    const w = world([[say('Hi.'), used]], {
      overrides: { log },
      steps: { commit: () => Promise.reject('the student said something') as Promise<void> },
    });
    await driveTurn(runTurn(demoTurnInput, { deps: w.t.deps, steps: w.steps }), w.clock);
    expect(log.entries[0]).toMatchObject({ errorName: 'string', errorMessage: '' });
  });

  it('a throwing logger never breaks finished', async () => {
    const w = world([[say('Hi.'), used]], {
      overrides: { log: memoryTurnLog({ fail: true }) },
      steps: { commit: () => Promise.reject(new Error('down')) },
    });
    const { result } = await driveTurn(
      runTurn(demoTurnInput, { deps: w.t.deps, steps: w.steps }),
      w.clock,
    );
    expect(result.background.map((b) => b.task)).toEqual(['commit']);
  });

  it('a clean turn logs nothing', async () => {
    const log = memoryTurnLog();
    const w = world([[say('Hi.'), used]], { overrides: { log } });
    await driveTurn(runTurn(demoTurnInput, { deps: w.t.deps, steps: w.steps }), w.clock);
    expect(log.entries).toEqual([]);
  });

  it("a harness error's message is logged (it holds no turn text)", async () => {
    const log = memoryTurnLog();
    const w = world(
      [
        [say('One '), fail],
        [say('ok'), used],
      ],
      { overrides: { log } },
    );
    await driveTurn(runTurn(demoTurnInput, { deps: w.t.deps, steps: w.steps }), w.clock);
    expect(log.entries).toEqual([
      expect.objectContaining({
        task: 'generate',
        errorName: 'GenerateAttemptFailed',
        errorMessage: 'generate primary attempt failed: error (ScriptedProviderError)',
      }),
    ]);
  });
});

describe('fix round: generate failures, unpriced usage, runner-bug clearing, close settling', () => {
  it('a failed primary is reported by name only, then the retry succeeds', async () => {
    const w = world([
      [say('One '), fail],
      [say('ok'), used],
    ]);
    const { events, result } = await driveTurn(
      runTurn(demoTurnInput, { deps: w.t.deps, steps: w.steps }),
      w.clock,
    );
    expect(events.at(-1)?.type).toBe('done');
    expect(result.background.map((b) => [b.task, String(b.error)])).toEqual([
      [
        'generate',
        'GenerateAttemptFailed: generate primary attempt failed: error (ScriptedProviderError)',
      ],
    ]);
  });

  it('both attempts failing reports both; a timeout and an invalid result say so', async () => {
    let n = 0;
    const w = world([], {
      steps: {
        generate: async (env) => {
          if (++n === 1) {
            await env.deps.clock.sleep(20_000);
            return { draft: 'late' };
          }
          return { draft: 5 } as unknown as { draft: string };
        },
      },
    });
    const { events, result } = await driveTurn(
      runTurn(demoTurnInput, { deps: w.t.deps, steps: w.steps }),
      w.clock,
    );
    expect(events).toEqual([{ type: 'error', code: 'provider_error', retryable: true }]);
    expect(result.background.map((b) => String(b.error))).toEqual([
      'GenerateAttemptFailed: generate primary attempt failed: timeout',
      'GenerateAttemptFailed: generate fallback attempt failed: invalid_result',
    ]);
  }, 10_000);

  it('an invalid emitted event is reported as invalid_event', async () => {
    let n = 0;
    const w = world([], {
      steps: {
        generate: (_env, _x, emit) => {
          if (++n === 1) {
            try {
              emit({ type: 'done', messageId: 'm_x', usage: [] });
            } catch {
              // the runner rejects it
            }
          }
          return Promise.resolve({ draft: 'ok' });
        },
      },
    });
    const { result } = await driveTurn(
      runTurn(demoTurnInput, { deps: w.t.deps, steps: w.steps }),
      w.clock,
    );
    expect(result.background.map((b) => String(b.error))).toEqual([
      'GenerateAttemptFailed: generate primary attempt failed: invalid_event',
    ]);
  });

  it('unpriced usage stays in the trace, is never metered as free, and is reported as UnpricedUsage', async () => {
    const w = world([[say('Hi '), used]], { overrides: { priceUsage: () => undefined } });
    const { result } = await driveTurn(
      runTurn(demoTurnInput, { deps: w.t.deps, steps: w.steps }),
      w.clock,
    );
    expect(result.trace?.usage).toEqual([usageMain]);
    expect(w.t.usage.rows).toEqual([]);
    expect(result.background.map((b) => String(b.error))).toContain(
      `UnpricedUsage: usage for an unpriced model: ${usageMain.model}`,
    );
  });

  it("a runner bug after text was shown clears it with replace '' before the error", async () => {
    const vc = virtualClock();
    let boom = false;
    const clock = {
      now: () => {
        if (boom) throw new Error('clock down');
        return vc.now();
      },
      sleep: (ms: number, c?: Parameters<typeof vc.sleep>[1]) => vc.sleep(ms, c),
    };
    const t = testDeps({ clock: vc, overrides: { clock } });
    const steps = testSteps({
      generate: (_env, _x, emit) => {
        emit({ type: 'token', text: 'Partial ' });
        boom = true;
        return Promise.resolve({ draft: 'Partial ' });
      },
    });
    const run = runTurn(demoTurnInput, { deps: t.deps, steps });
    const events: TurnEvent[] = [];
    await vc.drive(
      (async () => {
        for await (const e of run.events) events.push(e);
      })(),
    );
    expect(events).toEqual([
      { type: 'token', text: 'Partial ' },
      { type: 'replace', text: '' },
      { type: 'error', code: 'provider_error', retryable: true },
    ]);
  });

  it("a skill event shown before a retry is cleared by the retry's replace ''", async () => {
    let n = 0;
    const w = world([], {
      steps: {
        generate: (_env, _x, emit) => {
          if (++n === 1) {
            emit({ type: 'skill', skill: 'coach', payload: { item: 1 } });
            return Promise.reject(new Error('provider down'));
          }
          emit({ type: 'token', text: 'ok' });
          return Promise.resolve({ draft: 'ok' });
        },
      },
    });
    const { events } = await driveTurn(
      runTurn(demoTurnInput, { deps: w.t.deps, steps: w.steps }),
      w.clock,
    );
    expect(events.map((e) => e.type)).toEqual(['skill', 'replace', 'token', 'done']);
  });

  function closingGateway(
    clock: { sleep(ms: number): Promise<void> },
    closeMs: number,
    fails: boolean,
  ) {
    return {
      stream: () => ({
        [Symbol.asyncIterator]: () => {
          let first = true;
          return {
            next: () =>
              first
                ? ((first = false), Promise.resolve({ value: say('First. '), done: false as const }))
                : new Promise<IteratorResult<ModelChunk>>(() => undefined),
            return: async () => {
              await clock.sleep(closeMs);
              if (fails) throw new Error('close failed: SECRET_PROMPT');
              return { value: undefined, done: true as const };
            },
          };
        },
      }),
      generateObject: () => Promise.reject(new Error('unused')),
      embed: () => Promise.reject(new Error('unused')),
    };
  }

  async function cancelOnFirstToken(closeMs: number, fails: boolean) {
    const clock = virtualClock();
    const gw = closingGateway(clock, closeMs, fails);
    const t = testDeps({
      clock,
      overrides: {
        gatewayFor: () => ({ gateway: gw, metered: false }),
        streamGate: passThroughGate,
      },
    });
    const c = cancelSource();
    const steps = testSteps({
      entitle: fixtureEntitle,
      generate: (env, x, emit) =>
        defaultSteps.generate(env, x, (e) => {
          emit(e);
          if (e.type === 'token') c.cancel();
        }),
    });
    return driveTurn(runTurn(demoTurnInput, { deps: t.deps, steps, cancel: c.token }), clock);
  }

  it('a stream close that fails late is in finished.background (name only), not lost', async () => {
    const { result } = await cancelOnFirstToken(300, true);
    const closes = result.background.filter((b) => String(b.error).startsWith('StreamCloseFailed'));
    expect(closes.map((b) => String(b.error))).toEqual([
      'StreamCloseFailed: closing the model stream failed (Error)',
    ]);
    expect(JSON.stringify(result.background.map((b) => String(b.error)))).not.toContain(
      'SECRET_PROMPT',
    );
  });

  it('a stream close that never settles holds finished back at most STREAM_CLOSE_SETTLE_MS', async () => {
    const { result, timed } = await cancelOnFirstToken(60_000, false);
    expect(result.background.map((b) => String(b.error))).toContain(
      'Error: a model stream close did not settle in time',
    );
    expect(timed.length).toBeGreaterThan(0);
  }, 10_000);
});
