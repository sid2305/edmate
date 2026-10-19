// Task 3.7 acceptance: a full turn streams through the scripted gateway with the real admit,
// entitle, buildContext, decide and generate steps (preGuard, route, postGuard, meter and commit
// are test doubles: the guards are 4.x); an over-budget turn aborts with `turn_cost_exceeded`.
import {
  type EntitlementStore,
  type ModelChunk,
  type RetrievalIndex,
  type TurnConfigStore,
  TurnEventSchema,
} from '@edmate/contracts';
import {
  demoAgentConfig,
  demoChunkScored,
  demoEntitlementSubscription,
  demoLearnerProfile,
  demoLocalePack,
  demoPackagePaid,
  demoStyleCard,
  demoTurnInput,
  usageMain,
} from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { driveTurn } from '../testing/driveTurn.js';
import { memoryTranscriptStore } from '../testing/memoryPorts.js';
import { memoryToolRegistry, testTool } from '../testing/memoryToolRegistry.js';
import { FIXTURE_PROMPT_PACK_VERSION } from '../testing/promptPackFixtures.js';
import { ScriptedGateway, type StreamStep } from '../testing/scriptedGateway.js';
import { spyGateway } from '../testing/spyGateway.js';
import { testDeps, testSteps } from '../testing/testSteps.js';
import { virtualClock } from '../testing/virtualClock.js';
import { runTurn } from './runner.js';
import { admit } from './steps/admit.js';
import { buildContext } from './steps/buildContext.js';
import { decide } from './steps/decide.js';
import { entitle } from './steps/entitle.js';
import { generate } from './steps/generate.js';
import type { PipelineDeps } from './types.js';

const ANSWER_KEY = 'ANSWER_KEY_3_7_INTEGRATION';
const PRICE = 2_000;

/** Stuck once on rung 1: this turn climbs to a rung-2 hint (coach). */
const helpState = {
  v: 1,
  rung: 1,
  stuckTurns: 1,
  attemptLogged: false,
  pendingCheck: false,
  answerKey: [ANSWER_KEY],
};

function world(streams: StreamStep[][], overrides: Partial<PipelineDeps> = {}) {
  const clock = virtualClock();
  const spy = spyGateway(
    new ScriptedGateway({ stream: streams.map((steps) => ({ steps })) }, clock),
  );
  const entitlements: EntitlementStore = {
    resolve: (x) =>
      Promise.resolve(
        x.studentId === demoEntitlementSubscription.studentId &&
          x.agentId === demoEntitlementSubscription.agentId &&
          x.source === 'subscription'
          ? { ...demoEntitlementSubscription }
          : null,
      ),
  };
  const turnConfig: TurnConfigStore = {
    load: () =>
      Promise.resolve({
        agent: { ...demoAgentConfig, promptPackVersion: FIXTURE_PROMPT_PACK_VERSION },
        pkg: demoPackagePaid,
        styleCard: demoStyleCard,
        locale: demoLocalePack,
        helpState,
      }),
  };
  const retrieval: RetrievalIndex = {
    search: () => Promise.resolve([{ ...demoChunkScored }]),
    probe: () => Promise.resolve({ hit: false, score: 0 }),
    leakCheck: () => Promise.resolve({ hit: false }),
  };
  const tools = memoryToolRegistry([
    testTool({
      name: 'calculator',
      skill: 'coach',
      description: 'Evaluates an arithmetic expression.',
      input: z.strictObject({ expression: z.string() }),
      output: z.strictObject({ value: z.string() }),
      run: () => Promise.resolve({ value: 'common multiple: 6' }),
      present: (o) => ({ skill: 'coach', payload: { worked: o } }),
    }),
  ]);
  const t = testDeps({
    clock,
    overrides: {
      gatewayFor: (s) => spy.gatewayFor(s),
      priceUsage: () => PRICE,
      entitlements,
      turnConfig,
      retrieval,
      tools,
      profiles: {
        get: () => Promise.resolve(demoLearnerProfile),
        applyEvidence: () => Promise.reject(new Error('unused')),
      },
      transcripts: memoryTranscriptStore(),
      ...overrides,
    },
  });
  const steps = testSteps({ admit, entitle, buildContext, decide, generate });
  return { t, spy, steps, clock, tools };
}

