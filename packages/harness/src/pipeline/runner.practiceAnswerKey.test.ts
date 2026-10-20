// Task 5.6 Phase C (ADR-0010) through the runner: the real generate (tool loop, sentence gate) and
// the real postGuard with `practice.next_item`. A practice item's key is looked up on the server
// the moment the tool returns; it never reaches the model, the stream or the reply, and the runner
// saves it on every outcome. Items and keys are synthetic.
import type { ModelChunk, PedagogyDecision, TurnEvent } from '@edmate/contracts';
import {
  demoPedagogyDecision,
  demoSafetyAlert,
  demoTurnInput,
  usageMain,
} from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { ANSWER_LEAK_SAFE_HINT } from '../guardrails/answerLeak.js';
import type { HelpState } from '../pedagogy/helpState.js';
import { driveTurn } from '../testing/driveTurn.js';
import { memoryToolRegistry } from '../testing/memoryToolRegistry.js';
import { FIXTURE_PROMPT_PACK_VERSION } from '../testing/promptPackFixtures.js';
import type { ScriptedStreamCall } from '../testing/scriptedGateway.js';
import { testDecideResult, testDeps, testSteps } from '../testing/testSteps.js';
import { type DemoPracticeRecord, demoPracticeBank } from '../tools/demoPracticeBank.js';
import { practiceNextItemTool } from '../tools/practice.js';
import { generatedAnswerKeyFor } from '../tools/practiceItems.js';
import { runTurn } from './runner.js';
import { defaultSteps } from './steps/index.js';
import type { BuiltContext, PostGuardResult, Steps } from './types.js';

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
const providerError = { type: 'error', code: 'provider_error' } as const;

// The fixture entitlement allows mod_test_01..03; the default retrieved chunk is in mod_test_01.
const BANK_KEY = '4321';
const RECORDS: readonly DemoPracticeRecord[] = [
  {
    item: {
      id: 'fx:linear:1:a',
      teacherId: 'tch_test_01',
      topicId: 'linear',
      moduleId: 'mod_test_01',
      level: 1,
      kind: 'numeric',
      prompt: 'Solve for x: x - 1000 = 3321.',
    },
    answerKey: [BANK_KEY],
  },
  {
    item: {
      id: 'fx:linear:1:b',
      teacherId: 'tch_test_01',
      topicId: 'linear',
      moduleId: 'mod_test_02',
      level: 1,
      kind: 'numeric',
      prompt: 'Solve for y: y - 2000 = 3456.',
    },
    answerKey: ['5456'],
  },
];

const fixtureEntitle: Steps['entitle'] = async (env) => {
  const e = await testSteps().entitle(env);
  return { ...e, agent: { ...e.agent, promptPackVersion: FIXTURE_PROMPT_PACK_VERSION } };
};

function builtWith(help: Partial<HelpState>, extra: Partial<BuiltContext> = {}): BuiltContext {
  return {
    profile: {
      studentId: 'stu_test_01',
      teacherId: 'tch_test_01',
      lang: 'en',
      mastery: {},
      mistakes: [],
    },
    history: [],
    retrieved: [],
    lockedHit: false,
    helpRung: 2,
    helpState: { stuckTurns: 0, attemptLogged: false, pendingCheck: false, answerKey: [], ...help },
    ...extra,
  };
}

async function turn(
  stream: ScriptedStreamCall[],
  o: {
    records?: readonly DemoPracticeRecord[];
    build?: Steps['buildContext'];
    postGuard?: Steps['postGuard'];
    decision?: PedagogyDecision;
    generate?: Steps['generate'];
  } = {},
) {
  const tools = memoryToolRegistry([practiceNextItemTool(demoPracticeBank(o.records ?? RECORDS))]);
  const t = testDeps({ script: { stream }, overrides: { tools }, judge: 'grounded' });
  const generatedKeys: (readonly string[] | undefined)[] = [];
  const steps = testSteps({
    entitle: fixtureEntitle,
    decide: { run: () => Promise.resolve(testDecideResult(o.decision ?? decision)) },
    generate: async (env, x, emit) => {
      const g = await (o.generate ?? defaultSteps.generate)(env, x, emit);
      generatedKeys.push(g.practiceAnswerKey);
      return g;
    },
    postGuard: o.postGuard ?? defaultSteps.postGuard,
    ...(o.build === undefined ? {} : { buildContext: o.build }),
  });
  const { events, result } = await driveTurn(
    runTurn(demoTurnInput, { deps: t.deps, steps }),
    t.clock,
  );
  const commit = steps.commits[0];
  return { events, result, commit, help: commit?.next?.help, t, generatedKeys };
}

