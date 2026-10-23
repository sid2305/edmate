// Task 5.6 Phase C (ADR-0010) through the runner: the real generate (tool loop, sentence gate) and
// the real postGuard with `practice.next_item`. A practice item's key is looked up on the server
// the moment the tool returns; it never reaches the model, the stream or the reply, and the runner
// saves it on every outcome. Items and keys are synthetic.
import type {
  ModelChunk,
  ModelRequest,
  PedagogyDecision,
  TurnEvent,
  TurnInput,
} from '@edmate/contracts';
import {
  demoChunk,
  demoPedagogyDecision,
  demoSafetyAlert,
  demoTurnInput,
  usageMain,
} from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { ANSWER_LEAK_SAFE_HINT } from '../guardrails/answerLeak.js';
import { type HelpState, serializeSessionHelp } from '../pedagogy/helpState.js';
import { classifyAttempt } from '../routing/classify.js';
import { driveTurn } from '../testing/driveTurn.js';
import { memoryToolRegistry } from '../testing/memoryToolRegistry.js';
import { FIXTURE_PROMPT_PACK_VERSION } from '../testing/promptPackFixtures.js';
import type { ScriptedObjectCall, ScriptedStreamCall } from '../testing/scriptedGateway.js';
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
    /** A whole decide step (wins over `decision` and `realDecide`). */
    decide?: Steps['decide'];
    generate?: Steps['generate'];
    /** The real decide step (policy + composer with the fixture packs) instead of `decision`. */
    realDecide?: boolean;
    /** The real route step (rules, then the small-tier intent model). */
    realRoute?: boolean;
    input?: TurnInput;
    objects?: ScriptedObjectCall[];
  } = {},
) {
  const tools = memoryToolRegistry([practiceNextItemTool(demoPracticeBank(o.records ?? RECORDS))]);
  const t = testDeps({
    script: { stream, ...(o.objects === undefined ? {} : { generateObject: o.objects }) },
    overrides: { tools },
    judge: 'grounded',
  });
  const generatedKeys: (readonly string[] | undefined)[] = [];
  /** generateObject requests (route's intent model): the spy gateway records streams only. */
  const objectRequests: ModelRequest[] = [];
  const realRoute: Steps['route'] = {
    run: (env, s) =>
      defaultSteps.route.run(
        {
          ...env,
          gateway: {
            ...env.gateway,
            generateObject: (req, schema) => {
              objectRequests.push(JSON.parse(JSON.stringify(req)) as ModelRequest);
              return env.gateway.generateObject(req, schema);
            },
          },
        },
        s,
      ),
    onFailure: defaultSteps.route.onFailure,
  };
  const steps = testSteps({
    entitle: fixtureEntitle,
    decide:
      o.decide !== undefined
        ? o.decide
        : o.realDecide === true
        ? defaultSteps.decide
        : { run: () => Promise.resolve(testDecideResult(o.decision ?? decision)) },
    ...(o.realRoute === true ? { route: realRoute } : {}),
    generate: async (env, x, emit) => {
      const g = await (o.generate ?? defaultSteps.generate)(env, x, emit);
      generatedKeys.push(g.practiceAnswerKey);
      return g;
    },
    postGuard: o.postGuard ?? defaultSteps.postGuard,
    ...(o.build === undefined ? {} : { buildContext: o.build }),
  });
  const { events, result } = await driveTurn(
    runTurn(o.input ?? demoTurnInput, { deps: t.deps, steps }),
    t.clock,
  );
  const commit = steps.commits[0];
  return { events, result, commit, help: commit?.next?.help, t, generatedKeys, objectRequests };
}

const tokens = (events: TurnEvent[]) =>
  events.map((e) => (e.type === 'token' ? e.text : '')).join('');
const standalone = (key: string) =>
  new RegExp(`(?<![0-9])${key.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(?![0-9])`);

type Turn = Awaited<ReturnType<typeof turn>>;

/** Every practice key this turn issued: the saved `answerKey` and each attempt's generate keys. */
const issuedKeysOf = (r: Turn): string[] => [
  ...new Set([...(r.help?.answerKey ?? []), ...r.generatedKeys.flatMap((k) => k ?? [])]),
];

/** Every model request the turn made, on every tier: the gateway's and the fake judges'. */
const allRequests = (r: Turn) => [
  ...r.t.gateway.requests,
  ...r.objectRequests,
  ...r.t.judged,
  ...r.t.adviceJudged,
];

