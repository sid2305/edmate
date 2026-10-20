// Task 4.7 through the runner: the real generate and postGuard with grounding, a fake judge. An
// ungrounded reply becomes the ask-teacher reply and opens one TeacherQuestion (scrubbed text,
// the shared idempotent open), capped per session; a held reply streams only once checked.
import type { ModelChunk, PedagogyDecision, TurnEvent, TurnInput } from '@edmate/contracts';
import {
  demoChunkScored,
  demoPedagogyDecision,
  demoTurnInput,
  learnerProfileNew,
  usageMain,
} from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { askTeacherReplyText } from '../guardrails/grounding.js';
import { copyHelp, INITIAL_HELP_STATE, parseSessionHelp } from '../pedagogy/helpState.js';
import { driveTurn } from '../testing/driveTurn.js';
import { type JudgeVerdict } from '../testing/groundingJudge.js';
import {
  memorySessionStateStore,
  memoryTeacherQuestionStore,
  memoryTranscriptStore,
} from '../testing/memoryPorts.js';
import type { StreamStep } from '../testing/scriptedGateway.js';
import { FIXTURE_PROMPT_PACK_VERSION } from '../testing/promptPackFixtures.js';
import { testDecideResult, testDeps, testSteps } from '../testing/testSteps.js';
import { runTurn, STREAMED_REPLACED } from './runner.js';
import { GROUNDING_ASKS_PER_SESSION } from './spec.js';
import { defaultSteps } from './steps/index.js';
import type { Steps } from './types.js';

const ASK = askTeacherReplyText();
const NOTES = 'Floor division divides, then rounds down to a whole number.';
const say = (text: string) => ({ type: 'text', text }) satisfies ModelChunk;
const used = { type: 'usage', usage: usageMain } satisfies ModelChunk;
const explain: PedagogyDecision = { ...demoPedagogyDecision, move: 'explain', mustNotReveal: [] };
const askTeacher: PedagogyDecision = { ...explain, move: 'ask_teacher', rung: 0, tools: [] };
const SCRUBBED = 'What does // do? Ask [EMAIL].';

const fixtureEntitle: Steps['entitle'] = async (env) => {
  const e = await testSteps().entitle(env);
  return { ...e, agent: { ...e.agent, promptPackVersion: FIXTURE_PROMPT_PACK_VERSION } };
};

interface Turn {
  reply: string[];
  judge: JudgeVerdict | 'grounded' | 'ungrounded';
  decision?: PedagogyDecision;
  score?: number;
  groundingAsks?: number;
  storeFails?: boolean;
  /** The real commit step, with in-memory stores (fix round 1). */
  realCommit?: boolean;
  /** decide's `next` rebuilds the help state without the count, as the ladder does. */
  decideDropsAsks?: boolean;
  /** Both generate attempts fail. */
  mainFails?: boolean;
  /** A shared TeacherQuestion store across turns. */
  store?: ReturnType<typeof memoryTeacherQuestionStore>;
  /** buildContext could not read the stored help state (4.6b: no help state is saved). */
  unreadableHelp?: boolean;
}

async function turn(o: Turn) {
  const store = o.store ?? memoryTeacherQuestionStore(o.storeFails === true ? { fail: true } : {});
  const sessionState = memorySessionStateStore();
  const main = o.mainFails === true ? [fail, fail] : [[...o.reply.map(say), used]];
  const t = testDeps({
    script: { stream: main.map((steps) => ({ match: (r) => r.tier === 'main', steps })) },
    judge: o.judge,
    overrides: {
      teacherQuestions: store,
      ...(o.realCommit === true ? { sessionState, transcripts: memoryTranscriptStore() } : {}),
    },
  });
  const help = copyHelp(INITIAL_HELP_STATE);
  if (o.groundingAsks !== undefined) help.groundingAsks = o.groundingAsks;
  const decision = o.decision ?? explain;
  const nextHelp = o.decideDropsAsks === true ? copyHelp(INITIAL_HELP_STATE) : help;
  const steps = testSteps({
    entitle: fixtureEntitle,
    scrub: () => Promise.resolve({ text: SCRUBBED, guards: [] }),
    buildContext: () =>
      Promise.resolve({
        profile: learnerProfileNew,
        history: [],
        retrieved: [{ ...demoChunkScored, text: NOTES, score: o.score ?? 0.8 }],
        lockedHit: false,
        helpRung: 0,
        helpState: help,
        ...(o.unreadableHelp === true ? { helpStateUnreadable: true } : {}),
      }),
    decide: {
      run: () =>
        Promise.resolve(
          testDecideResult(decision, {
            sources: [demoChunkScored.source],
            next: { rung: decision.rung, help: nextHelp },
          }),
        ),
    },
    generate: defaultSteps.generate,
    postGuard: defaultSteps.postGuard,
    ...(o.realCommit === true ? { commit: defaultSteps.commit } : {}),
  });
  const input: TurnInput = { ...demoTurnInput, text: 'What does // do? Ask me@example.com.' };
  const { events, result } = await driveTurn(runTurn(input, { deps: t.deps, steps }), t.clock);
  const saved = sessionState.saved.at(-1)?.helpState;
  return {
    events,
    result,
    store,
    commit: steps.commits[0],
    judged: t.judged,
    savedAsks: saved === undefined ? undefined : (parseSessionHelp(saved).help.groundingAsks ?? 0),
    savedHelp: saved,
  };
}