const tokens = (events: TurnEvent[]) =>
  events.map((e) => (e.type === 'token' ? e.text : '')).join('');
const standalone = (key: string) =>
  new RegExp(`(?<![0-9])${key.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(?![0-9])`);

/** The key is nowhere the model or the student can see it, nor in the trace. */
function expectNoLeak(r: Awaited<ReturnType<typeof turn>>, key: string, itemPrompt: string): void {
  const re = standalone(key);
  // The model sees the item's prompt (a generated "What is a + b?" names a and b): strip it, then
  // nothing the reply model was sent holds the key. (Guard calls after the reply, such as the
  // answer-leak rewrite, are handed the model's own draft; they are not the model's input.)
  const sent = JSON.stringify(r.t.gateway.requests.filter((q) => q.tier === 'main'))
    .split(itemPrompt)
    .join('');
  expect(sent).not.toMatch(re);
  expect(tokens(r.events)).not.toMatch(re);
  expect(r.commit?.replyText ?? '').not.toMatch(re);
  expect(JSON.stringify(r.result.trace ?? {})).not.toMatch(re);
}

const skillEvents = (events: TurnEvent[]) => events.filter((e) => e.type === 'skill');

describe('runner + practice.next_item: a bank item (5.6, ADR-0010)', () => {
  it('the key is never sent, streamed or replied, and the saved state holds it at rung 0', async () => {
    const r = await turn([
      main(callItem, used),
      main(say('Here is one for you. '), say('Take your time.'), used),
    ]);
    expectNoLeak(r, BANK_KEY, 'Solve for x: x - 1000 = 3321.');
    expect(r.commit?.replyText).toBe('Here is one for you. Take your time.');
    expect(r.generatedKeys).toEqual([[BANK_KEY]]);
    // The item event goes out to the student, without the key.
    expect(skillEvents(r.events)).toHaveLength(1);
    expect(JSON.stringify(skillEvents(r.events))).toContain('fx:linear:1:a');
    expect(r.commit?.next?.rung).toBe(0);
    expect(r.help).toMatchObject({
      answerKey: [BANK_KEY],
      practiceItemId: 'fx:linear:1:a',
      practiceModuleId: 'mod_test_01',
      practiceServed: ['fx:linear:1:a'],
      stuckTurns: 0,
      attemptLogged: false,
      pendingCheck: false,
    });
    // The model saw the item, not the key.
    expect(JSON.stringify(r.t.gateway.requests)).toContain('Solve for x: x - 1000 = 3321.');
  });

  it('the model echoes the answer on the issuing turn: the gate holds it, the reply is the hint', async () => {
    const r = await turn([
      main(callItem, used),
      main(say('Here is one. '), say(`The answer is ${BANK_KEY}. `), say('Go!'), used),
    ]);
    expectNoLeak(r, BANK_KEY, 'Solve for x: x - 1000 = 3321.');
    expect(r.commit?.replyText).toBe(ANSWER_LEAK_SAFE_HINT);
    expect(r.result.trace?.guards).toContainEqual(
      expect.objectContaining({ name: 'answerLeak', ok: false }),
    );
    expect(r.help?.answerKey).toEqual([BANK_KEY]);
  });

  it('a second call in the same attempt gets a new item; both keys are guarded and saved', async () => {
    const twice = { ...callItem, id: 'c2' };
    const r = await turn([main(callItem, twice, used), main(say('Two for you.'), used)]);
    expectNoLeak(r, BANK_KEY, 'Solve for x: x - 1000 = 3321.');
    // The bank's only mod_test_01 item is served once; the second call gets a generated one.
    const served = r.help?.practiceServed ?? [];
    expect(served).toHaveLength(2);
    expect(served[0]).toBe('fx:linear:1:a');
    expect(served[1]).toMatch(/^gen:mod_test_01:practice:1:/);
    expect(r.help?.practiceItemId).toBe(served[1]);
    expect(r.help?.answerKey).toEqual([
      BANK_KEY,
      ...(generatedAnswerKeyFor(served[1] ?? '') ?? []),
    ]);
  });
});

