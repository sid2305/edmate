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
import { copyHelp, INITIAL_HELP_STATE } from '../pedagogy/helpState.js';
import { driveTurn } from '../testing/driveTurn.js';
import { type JudgeVerdict } from '../testing/groundingJudge.js';
import { memoryTeacherQuestionStore } from '../testing/memoryPorts.js';
import { FIXTURE_PROMPT_PACK_VERSION } from '../testing/promptPackFixtures.js';
import { testDecideResult, testDeps, testSteps } from '../testing/testSteps.js';
import { runTurn } from './runner.js';
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
}

async function turn(o: Turn) {
  const store = memoryTeacherQuestionStore(o.storeFails === true ? { fail: true } : {});
  const t = testDeps({
    script: { stream: [{ match: (r) => r.tier === 'main', steps: [...o.reply.map(say), used] }] },
    judge: o.judge,
    overrides: { teacherQuestions: store },
  });
  const help = copyHelp(INITIAL_HELP_STATE);
  if (o.groundingAsks !== undefined) help.groundingAsks = o.groundingAsks;
  const decision = o.decision ?? explain;
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
      }),
    decide: {
      run: () =>
        Promise.resolve(
          testDecideResult(decision, {
            sources: [demoChunkScored.source],
            next: { rung: decision.rung, help },
          }),
        ),
    },
    generate: defaultSteps.generate,
    postGuard: defaultSteps.postGuard,
  });
  const input: TurnInput = { ...demoTurnInput, text: 'What does // do? Ask me@example.com.' };
  const { events, result } = await driveTurn(runTurn(input, { deps: t.deps, steps }), t.clock);
  return { events, result, store, commit: steps.commits[0], judged: t.judged };
}

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

  it('a failing store: no event, the turn still replies; commit is told to open it', async () => {
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