const say = (text: string) => ({ type: 'text', text }) satisfies ModelChunk;
const used = { type: 'usage', usage: usageMain } satisfies ModelChunk;
const priced = { ...usageMain, costMicroUsd: PRICE };

describe('turn integration (3.7 acceptance)', () => {
  it('streams a full turn', async () => {
    const w = world([
      [
        say('Look at the denominators [1]. '),
        { type: 'tool_call', id: 'call_1', name: 'calculator', args: { expression: 'lcm(2,3)' } },
        used,
      ],
      [say('What is a common multiple of 2 and 3?'), used],
    ]);
    const { events, result } = await driveTurn(
      runTurn(demoTurnInput, { deps: w.t.deps, steps: w.steps }),
      w.clock,
    );

    expect(events.map((e) => e.type)).toEqual([
      'hint_rung',
      'token',
      'skill',
      'token',
      'sources',
      'done',
    ]);
    for (const e of events) expect(TurnEventSchema.safeParse(e).success).toBe(true);
    expect(events.filter((e) => e.type === 'done' || e.type === 'error')).toHaveLength(1);
    expect(events[0]).toEqual({ type: 'hint_rung', rung: 2 });
    expect(events[2]).toEqual({
      type: 'skill',
      skill: 'coach',
      payload: { worked: { value: 'common multiple: 6' } },
    });
    expect(events[4]).toEqual({ type: 'sources', items: [demoChunkScored.source] });
    expect(events.at(-1)).toEqual({
      type: 'done',
      messageId: 'message_1',
      usage: [priced, priced],
    });

    // Two calls: the first offers the entitled tool; the second carries the JSON envelopes.
    expect(w.spy.requests).toHaveLength(2);
    expect(w.spy.requests[0]?.tools?.map((x) => x.name)).toEqual(['calculator']);
    expect(w.spy.requests[1]?.messages.at(-1)?.content).toContain('"tool_results"');
    expect(w.tools.runs).toEqual([{ name: 'calculator', input: { expression: 'lcm(2,3)' } }]);
    // Billed to the entitlement.
    for (const b of w.spy.built) {
      expect(b.billing).toEqual({
        teacherId: 'tch_test_01',
        packageId: 'pkg_test_paid',
        studentId: 'stu_test_01',
        turnId: 'turn_1',
        source: 'subscription',
      });
    }

    expect(result.trace?.steps.find((s) => s.name === 'generate')?.outcome).toBe('ok');
    expect(w.steps.commits[0]).toMatchObject({
      outcome: 'replied',
      replyText: 'Look at the denominators [1]. What is a common multiple of 2 and 3?',
    });
    // The answer key stays server-side.
    expect(
      JSON.stringify([events, result.trace, w.spy.requests.map((r) => r.messages)]),
    ).not.toContain(ANSWER_KEY);
    expect(result.background).toEqual([]);
  }, 15_000);

  it('aborts an over-budget turn', async () => {
    const w = world(
      [
        [say('Start. '), used, say('never shown')],
        [say('retry'), used],
      ],
      {
        maxTurnCostMicroUsd: PRICE - 1,
      },
    );
    const { events, result } = await driveTurn(
      runTurn(demoTurnInput, { deps: w.t.deps, steps: w.steps }),
      w.clock,
    );

    expect(events).toEqual([
      { type: 'hint_rung', rung: 2 },
      { type: 'token', text: 'Start. ' },
      { type: 'replace', text: '' },
      { type: 'error', code: 'turn_cost_exceeded', retryable: false },
    ]);
    // No second stream call and no retry; the stream was closed.
    expect(w.spy.requests).toHaveLength(1);
    expect(w.spy.returns).toBe(1);
    const started = (s: string) => w.steps.log.filter((l) => l.step === s && l.phase === 'start');
    expect(started('generate')).toHaveLength(1);
    expect(started('postGuard')).toHaveLength(0);
    // The trace has generate failed and still holds the usage; the commit says error.
    expect(result.trace?.steps.find((s) => s.name === 'generate')?.outcome).toBe('failed');
    expect(result.trace?.usage).toEqual([priced]);
    expect(w.steps.commits[0]).toMatchObject({ outcome: 'error' });
    expect(w.steps.commits[0]?.replyText).toBeUndefined();
  }, 15_000);
});