describe('runner + practice.next_item: a generated item', () => {
  async function generated(second: ScriptedStreamCall) {
    return turn([main(callItem, used), second], { records: [] });
  }

  it('the computed key is never sent, streamed or replied, and is saved', async () => {
    const r = await generated(main(say('Here is a new one. '), say('Try it.'), used));
    const id = r.help?.practiceItemId ?? '';
    expect(id).toMatch(/^gen:mod_test_01:practice:1:/);
    const key = generatedAnswerKeyFor(id) ?? [];
    expect(key.length).toBeGreaterThan(0);
    expect(r.help?.answerKey).toEqual(key);
    expect(r.help?.practiceModuleId).toBe('mod_test_01');
    const prompt = (skillEvents(r.events)[0] as { payload: { prompt: string } }).payload.prompt;
    for (const k of key) expectNoLeak(r, k, prompt);
  });

  it('the model echoes the computed answer: held by the gate, the reply is the hint', async () => {
    const first = await generated(main(say('Ok.'), used));
    const key = first.help?.answerKey[0] ?? '';
    const r = await generated(main(say('Here it is. '), say(`It equals ${key}. `), used));
    expect(r.commit?.replyText).toBe(ANSWER_LEAK_SAFE_HINT);
    expect(tokens(r.events)).not.toMatch(standalone(key));
  });

  it('a model that restates an arithmetic item is held too (matcher false positive, fail closed)', async () => {
    // Known limit, reported in the handoff: "What is a + b?" evaluates to the key, so restating
    // the item counts as a reveal and the student gets the hint instead.
    const first = await generated(main(say('Ok.'), used));
    const prompt = (skillEvents(first.events)[0] as { payload: { prompt: string } }).payload.prompt;
    const r = await generated(main(say(`Here is your problem. ${prompt} `), used));
    expect(r.commit?.replyText).toBe(ANSWER_LEAK_SAFE_HINT);
  });
});

describe('runner + practice.next_item: saved on every outcome', () => {
  it('a turn that errors after the item went out still saves its key', async () => {
    const r = await turn([main(callItem, used), main(providerError), main(providerError)]);
    expect(r.events.at(-1)).toMatchObject({ type: 'error' });
    expect(r.help).toMatchObject({ answerKey: [BANK_KEY], practiceItemId: 'fx:linear:1:a' });
    expect(r.commit?.next?.rung).toBe(0);
  });

  it('a retry guards the earlier attempt’s key from its first word', async () => {
    const r = await turn([
      main(callItem, used),
      main(providerError),
      main(say(`Answer: ${BANK_KEY}. `), used),
    ]);
    expect(r.commit?.replyText).toBe(ANSWER_LEAK_SAFE_HINT);
    expect(tokens(r.events)).not.toMatch(standalone(BANK_KEY));
    expect(r.help?.answerKey).toEqual([BANK_KEY]);
  });

  it('a post guard escalate still saves the key', async () => {
    const escalate: Steps['postGuard'] = () =>
      Promise.resolve({
        result: 'escalate',
        alert: demoSafetyAlert,
        text: 'never shown',
        guards: [{ name: 'tone', ok: false, action: 'escalate' }],
        usage: [],
      } satisfies PostGuardResult);
    const r = await turn([main(callItem, used), main(say('Hi.'), used)], { postGuard: escalate });
    expect(r.events.some((e) => e.type === 'safety')).toBe(true);
    expect(r.help).toMatchObject({ answerKey: [BANK_KEY], practiceItemId: 'fx:linear:1:a' });
  });

  it('an unreadable stored state: the key is still saved, with the locked stop set (fail closed)', async () => {
    const r = await turn([main(callItem, used), main(say('Go.'), used)], {
      build: () =>
        Promise.resolve(builtWith({}, { helpRung: 0, helpStateUnreadable: true, retrieved: [] })),
    });
    expect(r.help).toMatchObject({ answerKey: [BANK_KEY], lockedStopped: true });
  });
});

