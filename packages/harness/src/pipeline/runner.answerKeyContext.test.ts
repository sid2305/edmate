// Task 5.6a through the runner: the real buildContext, generate and postGuard with the scripted
// gateway. A chunk that holds the active answer key never reaches the model; the trace reports the
// drop as a count-free guard entry; and practice.next_item never issues an item whose key is in
// this turn's chunks. Items, keys and chunks are synthetic.
import type {
  Chunk,
  ModelChunk,
  PedagogyDecision,
  ProfileStore,
  RetrievalIndex,
  TranscriptStore,
  TurnEvent,
} from '@edmate/contracts';
import {
  demoChunk,
  demoLearnerProfile,
  demoPedagogyDecision,
  demoTurnInput,
  usageMain,
} from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { driveTurn } from '../testing/driveTurn.js';
import { memoryToolRegistry } from '../testing/memoryToolRegistry.js';
import { FIXTURE_PROMPT_PACK_VERSION } from '../testing/promptPackFixtures.js';
import type { ScriptedStreamCall } from '../testing/scriptedGateway.js';
import { testDecideResult, testDeps, testSteps } from '../testing/testSteps.js';
import { type DemoPracticeRecord, demoPracticeBank } from '../tools/demoPracticeBank.js';
import { practiceNextItemTool } from '../tools/practice.js';
import { runTurn } from './runner.js';
import { defaultSteps } from './steps/index.js';
import type { Steps } from './types.js';

const KEY = 'Chlorophyll';
const CLEAN = 'CLEANMARKER plants make food from light';
const POISON = `POISONMARKER the green pigment is ${KEY}`;
const BANK_KEY = '4321';

const decision: PedagogyDecision = {
  ...demoPedagogyDecision,
  move: 'ask',
  mustNotReveal: [],
  tools: ['practice.next_item'],
};
const say = (text: string) => ({ type: 'text', text }) satisfies ModelChunk;
const used = { type: 'usage', usage: usageMain } satisfies ModelChunk;
const callItem = {
  type: 'tool_call',
  id: 'c1',
  name: 'practice.next_item',
  args: {},
} satisfies ModelChunk;
const main = (...steps: ScriptedStreamCall['steps']): ScriptedStreamCall => ({
  match: (r) => r.tier === 'main',
  steps,
});

const RECORDS: readonly DemoPracticeRecord[] = [
  {
    item: {
      id: 'fx:linear:1:a',
      teacherId: 'tch_test_01',
      topicId: 'linear',
      moduleId: demoChunk.moduleId,
      level: 1,
      kind: 'numeric',
      prompt: 'Solve for x: x - 1000 = 3321.',
    },
    answerKey: [BANK_KEY],
  },
];

const chunk = (id: string, text: string, score: number): Chunk => ({
  ...demoChunk,
  id,
  text,
  score,
});

const profiles: ProfileStore = {
  get: () => Promise.resolve(demoLearnerProfile),
  applyEvidence: () => Promise.reject(new Error('unused')),
};
const transcripts: TranscriptStore = {
  history: () => Promise.resolve([]),
  append: () => Promise.reject(new Error('unused')),
};

function fixedRetrieval(chunks: Chunk[]): RetrievalIndex {
  return {
    search: () => Promise.resolve(chunks.map((c) => ({ ...c }))),
    probe: () => Promise.resolve({ hit: false, score: 0 }),
    leakCheck: () => Promise.resolve({ hit: false }),
  };
}

