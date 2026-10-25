// Task 5.6b Phase C through the runner: the real generate (tool loop, stream gate) and the real
// postGuard with `practice.next_item`, serving an mcq and a code_output item. A re-show of the
// active item is delivered, on the issuing turn and on later turns (the item resolved through the
// entitled registry, even when the practice tool is not offered); every real leak gets the safe
// hint. Items and keys are synthetic; the scripted gateway stands in for every model.
import type { ModelChunk, PedagogyDecision, TurnEvent, TurnInput } from '@edmate/contracts';
import { demoChunk, demoPedagogyDecision, demoTurnInput, usageMain } from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { ANSWER_LEAK_SAFE_HINT } from '../guardrails/answerLeak.js';
import type { HelpState } from '../pedagogy/helpState.js';
import { classifyAttempt } from '../routing/classify.js';
import { driveTurn } from '../testing/driveTurn.js';
import { memoryToolRegistry } from '../testing/memoryToolRegistry.js';
import { FIXTURE_PROMPT_PACK_VERSION } from '../testing/promptPackFixtures.js';
import type { ScriptedStreamCall } from '../testing/scriptedGateway.js';
import { testDecideResult, testDeps, testSteps } from '../testing/testSteps.js';
import { type DemoPracticeRecord, demoPracticeBank } from '../tools/demoPracticeBank.js';
import { practiceNextItemTool } from '../tools/practice.js';
import { generatedPrompt, parseGeneratedId } from '../tools/practiceItems.js';
import { runTurn } from './runner.js';
import { defaultSteps } from './steps/index.js';
import type { BuiltContext, Steps } from './types.js';

const say = (text: string) => ({ type: 'text', text }) satisfies ModelChunk;
const used = { type: 'usage', usage: usageMain } satisfies ModelChunk;
const call = (id: string) =>
  ({ type: 'tool_call', id, name: 'practice.next_item', args: {} }) satisfies ModelChunk;
const main = (...steps: ScriptedStreamCall['steps']): ScriptedStreamCall => ({
  match: (r) => r.tier === 'main',
  steps,
});

const T = 'tch_test_01';
const mcqRecord = (
  id: string,
  moduleId: string,
  prompt: string,
  options: string[],
  key: string,
): DemoPracticeRecord => ({
  item: { id, teacherId: T, topicId: 'kinds', moduleId, level: 1, kind: 'mcq', prompt, options },
  answerKey: [key],
});

/** The demo-style MCQ: a concept prompt, key B, the correct option's text "7". */
const MCQ = mcqRecord(
  'fx:prime:1:a',
  'mod_test_01',
  'Which of these numbers is prime?',
  ['A) 6', 'B) 7', 'C) 8'],
  'B',
);
/** An MCQ whose correct option is listed first (key A). */
const MCQ_A = mcqRecord(
  'fx:loop:1:a',
  'mod_test_01',
  'Which keyword stops a loop early?',
  ['A) break', 'B) continue', 'C) pass'],
  'A',
);
/** A 3-line code_output prompt whose output ("4") is on line 2. */
const CODE_PROMPT = 'What does this code print?\nx = 4\nprint(x)';
const CODE: DemoPracticeRecord = {
  item: {
    id: 'fx:code:1:a',
    teacherId: T,
    topicId: 'kinds',
    moduleId: 'mod_test_01',
    level: 1,
    kind: 'code_output',
    prompt: CODE_PROMPT,
  },
  answerKey: ['4'],
};
const RECORDS = [MCQ, MCQ_A, CODE];

const listing = (r: DemoPracticeRecord) => [r.item.prompt, ...(r.item.options ?? [])].join('\n');

/** Pieces of `text`, `n` units each (a stream split mid-word and mid-line). */
const pieces = (text: string, n: number) =>
  Array.from({ length: Math.ceil(text.length / n) }, (_, k) => say(text.slice(k * n, k * n + n)));