/**
 * No issued key (plus `o.keys`) is anywhere the model or the student can see it, nor in the trace
 * or the skill events (5.6c). `tiers: 'all'` scans every request on every tier, for turns where the
 * model never writes the key. `'main'` scans the reply model's requests only: when the model
 * itself writes the key, answerLeak's small-tier rewrite is handed that draft (ADR-0011 §5, out of
 * scope). The item prompts are stripped first: the model is meant to see them, and a generated
 * "What is a + b?" names a and b.
 */
function expectNoLeak(r: Turn, o: { prompts: string[]; keys?: string[]; tiers: 'all' | 'main' }) {
  const keys = [...new Set([...issuedKeysOf(r), ...(o.keys ?? [])])];
  expect(keys.length).toBeGreaterThan(0);
  const requests = o.tiers === 'all' ? allRequests(r) : r.t.gateway.requests;
  let sent = JSON.stringify(
    o.tiers === 'all' ? requests : requests.filter((q) => q.tier === 'main'),
  );
  for (const p of o.prompts) sent = sent.split(p).join('');
  for (const key of keys) {
    const re = standalone(key);
    expect(sent).not.toMatch(re);
    expect(tokens(r.events)).not.toMatch(re);
    expect(r.commit?.replyText ?? '').not.toMatch(re);
    expect(JSON.stringify(r.result.trace ?? {})).not.toMatch(re);
    expect(JSON.stringify(skillEvents(r.events))).not.toMatch(re);
  }
}

const skillEvents = (events: TurnEvent[]) => events.filter((e) => e.type === 'skill');