async function turn(
  chunks: Chunk[],
  answerKey: string[],
  stream: ScriptedStreamCall[],
  realDecide = false,
) {
  const tools = memoryToolRegistry([practiceNextItemTool(demoPracticeBank(RECORDS))]);
  const t = testDeps({
    script: { stream },
    overrides: { tools, profiles, transcripts, retrieval: fixedRetrieval(chunks) },
    judge: 'grounded',
  });
  const happy = testSteps();
  const entitle: Steps['entitle'] = async (env) => {
    const e = await happy.entitle(env);
    return {
      ...e,
      agent: { ...e.agent, promptPackVersion: FIXTURE_PROMPT_PACK_VERSION },
      helpState: {
        v: 1,
        rung: 2,
        stuckTurns: 0,
        attemptLogged: false,
        pendingCheck: false,
        answerKey,
      },
    };
  };
  const steps = testSteps({
    entitle,
    buildContext: defaultSteps.buildContext,
    decide: realDecide
      ? defaultSteps.decide
      : { run: () => Promise.resolve(testDecideResult(decision)) },
    generate: defaultSteps.generate,
    postGuard: defaultSteps.postGuard,
  });
  const { events, result } = await driveTurn(
    runTurn(demoTurnInput, { deps: t.deps, steps }),
    t.clock,
  );
  const sent = JSON.stringify(t.gateway.requests.filter((q) => q.tier === 'main'));
  return { events, result, sent, commit: steps.commits[0] };
}

const skillJson = (events: TurnEvent[]) => JSON.stringify(events.filter((e) => e.type === 'skill'));

describe('runner: a chunk holding the active answer key never reaches the model (5.6a)', () => {
  it('the model request has the clean chunk, not the poisoned one or the key; the trace says so', async () => {
    const r = await turn(
      [chunk('chk_poison', POISON, 0.9), chunk('chk_clean', CLEAN, 0.5)],
      [KEY],
      [main(say('Let us think about how plants eat.'), used)],
      true,
    );
    expect(r.sent).toContain('CLEANMARKER');
    expect(r.sent).not.toContain('POISONMARKER');
    // A non-practice key is still named in the do-not-say list on purpose (the 3.6 behaviour,
    // ADR-0011 §4). Everything else the model is sent, the material included, is free of it.
    const outsideDoNotSay = r.sent.replace(/\[\[DO-NOT-SAY\]\][^[]*/g, '');
    expect(outsideDoNotSay).toContain('[[MATERIAL]]');
    expect(outsideDoNotSay.toLowerCase()).not.toContain(KEY.toLowerCase());
    const guards = r.result.trace?.guards ?? [];
    expect(guards.filter((g) => g.name === 'answerKeyContext')).toEqual([
      { name: 'answerKeyContext', ok: false, action: 'drop' },
    ]);
    // The trace holds no text: no marker, no key.
    const trace = JSON.stringify(r.result.trace);
    expect(trace).not.toContain('POISONMARKER');
    expect(trace).not.toContain(KEY);
  });

  it('nothing dropped: no answerKeyContext entry', async () => {
    const r = await turn(
      [chunk('chk_clean', CLEAN, 0.5)],
      [KEY],
      [main(say('Let us think about how plants eat.'), used)],
      true,
    );
    expect(r.sent).toContain('CLEANMARKER');
    expect(r.result.trace?.guards.some((g) => g.name === 'answerKeyContext')).toBe(false);
  });
});

describe('runner: practice.next_item never issues an item whose key is in the chunks (5.6a)', () => {
  it('a chunk holds the first bank item key: the tool issues another, key-free item', async () => {
    const r = await turn(
      [chunk('chk_bank', `we found x = ${BANK_KEY} last time`, 0.9)],
      [],
      [main(callItem, used), main(say('Here is one for you.'), used)],
    );
    const json = skillJson(r.events);
    expect(json).not.toContain('fx:linear:1:a');
    expect(json).toMatch(/gen:/);
    const help = r.commit?.next?.help;
    expect(help?.practiceItemId).toMatch(/^gen:/);
    expect(help?.answerKey).not.toContain(BANK_KEY);
  });

  it('a clean chunk: the bank item is issued as before', async () => {
    const r = await turn(
      [chunk('chk_clean', CLEAN, 0.9)],
      [],
      [main(callItem, used), main(say('Here is one for you.'), used)],
    );
    expect(r.commit?.next?.help?.practiceItemId).toBe('fx:linear:1:a');
  });
});