const fixtureEntitle: Steps['entitle'] = async (env) => {
  const e = await testSteps().entitle(env);
  return { ...e, agent: { ...e.agent, promptPackVersion: FIXTURE_PROMPT_PACK_VERSION } };
};

const issuing: PedagogyDecision = {
  ...demoPedagogyDecision,
  move: 'ask',
  mustNotReveal: [],
  tools: ['practice.next_item'],
};

/** A later turn's decision: the practice tool is NOT offered; the held key is guarded (policy). */
const laterDecision = (keys: readonly string[]): PedagogyDecision => ({
  ...demoPedagogyDecision,
  move: 'ask',
  mustNotReveal: [...keys],
  tools: [],
});

function builtWith(help: Partial<HelpState>): BuiltContext {
  return {
    profile: { studentId: 'stu_test_01', teacherId: T, lang: 'en', mastery: {}, mistakes: [] },
    history: [],
    retrieved: [{ ...demoChunk, score: 0.9 }],
    lockedHit: false,
    helpRung: 2,
    helpState: { stuckTurns: 0, attemptLogged: false, pendingCheck: false, answerKey: [], ...help },
  };
}

async function turn(
  stream: ScriptedStreamCall[],
  o: {
    records?: readonly DemoPracticeRecord[];
    decision?: PedagogyDecision;
    help?: Partial<HelpState>;
    input?: TurnInput;
  } = {},
) {
  const tools = memoryToolRegistry([practiceNextItemTool(demoPracticeBank(o.records ?? RECORDS))]);
  const t = testDeps({ script: { stream }, overrides: { tools }, judge: 'grounded' });
  const help = o.help;
  const steps = testSteps({
    entitle: fixtureEntitle,
    decide: { run: () => Promise.resolve(testDecideResult(o.decision ?? issuing)) },
    generate: defaultSteps.generate,
    postGuard: defaultSteps.postGuard,
    ...(help === undefined ? {} : { buildContext: () => Promise.resolve(builtWith(help)) }),
  });
  const { events, result } = await driveTurn(
    runTurn(o.input ?? demoTurnInput, { deps: t.deps, steps }),
    t.clock,
  );
  const commit = steps.commits[0];
  return { events, result, commit, help: commit?.next?.help, t };
}

const tokens = (events: TurnEvent[]) =>
  events.map((e) => (e.type === 'token' ? e.text : '')).join('');
const skillPrompts = (events: TurnEvent[]) =>
  events.flatMap((e) =>
    e.type === 'skill' ? [(e.payload as { prompt: string }).prompt] : [],
  );

/** The loaded state of a later turn: `rec` is the active item, its key held. */
const holding = (rec: DemoPracticeRecord): Partial<HelpState> => ({
  answerKey: [...rec.answerKey],
  practiceItemId: rec.item.id,
  practiceModuleId: rec.item.moduleId,
  practiceServed: [rec.item.id],
});

async function issue(rec: DemoPracticeRecord, reply: ScriptedStreamCall['steps']) {
  return turn([main(call('c1'), used), main(...reply, used)], { records: [rec] });
}
async function later(rec: DemoPracticeRecord, reply: ScriptedStreamCall['steps'], input?: string) {
  return turn([main(...reply, used)], {
    records: RECORDS,
    help: holding(rec),
    decision: laterDecision(rec.answerKey),
    ...(input === undefined ? {} : { input: { ...demoTurnInput, text: input } }),
  });
}

/**
 * A later turn `route` grades `attempt: 'correct'` for the held item (5.6f): a narrow local
 * override of `route.run` (the suite's default always returns `attempt: 'none'`), with `decide`
 * stubbed to the `mustNotReveal` the real `decidePolicy` would now compute (empty, unless a
 * carried key from an unrelated item is passed). This exercises the runner's `items`/
 * `practiceKeys` fix directly; `policy.test.ts` separately proves the policy half.
 */
