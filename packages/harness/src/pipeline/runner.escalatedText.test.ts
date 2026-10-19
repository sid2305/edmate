// Task 4.5c: CommitRecord.escalatedText (the post chain's text on a postGuard escalate, saved for
// review, never shown) must stay out of a later turn's history and model request. commit.ts never
// appends it to transcripts (only replyText); this test proves that end to end, with the real
// commit, buildContext and generate steps: a second turn in the same session never sees it, in
// the transcript store, in buildContext's history, or in the model request a scripted gateway spy
// records.
import {
  type EntitlementStore,
  type ModelChunk,
  type RetrievalIndex,
  type TurnConfigStore,
} from '@edmate/contracts';
import {
  demoAgentConfig,
  demoChunkScored,
  demoEntitlementSubscription,
  demoLearnerProfile,
  demoLocalePack,
  demoPackagePaid,
  demoPedagogyDecision,
  demoSafetyAlert,
  demoStyleCard,
  demoTurnInput,
} from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { driveTurn } from '../testing/driveTurn.js';
import { memoryTranscriptStore, type MemoryTranscriptStore } from '../testing/memoryPorts.js';
import { memoryRetrieval, retrievalWorld } from '../testing/memoryRetrieval.js';
import { FIXTURE_PROMPT_PACK_VERSION } from '../testing/promptPackFixtures.js';
import { ScriptedGateway, type StreamStep } from '../testing/scriptedGateway.js';
import { spyGateway } from '../testing/spyGateway.js';
import { stepEnvExtras, testDecideResult, testDeps, testSteps } from '../testing/testSteps.js';
import { virtualClock } from '../testing/virtualClock.js';
import { cancelSource } from './clock.js';
import { runTurn } from './runner.js';
import { admit } from './steps/admit.js';
import { buildContext } from './steps/buildContext.js';
import { commit } from './steps/commit.js';
import { entitle } from './steps/entitle.js';
import { generate } from './steps/generate.js';
import type { Entitled, PipelineDeps, StepEnv } from './types.js';

/** A canary string, never a real key: must never reach the model, history or a teacher view. */
const ESCALATED_TEXT_CANARY = 'ESCALATED-TEXT-CANARY-9f2b';
const decision = { ...demoPedagogyDecision, move: 'ask' as const, mustNotReveal: [] };
const say = (text: string) => ({ type: 'text', text }) satisfies ModelChunk;

const ENTITLED: Entitled = {
  entitlement: demoEntitlementSubscription,
  agent: { ...demoAgentConfig, promptPackVersion: FIXTURE_PROMPT_PACK_VERSION },
  pkg: demoPackagePaid,
  locale: demoLocalePack,
  styleCard: demoStyleCard,
};

/** Real admit/entitle/buildContext/generate, a shared transcript store, one gateway per turn. */
function world(streams: StreamStep[][], transcripts: MemoryTranscriptStore) {
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
        helpState: {
          v: 1,
          rung: 0,
          stuckTurns: 0,
          attemptLogged: false,
          pendingCheck: false,
          answerKey: [],
        },
      }),
  };
  const retrieval: RetrievalIndex = {
    search: () => Promise.resolve([{ ...demoChunkScored }]),
    probe: () => Promise.resolve({ hit: false, score: 0 }),
  };
  const overrides: Partial<PipelineDeps> = {
    gatewayFor: (s) => spy.gatewayFor(s),
    entitlements,
    turnConfig,
    retrieval,
    profiles: {
      get: () => Promise.resolve(demoLearnerProfile),
      applyEvidence: () => Promise.reject(new Error('unused')),
    },
    transcripts,
  };
  const t = testDeps({ clock, overrides });
  return { t, spy, clock };
}

describe('CommitRecord.escalatedText never reaches history or a later model request (4.5c)', () => {
  it('stays off the transcript store, so a later buildContext and generate never see it', async () => {
    const transcripts = memoryTranscriptStore();

    // Turn 1: a postGuard escalate carries escalatedText; the student sees only the caring reply.
    // The real commit step runs (wrapped only to capture the record it was handed): it persists
    // `record.replyText`, never `record.escalatedText`.
    const committed: { outcome: string; escalatedText?: string }[] = [];
    const w1 = world([[say('Hello.')]], transcripts);
    const steps1 = testSteps({
      admit,
      entitle,
      buildContext,
      decide: { run: () => Promise.resolve(testDecideResult(decision)) },
      generate,
      postGuard: () =>
        Promise.resolve({
          result: 'escalate',
          alert: demoSafetyAlert,
          text: ESCALATED_TEXT_CANARY,
          guards: [{ name: 'tone', ok: false, action: 'escalate' }],
          usage: [],
        }),
      commit: (env, record) => {
        committed.push({ outcome: record.outcome, ...(record.escalatedText === undefined ? {} : { escalatedText: record.escalatedText }) });
        return commit(env, record);
      },
    });
    await driveTurn(runTurn(demoTurnInput, { deps: w1.t.deps, steps: steps1 }), w1.clock);

    expect(committed[0]).toMatchObject({
      outcome: 'escalated',
      escalatedText: ESCALATED_TEXT_CANARY,
    });
    expect(JSON.stringify(transcripts.appended)).not.toContain(ESCALATED_TEXT_CANARY);

    // Turn 2, same session: a direct, real buildContext reads that history back.
    const w2 = world([[say('What is a common multiple of 2 and 3?')]], transcripts);
    const env: StepEnv = {
      input: demoTurnInput,
      deps: {
        ...w2.t.deps,
        profiles: {
          get: () => Promise.resolve(demoLearnerProfile),
          applyEvidence: () => Promise.reject(new Error('unused')),
        },
        retrieval: memoryRetrieval({ chunks: retrievalWorld() }),
      },
      cancel: cancelSource().token,
      turnId: 'turn_2',
      ...stepEnvExtras(),
    };
    const built = await buildContext(env, ENTITLED);
    expect(JSON.stringify(built.history)).not.toContain(ESCALATED_TEXT_CANARY);

    // The same turn, driven end to end: a real generate sends that history to the model, through
    // a scripted gateway spy that records every request it made.
    const steps2 = testSteps({
      admit,
      entitle,
      buildContext,
      decide: { run: () => Promise.resolve(testDecideResult(decision)) },
      generate,
    });
    await driveTurn(runTurn(demoTurnInput, { deps: w2.t.deps, steps: steps2 }), w2.clock);

    expect(JSON.stringify(w2.spy.requests)).not.toContain(ESCALATED_TEXT_CANARY);
    expect(JSON.stringify(w2.spy.requests.flatMap((r) => r.messages))).not.toContain(
      ESCALATED_TEXT_CANARY,
    );
  }, 15_000);
});