const fail = [{ type: 'error', code: 'provider_error' }] satisfies StreamStep[];

const types = (events: TurnEvent[]) => events.map((e) => e.type);
/** What the student saw stream in before any replace. */
const streamed = (events: TurnEvent[]) => {
  const at = events.findIndex((e) => e.type === 'replace');
  return events
    .slice(0, at < 0 ? undefined : at)
    .map((e) => (e.type === 'token' ? e.text : ''))
    .join('');
};

describe('runner + grounding', () => {
  it('a grounded, well-covered reply streams as before: no replace, no TeacherQuestion', async () => {
    const r = await turn({ reply: ['Floor division ', 'rounds down [1].'], judge: 'grounded' });
    // The sentence gate shows the sentence once it is complete.
    expect(types(r.events)).toEqual(['token', 'sources', 'done']);
    expect(r.store.opened).toEqual([]);
    expect(r.commit?.replyText).toBe('Floor division rounds down [1].');
    expect(r.commit).not.toHaveProperty('escalateToTeacher');
    expect(r.commit?.next?.help).not.toHaveProperty('groundingAsks');
    expect(r.judged).toHaveLength(1);
  });

  it('an ungrounded reply: replaced by the ask-teacher reply, one TeacherQuestion with the scrubbed text, counted', async () => {
    const r = await turn({ reply: ['Python 4 makes // exact.'], judge: 'ungrounded' });
    expect(r.events).toEqual([
      { type: 'token', text: 'Python 4 makes // exact.' },
      { type: 'replace', text: '' },
      { type: 'replace', text: ASK },
      { type: 'teacher_question', questionId: 'tq_mem_1' },
      { type: 'done', messageId: 'message_1', usage: expect.anything() as unknown },
    ]);
    expect(r.store.opened).toHaveLength(1);
    expect(r.store.opened[0]?.text).toBe(SCRUBBED);
    expect(r.commit).toMatchObject({
      replyText: ASK,
      teacherQuestionId: 'tq_mem_1',
      escalateToTeacher: true,
    });
    expect(r.commit?.next?.help.groundingAsks).toBe(1);
  });

  it('an ask_teacher turn whose reply is ungrounded: still one question per turn (decide’s)', async () => {
    const r = await turn({
      reply: ['Sure! Use @my_decorator above the function.'],
      judge: 'ungrounded',
      decision: askTeacher,
    });
    expect(r.store.opened).toHaveLength(1);
    expect(types(r.events).filter((t) => t === 'teacher_question')).toHaveLength(1);
    // Held: the invented reply never reached the student's screen.
    expect(streamed(r.events)).toBe('');
    expect(r.events.at(-2)).toEqual({ type: 'replace', text: ASK });
    expect(r.commit).not.toHaveProperty('escalateToTeacher');
    expect(r.commit?.next?.help).not.toHaveProperty('groundingAsks');
  });

  it(`at the cap (${String(GROUNDING_ASKS_PER_SESSION)} per session) the student gets the ask-teacher reply only`, async () => {
    const r = await turn({
      reply: ['Python 4 makes // exact.'],
      judge: 'ungrounded',
      groundingAsks: GROUNDING_ASKS_PER_SESSION,
    });
    expect(r.store.opened).toEqual([]);
    expect(types(r.events)).not.toContain('teacher_question');
    expect(r.commit?.replyText).toBe(ASK);
    expect(r.commit).not.toHaveProperty('escalateToTeacher');
    expect(r.commit?.next?.help.groundingAsks).toBe(GROUNDING_ASKS_PER_SESSION);
    // One under the cap still opens, and reaches it.
    const last = await turn({
      reply: ['Python 4 makes // exact.'],
      judge: 'ungrounded',
      groundingAsks: GROUNDING_ASKS_PER_SESSION - 1,
    });
    expect(last.store.opened).toHaveLength(1);
    expect(last.commit?.next?.help.groundingAsks).toBe(GROUNDING_ASKS_PER_SESSION);
  });

  it('a failing store: no event, the turn still replies; commit is told to open it, uncounted', async () => {
    const r = await turn({
      reply: ['Python 4 makes // exact.'],
      judge: 'ungrounded',
      storeFails: true,
    });
    expect(types(r.events)).not.toContain('teacher_question');
    expect(r.events.at(-1)?.type).toBe('done');
    expect(r.result.background.map((b) => b.task)).toEqual(['teacher_question']);
    expect(r.commit).toMatchObject({ escalateToTeacher: true, replyText: ASK });
    expect(r.commit).not.toHaveProperty('teacherQuestionId');
    // Not counted: no question was opened (fix round 1).
    expect(r.commit?.next?.help).not.toHaveProperty('groundingAsks');
  });

  it('three turns whose live and fallback opens all fail leave the count at 0; a later turn still tries (fix round 1)', async () => {
    const store = memoryTeacherQuestionStore({ fail: true });
    let asks = 0;
    for (let i = 0; i < 3; i++) {
      const r = await turn({
        reply: ['Python 4 makes // exact.'],
        judge: 'ungrounded',
        store,
        groundingAsks: asks,
        realCommit: true,
      });
      expect(r.savedAsks).toBe(0);
      expect(r.result.background.map((b) => String(b.error))).toContain(
        'GroundingEscalationLost: grounding escalation lost: no TeacherQuestion opened (Error)',
      );
      asks = r.savedAsks ?? -1;
    }
    // Each turn tried twice (live, then commit's fallback); the fourth still tries.
    expect(store.opened).toHaveLength(6);
    await turn({
      reply: ['Python 4 makes // exact.'],
      judge: 'ungrounded',
      store,
      groundingAsks: asks,
      realCommit: true,
    });
    expect(store.opened).toHaveLength(8);
  });

  it('a successful open is counted once, by the runner; commit opens nothing more (fix round 1)', async () => {
    const r = await turn({
      reply: ['Python 4 makes // exact.'],
      judge: 'ungrounded',
      realCommit: true,
    });
    expect(r.store.opened).toHaveLength(1);
    expect(r.savedAsks).toBe(1);
  });

  it('with an unreadable help state (4.6b drops next), a grounding escalation still opens its question but saves no help state', async () => {
    for (const storeFails of [false, true]) {
      const r = await turn({
        reply: ['Python 4 makes // exact.'],
        judge: 'ungrounded',
        realCommit: true,
        unreadableHelp: true,
        storeFails,
      });
      // Live open, then (only when it failed) commit's fallback open.
      expect(r.store.opened).toHaveLength(storeFails ? 2 : 1);
      expect(r.savedAsks).toBeUndefined();
    }
  });

  it('a saved help state keeps both the grounding count and 4.6b’s stop flag', async () => {
    const r = await turn({
      reply: ['Python 4 makes // exact.'],
      judge: 'ungrounded',
      realCommit: true,
      groundingAsks: 1,
    });
    expect(r.savedAsks).toBe(2);
    expect(r.savedHelp).toMatchObject({ groundingAsks: 2, lockedStopped: false });
  });

  it('the count rides through a failed turn even when decide rebuilds the help state (fix round 1)', async () => {
    const r = await turn({
      reply: [],
      judge: 'grounded',
      mainFails: true,
      groundingAsks: 2,
      decideDropsAsks: true,
    });
    expect(r.events.at(-1)?.type).toBe('error');
    expect(r.commit?.next?.help.groundingAsks).toBe(2);
    const ok = await turn({
      reply: ['Floor division rounds down [1].'],
      judge: 'grounded',
      groundingAsks: 2,
      decideDropsAsks: true,
    });
    expect(ok.commit?.next?.help.groundingAsks).toBe(2);
  });

  it('a streamed reply grounding replaced is flagged in the trace, code only; a held one is not (fix round 1)', async () => {
    const flag = { name: 'grounding', ok: false, action: STREAMED_REPLACED };
    const shown = await turn({ reply: ['Python 4 makes // exact.'], judge: 'ungrounded' });
    expect(shown.result.trace?.guards).toContainEqual(flag);
    const held = await turn({
      reply: ['Python 4 makes // exact.'],
      judge: 'ungrounded',
      score: 0.55,
    });
    expect(held.result.trace?.guards).not.toContainEqual(flag);
  });

  it('a turn near the coverage threshold is held: nothing streams until postGuard passes it', async () => {
    const ok = await turn({
      reply: ['Floor ', 'division rounds down [1].'],
      judge: 'grounded',
      score: 0.55,
    });
    expect(types(ok.events)).toEqual(['sources', 'token', 'done']);
    expect(ok.events[1]).toEqual({ type: 'token', text: 'Floor division rounds down [1].' });
    const bad = await turn({
      reply: ['Python 4 makes // exact.'],
      judge: 'ungrounded',
      score: 0.55,
    });
    expect(streamed(bad.events)).toBe('');
    expect(bad.store.opened).toHaveLength(1);
  });
});