/** A schema-valid raw stored help blob (pedagogy/helpState.ts's SessionHelpSchema) holding `keys`. */
const storedHelp = (keys: readonly string[]) => ({
  v: 1,
  rung: 0,
  stuckTurns: 0,
  attemptLogged: false,
  pendingCheck: false,
  answerKey: [...keys],
});

async function laterCorrect(
  rec: DemoPracticeRecord,
  reply: ScriptedStreamCall['steps'],
  input: string,
  o: { carried?: readonly string[] } = {},
) {
  const tools = memoryToolRegistry([practiceNextItemTool(demoPracticeBank(RECORDS))]);
  const t = testDeps({ script: { stream: [main(...reply, used)] }, overrides: { tools }, judge: 'grounded' });
  const carried = o.carried ?? [];
  const help = { ...holding(rec), ...(carried.length > 0 ? { practiceCarriedKey: [...carried] } : {}) };
  const attempt = classifyAttempt({ text: input, kind: 'message' }, storedHelp(rec.answerKey));
  const decision: PedagogyDecision = {
    ...demoPedagogyDecision,
    move: 'ask',
    mustNotReveal: attempt === 'correct' ? [...carried] : [...rec.answerKey, ...carried],
    tools: [],
  };
  const steps = testSteps({
    entitle: fixtureEntitle,
    route: { run: () => Promise.resolve({ intent: 'on_task', attempt, usage: [] }) },
    decide: { run: () => Promise.resolve(testDecideResult(decision)) },
    generate: defaultSteps.generate,
    postGuard: defaultSteps.postGuard,
    buildContext: () => Promise.resolve(builtWith(help)),
  });
  const { events, result } = await driveTurn(
    runTurn({ ...demoTurnInput, text: input }, { deps: t.deps, steps }),
    t.clock,
  );
  const commit = steps.commits[0];
  return { events, result, commit, help: commit?.next?.help, t };
}

const expectDelivered = (r: Awaited<ReturnType<typeof turn>>, text: string) => {
  expect(r.commit?.replyText).toBe(text);
  expect(r.result.trace?.guards).not.toContainEqual(
    expect.objectContaining({ name: 'answerLeak', ok: false }),
  );
};
const expectHint = (r: Awaited<ReturnType<typeof turn>>, leak: string) => {
  expect(r.commit?.replyText).toBe(ANSWER_LEAK_SAFE_HINT);
  expect(tokens(r.events)).not.toContain(leak.trim());
};

const RESHOWN = [
  ['the demo MCQ (key B)', MCQ, `Here it is again.\n${listing(MCQ)}`],
  ['an MCQ whose correct option is listed first (key A)', MCQ_A, `Here it is again.\n${listing(MCQ_A)}`],
  ['a 3-line code_output prompt, its output on line 2', CODE, `Here it is again.\n${CODE_PROMPT}`],
] as const;

describe('5.6b: both kinds are served and re-shown on the issuing turn without a false block', () => {
  it.each(RESHOWN)('%s: the item goes out and the model restates it whole', async (_n, rec, text) => {
    const r = await issue(rec, [say(text)]);
    expect(skillPrompts(r.events)).toEqual([rec.item.prompt]);
    expect(r.help).toMatchObject({ practiceItemId: rec.item.id, answerKey: rec.answerKey });
    expectDelivered(r, text);
    expect(tokens(r.events)).toBe(text);
  });

  it.each(RESHOWN)('%s: the same re-show split across 3-unit chunks', async (_n, rec, text) => {
    const r = await issue(rec, pieces(text, 3));
    expectDelivered(r, text);
    expect(tokens(r.events)).toBe(text);
  });

  it('the generated sum "What is a + b?" restated on its issuing turn is delivered', async () => {
    // A module with no bank record: the generator serves the item.
    const g = await turn([main(call('c1'), used), main(say('Ok.'), used)], { records: [] });
    const prompt = skillPrompts(g.events)[0] ?? '';
    expect(prompt).toMatch(/^What is \d+ [+-] \d+\?$/u);
    for (const steps of [[say(`Here is your problem. ${prompt}`)], pieces(`Here is your problem. ${prompt}`, 2)]) {
      const again = await turn([main(call('c1'), used), main(...steps, used)], { records: [] });
      expectDelivered(again, `Here is your problem. ${prompt}`);
    }
  });

  it('two items issued in one turn: both re-shown in the reply are delivered', async () => {
    const r = await turn(
      [main(call('c1'), call('c2'), used), main(say('Two for you.'), used)],
      { records: [MCQ] },
    );
    const [first, second] = skillPrompts(r.events);
    expect(first).toBe(MCQ.item.prompt);
    expect(second).toMatch(/^What is \d+ [+-] \d+\?$/u);
    const text = `First:\n${listing(MCQ)}\nThen: ${second ?? ''}`;
    const again = await turn(
      [main(call('c1'), call('c2'), used), main(...pieces(text, 5), used)],
      { records: [MCQ] },
    );
    expectDelivered(again, text);
  });
});