describe('runner + practice.next_item: a bank item (5.6, ADR-0010)', () => {
  it('the key is never sent, streamed or replied, and the saved state holds it at rung 0', async () => {
    const r = await turn([
      main(callItem, used),
      main(say('Here is one for you. '), say('Take your time.'), used),
    ]);
    expectNoLeak(r, { prompts: ['Solve for x: x - 1000 = 3321.'], tiers: 'all' });
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
    // The model wrote the key: main tier only (the rewrite is handed its draft; ADR-0011 §5).
    expectNoLeak(r, { prompts: ['Solve for x: x - 1000 = 3321.'], tiers: 'main' });
    expect(r.commit?.replyText).toBe(ANSWER_LEAK_SAFE_HINT);
    expect(r.result.trace?.guards).toContainEqual(
      expect.objectContaining({ name: 'answerLeak', ok: false }),
    );
    expect(r.help?.answerKey).toEqual([BANK_KEY]);
  });

  it('a second call in the same attempt gets a new item; both keys are guarded and saved', async () => {
    const twice = { ...callItem, id: 'c2' };
    const r = await turn([main(callItem, twice, used), main(say('Two for you.'), used)]);
    const prompts = skillEvents(r.events).map(
      (e) => (e as { payload: { prompt: string } }).payload.prompt,
    );
    expectNoLeak(r, { prompts, tiers: 'all' });
    expect(issuedKeysOf(r)).toContain(BANK_KEY);
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
    expectNoLeak(r, { prompts: [prompt], tiers: 'all' });
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
    // stubbed and never names it, so the new key and the carried one are both checked.
    expectNoLeak(r, { prompts: ['Solve for y: y - 2000 = 3456.'], keys: [BANK_KEY], tiers: 'all' });
    expect(r.help?.practiceCarriedKey).toEqual([BANK_KEY]);
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

describe('runner + the real decide: practice keys never reach any model request (5.6c, ADR-0011)', () => {
  // A later turn: the loaded state holds a practice key. The real decide composes the prompt
  // from the fixture packs; the student text and the material hold no key (ADR-0011 §5 scope).
  const held = {
    answerKey: [BANK_KEY],
    practiceItemId: 'fx:linear:1:a',
    practiceModuleId: 'mod_test_01',
    practiceServed: ['fx:linear:1:a'],
  };
  const later = (help: Partial<HelpState>) => () =>
    Promise.resolve(builtWith(help, { retrieved: [{ ...demoChunk, score: 0.9 }] }));
  // Inconclusive for the rules, so route asks the small-tier intent model too.
  const input: TurnInput = {
    ...demoTurnInput,
    text: 'Zebras juggle quietly near the old bridge at dusk',
  };
  const intentModel: ScriptedObjectCall[] = [
    { match: (q) => q.tier === 'small', value: { intent: 'on_task' } },
  ];

  it('acceptance: no request on any tier (main, fallback, small) holds the key', async () => {
    const r = await turn(
      [main(providerError), main(say('Let us look at the steps again.'), used)],
      {
        realDecide: true,
        realRoute: true,
        input,
        objects: intentModel,
        build: later(held),
      },
    );
    expect(r.commit?.replyText).toBe('Let us look at the steps again.');
    // Every tier was exercised: the intent model (small), the primary and the fallback attempt
    // (main) and grounding's judge.
    expect(r.objectRequests.filter((q) => q.tier === 'small')).toHaveLength(1);
    expect(r.t.gateway.requests.filter((q) => q.tier === 'main')).toHaveLength(2);
    expect(r.t.judged).not.toHaveLength(0);
    const sent = JSON.stringify(allRequests(r));
    expect(sent).not.toMatch(standalone(BANK_KEY));
    expect(sent).not.toContain('[[DO-NOT-SAY]]');
    expectNoLeak(r, { prompts: [], tiers: 'all' });
  });

  it('control: the same turn with a non-practice key still renders it (3.6), so the turn teaches', async () => {
    const r = await turn([main(say('Let us look at the steps again.'), used)], {
      realDecide: true,
      build: later({ answerKey: [BANK_KEY] }),
    });
    const system = r.t.gateway.requests.find((q) => q.tier === 'main')?.system ?? '';
    expect(system).toContain('[[DO-NOT-SAY]]');
    expect(system).toContain(`"${BANK_KEY}"`);
  });

  it('the guards still hold the key: when the model writes it, the reply is the safe hint', async () => {
    const r = await turn([main(say('Here it is. '), say(`x is ${BANK_KEY}. `), used)], {
      realDecide: true,
      build: later(held),
    });
    expect(r.commit?.replyText).toBe(ANSWER_LEAK_SAFE_HINT);
    expect(tokens(r.events)).not.toMatch(standalone(BANK_KEY));
    const mainSent = JSON.stringify(r.t.gateway.requests.filter((q) => q.tier === 'main'));
    expect(mainSent).not.toMatch(standalone(BANK_KEY));
  });
});

describe('runner: a skipped item key is carried one turn (5.6c, ADR-0011 §2-3)', () => {
  const A = BANK_KEY;
  const B = '5456';
  const loadedA = {
    answerKey: [A],
    practiceItemId: 'fx:linear:1:a',
    practiceModuleId: 'mod_test_02',
    practiceServed: ['fx:linear:1:a'],
  };

  async function skipThenNext(second: ScriptedStreamCall[]) {
    // Turn 1: key A is loaded (item a, unsolved) and item b goes out.
    const first = await turn([main(callItem, used), main(say('A new one.'), used)], {
      decision: { ...decision, mustNotReveal: [A] },
      build: () => Promise.resolve(builtWith(loadedA)),
    });
    const saved = first.commit?.next;
    // Turn 2, with the real decide: the saved state as loaded.
    const next = await turn(second, {
      realDecide: true,
      build: () =>
        Promise.resolve(
          builtWith(saved?.help ?? {}, {
            helpRung: saved?.rung ?? 0,
            retrieved: [{ ...demoChunk, score: 0.9 }],
          }),
        ),
    });
    return { first, next };
  }

  it('turn 1 saves B as the answer key and A as the carried key; grading reads B only', async () => {
    const { first } = await skipThenNext([main(say('Ok.'), used)]);
    expect(first.help).toMatchObject({
      answerKey: [B],
      practiceItemId: 'fx:linear:1:b',
      practiceCarriedKey: [A],
    });
    const stored = first.commit?.next === undefined ? {} : serializeSessionHelp(first.commit.next);
    expect(classifyAttempt({ text: B, kind: 'message' }, stored)).toBe('correct');
    expect(classifyAttempt({ text: A, kind: 'message' }, stored)).toBe('wrong');
  });

  it('turn 2: A is held, neither key is in the reply model’s requests, the carried key is not saved again', async () => {
    const { next } = await skipThenNext([main(say('Last time '), say(`it was ${A}. `), used)]);
    expect(next.commit?.replyText).toBe(ANSWER_LEAK_SAFE_HINT);
    expect(tokens(next.events)).not.toMatch(standalone(A));
    const sent = JSON.stringify(next.t.gateway.requests.filter((q) => q.tier === 'main'));
    expect(sent).not.toMatch(standalone(A));
    expect(sent).not.toMatch(standalone(B));
    expect(next.help).toBeDefined();
    expect(next.help).not.toHaveProperty('practiceCarriedKey');
    expect(next.help?.answerKey).toEqual([B]);
  });

  it('turn 2 that never writes a key: no key on any tier, and the carried key is dropped', async () => {
    const { next } = await skipThenNext([main(say('Try the next step.'), used)]);
    expect(next.commit?.replyText).toBe('Try the next step.');
    expectNoLeak(next, { prompts: [], keys: [A, B], tiers: 'all' });
    expect(next.help).not.toHaveProperty('practiceCarriedKey');
  });

  it('an item that replaces a solved one (no key held) carries nothing', async () => {
    const r = await turn([main(callItem, used), main(say('Next one.'), used)], {
      build: () => Promise.resolve(builtWith({ ...loadedA, answerKey: [] })),
    });
    expect(r.help?.answerKey).toEqual([B]);
    expect(r.help).not.toHaveProperty('practiceCarriedKey');
  });

  it('a loaded non-practice answerKey (no production path today) is carried the same way (5.6d)', async () => {
    const r = await turn([main(callItem, used), main(say('Next one.'), used)], {
      build: () =>
        Promise.resolve(
          builtWith({
            answerKey: [A],
            practiceModuleId: loadedA.practiceModuleId,
            practiceServed: loadedA.practiceServed,
          }),
        ),
    });
    expect(r.help?.answerKey).toEqual([B]);
    expect(r.help?.practiceCarriedKey).toEqual([A]);
  });

  it('a loaded carried key is not carried again when another item goes out', async () => {
    const r = await turn([main(callItem, used), main(say('Next one.'), used)], {
      build: () =>
        Promise.resolve(builtWith({ ...loadedA, answerKey: [], practiceCarriedKey: ['9999'] })),
    });
    expect(r.help).not.toHaveProperty('practiceCarriedKey');
  });

  it('a key the new item shares with the skipped one is not carried', async () => {
    const shared: DemoPracticeRecord[] = RECORDS.map((rec) =>
      rec.item.id === 'fx:linear:1:b' ? { ...rec, answerKey: [B, 'shared'] } : rec,
    );
    const r = await turn([main(callItem, used), main(say('Next one.'), used)], {
      records: shared,
      build: () => Promise.resolve(builtWith({ ...loadedA, answerKey: [A, 'shared'] })),
    });
    expect(r.help?.answerKey).toEqual([B, 'shared']);
    expect(r.help?.practiceCarriedKey).toEqual([A]);
  });

  it('a 65-entry skipped key saves whole and every entry stays guarded next turn (5.6c fix round)', async () => {
    const many = Array.from({ length: 65 }, (_, i) => String(7000 + i));
    const first = await turn([main(callItem, used), main(say('A new one.'), used)], {
      decision: { ...decision, mustNotReveal: many },
      build: () => Promise.resolve(builtWith({ ...loadedA, answerKey: many })),
    });
    expect(first.help?.answerKey).toEqual([B]);
    expect(first.help?.practiceCarriedKey).toEqual(many);
    const saved = first.commit?.next;
    if (saved === undefined) throw new Error('turn 1 saved no state');
    // Before the fix the schema capped carried entries at 64, so this threw and nothing was saved.
    const stored = serializeSessionHelp(saved);
    expect(stored.practiceCarriedKey).toEqual(many);
    for (const key of [many[0] ?? '', many[64] ?? '']) {
      const next = await turn([main(say('Last time '), say(`it was ${key}. `), used)], {
        realDecide: true,
        build: () =>
          Promise.resolve(
            builtWith(saved.help, { helpRung: 0, retrieved: [{ ...demoChunk, score: 0.9 }] }),
          ),
      });
      expect(next.commit?.replyText).toBe(ANSWER_LEAK_SAFE_HINT);
      expect(tokens(next.events)).not.toMatch(standalone(key));
      const sent = JSON.stringify(next.t.gateway.requests.filter((q) => q.tier === 'main'));
      for (const k of many) expect(sent).not.toMatch(standalone(k));
    }
  });

  it('a turn that saves no state leaves the stored carried key in place (ADR-0011 §6)', async () => {
    // decide and its fallback both fail: the turn ends in an error and commit saves no `next`,
    // so the stored blob, carried key included, is not overwritten (fail closed).
    const r = await turn([main(say('never sent'), used)], {
      decide: {
        run: () => Promise.reject(new Error('decide down')),
        fallback: () => {
          throw new Error('fallback down');
        },
      },
      build: () => Promise.resolve(builtWith({ ...loadedA, answerKey: [B], practiceCarriedKey: [A] })),
    });
    expect(r.events.at(-1)).toMatchObject({ type: 'error' });
    expect(r.commit).toBeDefined();
    expect(r.commit).not.toHaveProperty('next');
  });
});