describe('runner + practice.next_item: the next turn', () => {
  it('excludes served items and keeps to the active item’s module', async () => {
    const r = await turn([main(callItem, used), main(say('Next one.'), used)], {
      build: () =>
        Promise.resolve(
          builtWith({
            answerKey: [BANK_KEY],
            practiceItemId: 'fx:linear:1:a',
            practiceModuleId: 'mod_test_02',
            practiceServed: ['fx:linear:1:a'],
          }),
        ),
    });
    expect(r.help).toMatchObject({
      answerKey: ['5456'],
      practiceItemId: 'fx:linear:1:b',
      practiceModuleId: 'mod_test_02',
      practiceServed: ['fx:linear:1:a', 'fx:linear:1:b'],
    });
    expect(r.commit?.next?.rung).toBe(0);
    // The earlier key stays guarded through decide's mustNotReveal in real use; here decide is
    // stubbed, so only the new key is checked.
    expectNoLeak(r, '5456', 'Solve for y: y - 2000 = 3456.');
  });

  it('a turn that issues no item carries the practice fields over', async () => {
    const practice = {
      practiceItemId: 'fx:linear:1:a',
      practiceModuleId: 'mod_test_01',
      practiceServed: ['fx:linear:1:a'],
    };
    const r = await turn([main(say('Keep going.'), used)], {
      build: () => Promise.resolve(builtWith({ answerKey: [BANK_KEY], ...practice })),
    });
    expect(r.help).toMatchObject(practice);
    expect(r.generatedKeys).toEqual([undefined]);
  });
});

describe('runner + practice.next_item: practice never gets stuck (5.6 review)', () => {
  it('three items in a row at level 1 are all served, with a held key "1"', async () => {
    // Before the fix the output JSON's `"level":1` matched the held key "1" and every call failed.
    const calls = ['c1', 'c2', 'c3'].map((id) => ({ ...callItem, id }));
    const r = await turn([main(...calls, used), main(say('Three for you.'), used)], {
      records: [],
      decision: { ...decision, mustNotReveal: ['1'] },
    });
    const served = r.help?.practiceServed ?? [];
    expect(served).toHaveLength(3);
    expect(new Set(served).size).toBe(3);
    expect(skillEvents(r.events)).toHaveLength(3);
    for (const id of served) expect(id).toMatch(/^gen:mod_test_01:practice:1:/);
    expect(r.help?.answerKey).toEqual([
      ...new Set(served.flatMap((id) => generatedAnswerKeyFor(id) ?? [])),
    ]);
  });

  it('three turns in a row at level 1 each serve a new item, the earlier key held', async () => {
    let help: Partial<HelpState> = {};
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const prior = help;
      const r = await turn([main(callItem, used), main(say('Next.'), used)], {
        records: [],
        decision: { ...decision, mustNotReveal: [...(prior.answerKey ?? [])] },
        build: () => Promise.resolve(builtWith(prior)),
      });
      expect(skillEvents(r.events)).toHaveLength(1);
      const id = r.help?.practiceItemId ?? '';
      expect(ids).not.toContain(id);
      ids.push(id);
      help = r.help ?? {};
    }
    expect(help.practiceServed).toEqual(ids);
  });
});

describe('runner + postGuard: the generate result’s practice keys are guarded (5.6 review)', () => {
  it('a key only in gen.practiceAnswerKey still makes postGuard hold a reply that shows it', async () => {
    const step: Steps['generate'] = async (env, x, emit) => ({
      ...(await defaultSteps.generate(env, x, emit)),
      practiceAnswerKey: ['8642'],
    });
    const r = await turn([main(say('It is 8642.'), used)], { generate: step });
    expect(r.commit?.replyText).toBe(ANSWER_LEAK_SAFE_HINT);
  });
});