describe('5.6b: re-shown on a later turn (the item resolved through the entitled registry)', () => {
  it.each(RESHOWN)('%s: the tool is not offered, the item is re-shown and delivered', async (_n, rec, text) => {
    const r = await later(rec, [say(text)]);
    // The practice tool was not offered to the model this turn.
    const req = r.t.gateway.requests.find((q) => q.tier === 'main');
    expect(req?.tools ?? []).toEqual([]);
    expectDelivered(r, text);
    expect(r.help?.practiceItemId).toBe(rec.item.id);
  });

  it.each(RESHOWN)('%s: the later-turn re-show split across 4-unit chunks', async (_n, rec, text) => {
    const r = await later(rec, pieces(text, 4));
    expectDelivered(r, text);
  });

  it('the generated sum, held from an earlier turn, restated is delivered', async () => {
    const g = await turn([main(call('c1'), used), main(say('Ok.'), used)], { records: [] });
    const id = g.help?.practiceItemId ?? '';
    const parsed = parseGeneratedId(id);
    if (parsed === undefined) throw new Error('no generated item');
    const prompt = generatedPrompt(parsed);
    const held = { item: { ...MCQ.item, id }, answerKey: g.help?.answerKey ?? [] };
    const text = `Your problem: ${prompt}`;
    for (const steps of [[say(text)], pieces(text, 3)]) {
      const r = await turn([main(...steps, used)], {
        records: [],
        help: { ...holding(held), practiceModuleId: parsed.moduleId },
        decision: laterDecision(held.answerKey),
      });
      expectDelivered(r, text);
    }
  });

  it('an item outside the entitlement is not resolved: its re-shown listing gets the hint (Q6)', async () => {
    const foreign = { ...MCQ, item: { ...MCQ.item, moduleId: 'mod_other' } };
    const r = await turn([main(say(listing(MCQ)), used)], {
      records: [foreign],
      help: holding(foreign),
      decision: laterDecision(['B']),
    });
    expect(r.commit?.replyText).toBe(ANSWER_LEAK_SAFE_HINT);
  });
});

describe('5.6b: a throwing activeItem hook', () => {
  it('is reported and treated as unresolved: the re-shown listing gets the hint (fail closed)', async () => {
    const real = practiceNextItemTool(demoPracticeBank(RECORDS));
    const broken = {
      ...real,
      activeItem: () => {
        throw new Error('bank down');
      },
    };
    const t = testDeps({
      script: { stream: [main(say(listing(MCQ)), used)] },
      overrides: { tools: memoryToolRegistry([broken]) },
      judge: 'grounded',
    });
    const steps = testSteps({
      entitle: fixtureEntitle,
      decide: { run: () => Promise.resolve(testDecideResult(laterDecision(['B']))) },
      generate: defaultSteps.generate,
      postGuard: defaultSteps.postGuard,
      buildContext: () => Promise.resolve(builtWith(holding(MCQ))),
    });
    const { result } = await driveTurn(runTurn(demoTurnInput, { deps: t.deps, steps }), t.clock);
    expect(steps.commits[0]?.replyText).toBe(ANSWER_LEAK_SAFE_HINT);
    expect(result.background).toContainEqual({ task: 'runner', error: new Error('bank down') });
  });
});

describe('5.6b: answered without a false block', () => {
  it('a correct "B", then a confirming reply that does not restate the key, is delivered', async () => {
    const r = await later(MCQ, [say("Nice work, that's right.")], 'B');
    expectDelivered(r, "Nice work, that's right.");
  });

  it('a correct code_output answer, then a confirming reply, is delivered', async () => {
    const r = await later(CODE, [say('Nice work, that is right.')], '4');
    expectDelivered(r, 'Nice work, that is right.');
  });

  it('a wrong answer whose reply re-shows the item is delivered', async () => {
    const text = `Not quite. Look again:\n${listing(MCQ)}`;
    const r = await later(MCQ, pieces(text, 6), 'A');
    expectDelivered(r, text);
  });

  it('5.6f: a correct "B" followed by "Yes, B is right!" is delivered', async () => {
    const r = await laterCorrect(MCQ, [say('Yes, B is right!')], 'B');
    expectDelivered(r, 'Yes, B is right!');
  });
});

describe('5.6f: release the practice key on a turn graded correct', () => {
  it('a correct "B" followed by "Yes, B is right!" is delivered (confirmation names the key)', async () => {
    const r = await laterCorrect(MCQ, [say('Yes, B is right!')], 'B');
    expectDelivered(r, 'Yes, B is right!');
  });

  it('a wrong answer ("A") followed by "Yes, B is right!" still gets the safe hint (regression)', async () => {
    const r = await later(MCQ, [say('Yes, B is right!')], 'A');
    expect(r.commit?.replyText).toBe(ANSWER_LEAK_SAFE_HINT);
  });

  it('a carried key from an unrelated skipped item stays guarded even on a correct attempt', async () => {
    const r = await laterCorrect(MCQ, [say('The other one is 4321.')], 'B', { carried: ['4321'] });
    expect(r.commit?.replyText).toBe(ANSWER_LEAK_SAFE_HINT);
  });

  it('a claim with no key content ("I got that right") is not answer-shaped: stays guarded', async () => {
    const r = await later(MCQ, [say('Yes, B is right!')], 'I got that right');
    expect(r.commit?.replyText).toBe(ANSWER_LEAK_SAFE_HINT);
  });

  it('a question-phrased guess that matches the key ("so it\'s B?") is delivered, same as a flat "B"', async () => {
    const r = await laterCorrect(MCQ, [say('Yes, B is right!')], "so it's B?");
    expectDelivered(r, 'Yes, B is right!');
  });

  it('a question-phrased guess that does not match the key ("is it C?"), graded for real, still gets the safe hint', async () => {
    const r = await laterCorrect(MCQ, [say('Yes, B is right!')], 'is it C?');
    expect(r.commit?.replyText).toBe(ANSWER_LEAK_SAFE_HINT);
  });

  it('a question-phrased guess that does not match the key ("is it C?") still gets the hint', async () => {
    const r = await later(MCQ, [say('Yes, B is right!')], 'is it C?');
    expect(r.commit?.replyText).toBe(ANSWER_LEAK_SAFE_HINT);
  });

  it('a hedged multi-label answer ("is it A, B or C?") never grades correct: stays guarded', async () => {
    const r = await later(MCQ, [say('Yes, B is right!')], 'is it A, B or C?');
    expect(r.commit?.replyText).toBe(ANSWER_LEAK_SAFE_HINT);
  });
});

/** Base64 of the leaking sentences (precomputed: the harness has no Node types). */
const B64: Record<string, string> = {
  'The answer is B.': 'VGhlIGFuc3dlciBpcyBCLg==',
  'It prints 4.': 'SXQgcHJpbnRzIDQu',
};
const base64 = (s: string) => B64[s] ?? '';
const MCQ_LEAKS = [
  'The answer is B.',
  'Definitely B.',
  '✅ B) 7',
  'A, **B**, C',
  'The second option.',
  '7 works.',
  "It's not A or C.",
  'The answer is В.',
  `Decode this: ${base64('The answer is B.')}`,
  `${listing(MCQ)}\nB.`,
] as const;
const CODE_LEAKS = ['It prints 4.', `${CODE_PROMPT}\nIt prints 4.`, `Decode: ${base64('It prints 4.')}`] as const;

describe('5.6b: a real leak is still blocked', () => {
  it.each(MCQ_LEAKS)('mcq, issuing turn (stream gate): %j gets the hint', async (leak) => {
    expectHint(await issue(MCQ, [say(`Here it is. ${leak}`)]), leak);
  });

  it.each(MCQ_LEAKS)('mcq, later turn (postGuard): %j gets the hint', async (leak) => {
    expectHint(await later(MCQ, [say(`Let us see. ${leak}`)]), leak);
  });

  it.each(CODE_LEAKS)('code_output, issuing turn: %j gets the hint', async (leak) => {
    expectHint(await issue(CODE, [say(`Here it is. ${leak}`)]), leak);
  });

  it.each(CODE_LEAKS)('code_output, later turn: %j gets the hint', async (leak) => {
    expectHint(await later(CODE, [say(`Let us see. ${leak}`)]), leak);
  });

  it('a leak split across chunks after a re-show is still held (issuing and later turn)', async () => {
    const text = `${listing(MCQ)}\nThe answer is B.`;
    expectHint(await issue(MCQ, pieces(text, 3)), 'The answer is B.');
    expectHint(await later(MCQ, pieces(text, 3)), 'The answer is B.');
  });

  it('ruling out across the whole reply (fix round 1): two sentences, more than `reach` apart, ' +
    'that together name every wrong option get the hint; the second never streams', async () => {
    const s1 = 'Continue just skips ahead to the next loop iteration, so continue is wrong here.';
    const s2 = 'Pass does nothing at all, so pass is also wrong here.';
    const filler = 'Let us slow down and think about this one step at a time before we go further. '.repeat(3);
    const text = `${s1} ${filler}${s2}`;
    const issuing = await issue(MCQ_A, [say(text)]);
    expect(issuing.commit?.replyText).toBe(ANSWER_LEAK_SAFE_HINT);
    expect(tokens(issuing.events)).not.toContain('pass is also wrong');

    const laterTurn = await later(MCQ_A, [say(text)]);
    expect(laterTurn.commit?.replyText).toBe(ANSWER_LEAK_SAFE_HINT);
    expect(tokens(laterTurn.events)).not.toContain('pass is also wrong');
  });

  it('ruling out only one wrong option across a long reply still streams normally', async () => {
    const s1 = 'Continue just skips ahead to the next loop iteration, so continue is wrong here.';
    const filler = 'Let us slow down and think about this one step at a time before we go further. '.repeat(3);
    const text = `${s1} ${filler}All good so far.`;
    expectDelivered(await issue(MCQ_A, [say(text)]), text);
    expectDelivered(await later(MCQ_A, [say(text)]), text);
  });

  it('the generated sum restated and then answered gets the hint', async () => {
    const g = await turn([main(call('c1'), used), main(say('Ok.'), used)], { records: [] });
    const prompt = skillPrompts(g.events)[0] ?? '';
    const key = g.help?.answerKey[0] ?? '';
    const r = await turn([main(call('c1'), used), main(say(`${prompt} It's ${key}.`), used)], {
      records: [],
    });
    expect(r.commit?.replyText).toBe(ANSWER_LEAK_SAFE_HINT);
  });
});
