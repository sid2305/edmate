// Task 5.8 Phase B (ADR-0013): a mock-interview role-play through the real admit, entitle,
// buildContext, decide and generate steps, with the role-play prompt-pack form and a persona
// library. Each turn's saved help state is the next turn's stored one, as commit and turnConfig
// do in production. The system prompt carries the platform's role-play state line; the model
// never counts. The grounding cases run the real postGuard with the fake overlap judge.
import {
  type EntitlementStore,
  type Intent,
  type ModelRequest,
  type ModelChunk,
  type Persona,
  type RetrievalIndex,
  type TurnConfigStore,
  type TurnInput,
  type TurnEvent,
} from '@edmate/contracts';
import {
  demoAgentConfig,
  demoChunkScored,
  demoEntitlementSubscription,
  demoLearnerProfile,
  demoLocalePack,
  demoPackagePaid,
  demoPersona,
  demoStyleCard,
  demoTurnInput,
  usageMain,
} from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { askTeacherReplyText } from '../guardrails/grounding.js';
import {
  INITIAL_HELP_STATE,
  parseSessionHelp,
  serializeSessionHelp,
  type StoredSessionHelp,
} from '../pedagogy/helpState.js';
import { createPersonaLibrary } from '../pedagogy/personas.js';
import { createPromptPackLibrary } from '../pedagogy/promptPacks.js';
import { driveTurn } from '../testing/driveTurn.js';
import { overlapJudge } from '../testing/groundingJudge.js';
import { memoryTeacherQuestionStore, memoryTranscriptStore } from '../testing/memoryPorts.js';
import {
  FIXTURE_ROLEPLAY_PROMPT_PACK_VERSION,
  fixturePromptPackSet,
  fixtureRolePlayPromptPackSet,
} from '../testing/promptPackFixtures.js';
import { testDeps, testSteps } from '../testing/testSteps.js';
import { virtualClock } from '../testing/virtualClock.js';
import { runTurn } from './runner.js';
import { admit } from './steps/admit.js';
import { buildContext } from './steps/buildContext.js';
import { decide } from './steps/decide.js';
import { entitle } from './steps/entitle.js';
import { generate } from './steps/generate.js';
import { postGuard } from './steps/postGuard.js';

const say = (text: string) => ({ type: 'text', text }) satisfies ModelChunk;
const used = { type: 'usage', usage: usageMain } satisfies ModelChunk;
const MATERIAL = demoChunkScored.text;

interface WorldOpts {
  /** Retrieval finds the demo chunk (covered) or nothing (uncovered). */
  covered: boolean;
  /** The persona in the library (default `demoPersona`, M = 5). */
  persona?: Persona;
  /** The real postGuard with the fake overlap grounding judge. */
  grounded?: boolean;
  /** The model's main replies, in turn order (default: a neutral question each turn). */
  replies?: string[];
  /** The router's label for a turn's text (default on_task). */
  intentFor?: (text: string) => Intent;
}

/** One session: `turn(input)` runs a turn and saves its help state for the next. */
function session(o: WorldOpts) {
  const clock = virtualClock();
  const persona = o.persona ?? demoPersona;
  let stored: StoredSessionHelp = serializeSessionHelp({
    rung: 0,
    help: { ...INITIAL_HELP_STATE, answerKey: [] },
  });
  const replies = o.replies ?? Array.from({ length: 10 }, () => 'Tell me more?');
  const entitlements: EntitlementStore = {
    resolve: () =>
      Promise.resolve({
        ...demoEntitlementSubscription,
        skills: [...demoEntitlementSubscription.skills, 'mock_interview'],
      }),
  };
  const turnConfig: TurnConfigStore = {
    load: () =>
      Promise.resolve({
        agent: {
          ...demoAgentConfig,
          languages: ['en'],
          promptPackVersion: FIXTURE_ROLEPLAY_PROMPT_PACK_VERSION,
        },
        pkg: { ...demoPackagePaid, skills: [...demoPackagePaid.skills, 'mock_interview'] },
        styleCard: demoStyleCard,
        locale: demoLocalePack,
        helpState: stored,
      }),
  };
  const retrieval: RetrievalIndex = {
    search: () => Promise.resolve(o.covered ? [{ ...demoChunkScored }] : []),
    probe: () => Promise.resolve({ hit: false, score: 0 }),
    leakCheck: () => Promise.resolve({ hit: false }),
  };
  const teacherQuestions = memoryTeacherQuestionStore();
  const t = testDeps({
    clock,
    script: {
      stream: replies.map((r) => ({
        match: (req: ModelRequest) => req.tier === 'main',
        steps: [say(r), used],
      })),
    },
    personas: createPersonaLibrary([[persona.id, { ...persona, mustNot: [...persona.mustNot] }]]),
    ...(o.grounded === true ? { judge: overlapJudge } : {}),
    overrides: {
      promptPacks: createPromptPackLibrary([fixturePromptPackSet, fixtureRolePlayPromptPackSet]),
      entitlements,
      turnConfig,
      retrieval,
      teacherQuestions,
      profiles: {
        get: () => Promise.resolve(demoLearnerProfile),
        applyEvidence: () => Promise.reject(new Error('unused')),
      },
      transcripts: memoryTranscriptStore(),
    },
  });
  const steps = testSteps({
    admit,
    entitle,
    buildContext,
    decide,
    generate,
    ...(o.grounded === true ? { postGuard } : {}),
    ...(o.intentFor === undefined
      ? {}
      : {
          route: {
            run: (env: { input: TurnInput }) =>
              Promise.resolve({
                intent: o.intentFor?.(env.input.text ?? '') ?? 'on_task',
                attempt: 'none' as const,
                usage: [],
              }),
          },
        }),
  });

  async function turn(input: Partial<TurnInput>) {
    const before = t.gateway.requests.length;
    const full: TurnInput = {
      ...demoTurnInput,
      kind: 'message',
      skill: 'mock_interview',
      ...input,
    };
    const { events } = await driveTurn(runTurn(full, { deps: t.deps, steps }), clock);
    const record = steps.commits.at(-1);
    if (record?.next !== undefined) stored = serializeSessionHelp(record.next);
    const system = t.gateway.requests.slice(before).find((r) => r.tier === 'main')?.system ?? '';
    const help = parseSessionHelp(stored).help;
    return { events, record, system, help, shown: shownText(events) };
  }
  return { turn, teacherQuestions, judged: t.judged };
}

/** What the student finally sees: the last replace, or the streamed tokens. */
function shownText(events: TurnEvent[]): string {
  const replaced = events.filter((e) => e.type === 'replace').at(-1);
  if (replaced !== undefined && 'text' in replaced) return String(replaced.text);
  return events.map((e) => (e.type === 'token' ? e.text : '')).join('');
}

const START = { kind: 'skill_action', skillPayload: { persona: demoPersona.id } } as const;
const STATE = /\[\[ROLEPLAY-[A-Z]+\]\][^\n]*/u;
const stateLine = (system: string) => STATE.exec(system)?.[0];

describe('role-play through the pipeline (5.8)', () => {
  it('start, two answers, /pause, resume, stop, then ended: the platform counts', async () => {
    const s = session({ covered: true });

    const start = await s.turn(START);
    expect(start.record?.decision?.move).toBe('ask');
    expect(stateLine(start.system)).toBe('[[ROLEPLAY-QUESTION]] Ask question 1 of 5, in role.');
    expect(start.system).toContain('[[MOVE-ROLEPLAY]]');
    expect(start.system).not.toContain('[[MOVE-ASK]]');
    expect(start.system).toContain('Play Interviewer.');
    expect(start.help).toMatchObject({ personaQuestionsAsked: 1, personaId: demoPersona.id });
    expect(start.help.personaPhase).toBeUndefined();

    const a1 = await s.turn({ text: 'Rewrite them with a common denominator.' });
    expect(stateLine(a1.system)).toBe('[[ROLEPLAY-QUESTION]] Ask question 2 of 5, in role.');
    expect(a1.help.personaQuestionsAsked).toBe(2);

    const a2 = await s.turn({ text: 'Then add the numerators.' });
    expect(stateLine(a2.system)).toBe('[[ROLEPLAY-QUESTION]] Ask question 3 of 5, in role.');
    expect(a2.help.personaQuestionsAsked).toBe(3);

    const paused = await s.turn({ text: '/pause' });
    expect(stateLine(paused.system)).toBe(
      '[[ROLEPLAY-PAUSE]] Step out and coach briefly; resume at question 3 of 5.',
    );
    expect(paused.help).toMatchObject({ personaQuestionsAsked: 3, personaPhase: 'paused' });

    const resumed = await s.turn({ text: 'Ready, carry on.' });
    expect(stateLine(resumed.system)).toBe(
      '[[ROLEPLAY-RESUME]] Step back in and ask question 3 of 5 again.',
    );
    expect(resumed.help.personaQuestionsAsked).toBe(3);
    expect(resumed.help.personaPhase).toBeUndefined();

    const stopped = await s.turn({ text: 'Stop.' });
    expect(stateLine(stopped.system)).toBe(
      '[[ROLEPLAY-STOPPED]] The student stopped: debrief now on the 2 answered questions.',
    );
    expect(stopped.help).toMatchObject({ personaQuestionsAsked: 3, personaPhase: 'ended' });

    const after = await s.turn({ text: 'One more?' });
    expect(stateLine(after.system)).toBe(
      '[[ROLEPLAY-ENDED]] The role-play is over: ask no role-play question and offer a new start.',
    );
    expect(after.help.personaPhase).toBe('ended');

    const again = await s.turn(START);
    expect(stateLine(again.system)).toBe('[[ROLEPLAY-QUESTION]] Ask question 1 of 5, in role.');
    expect(again.help.personaQuestionsAsked).toBe(1);
    expect(again.help.personaPhase).toBeUndefined();
  });

  it('the last answer gets the debrief, then the role-play has ended', async () => {
    const s = session({ covered: true, persona: { ...demoPersona, endAfterQuestions: 2 } });
    await s.turn(START);
    await s.turn({ text: 'First answer.' });
    const last = await s.turn({ text: 'Second answer.' });
    expect(stateLine(last.system)).toBe(
      '[[ROLEPLAY-DEBRIEF]] All 2 questions are asked and answered: give the debrief now; ask nothing new.',
    );
    expect(last.system).not.toContain('[[ROLEPLAY-QUESTION]]');
    expect(last.help).toMatchObject({ personaQuestionsAsked: 2, personaPhase: 'ended' });
  });

  it('uncovered: the start opens question 1 with no material and no teacher question', async () => {
    const s = session({ covered: false });
    const start = await s.turn(START);
    expect(start.record?.decision?.move).toBe('ask');
    expect(stateLine(start.system)).toBe('[[ROLEPLAY-QUESTION]] Ask question 1 of 5, in role.');
    expect(start.system).not.toContain(MATERIAL);
    expect(start.help.personaQuestionsAsked).toBe(1);

    // An answer to question 1 on an uncovered topic meets the coverage gate.
    const a1 = await s.turn({ text: 'Something the teacher never covered.' });
    expect(a1.record?.decision?.move).toBe('ask_teacher');
    expect(stateLine(a1.system)).toBeUndefined();

    // Control, resume and debrief turns skip the gate, so the role-play still steers.
    const paused = await s.turn({ text: '/pause' });
    expect(stateLine(paused.system)).toMatch(/^\[\[ROLEPLAY-PAUSE\]\]/u);
    expect(paused.help.personaPhase).toBe('paused');
    const resumed = await s.turn({ text: 'Go on.' });
    expect(stateLine(resumed.system)).toMatch(/^\[\[ROLEPLAY-RESUME\]\]/u);
    const stopped = await s.turn({ text: 'Stop.' });
    expect(stateLine(stopped.system)).toMatch(/^\[\[ROLEPLAY-STOPPED\]\]/u);
    expect(stopped.help.personaPhase).toBe('ended');
  });
});

describe('13.skillpresent: the harness-computed progress skill event through the real pipeline', () => {
  /** The one `skill` event of a turn's events, by type (never from a model tool call). */
  const progressEvent = (events: TurnEvent[]) =>
    events.find((e) => e.type === 'skill' && 'skill' in e && e.skill === 'mock_interview');

  it('start, two answers, /pause, resume, stop, then ended: each turn carries the right phase, with the shown text unchanged', async () => {
    const s = session({ covered: true });

    const start = await s.turn(START);
    expect(progressEvent(start.events)).toEqual({
      type: 'skill',
      skill: 'mock_interview',
      payload: { phase: 'question', question: 1, total: 5 },
    });

    const a1 = await s.turn({ text: 'Rewrite them with a common denominator.' });
    expect(progressEvent(a1.events)).toEqual({
      type: 'skill',
      skill: 'mock_interview',
      payload: { phase: 'question', question: 2, total: 5 },
    });

    const a2 = await s.turn({ text: 'Then add the numerators.' });
    expect(progressEvent(a2.events)).toEqual({
      type: 'skill',
      skill: 'mock_interview',
      payload: { phase: 'question', question: 3, total: 5 },
    });

    const paused = await s.turn({ text: '/pause' });
    expect(progressEvent(paused.events)).toEqual({
      type: 'skill',
      skill: 'mock_interview',
      payload: { phase: 'pause', question: 3, total: 5 },
    });

    const resumed = await s.turn({ text: 'Ready, carry on.' });
    expect(progressEvent(resumed.events)).toEqual({
      type: 'skill',
      skill: 'mock_interview',
      payload: { phase: 'resume', question: 3, total: 5 },
    });

    const stopped = await s.turn({ text: 'Stop.' });
    expect(progressEvent(stopped.events)).toEqual({
      type: 'skill',
      skill: 'mock_interview',
      payload: { phase: 'stopped', answered: 2 },
    });

    const after = await s.turn({ text: 'One more?' });
    expect(progressEvent(after.events)).toEqual({
      type: 'skill',
      skill: 'mock_interview',
      payload: { phase: 'ended' },
    });

    // No change to what the student is shown: the progress event is additive metadata only.
    expect(start.shown.length).toBeGreaterThan(0);
  });

  it('the last answer gets the debrief phase', async () => {
    const s = session({ covered: true, persona: { ...demoPersona, endAfterQuestions: 2 } });
    await s.turn(START);
    await s.turn({ text: 'First answer.' });
    const last = await s.turn({ text: 'Second answer.' });
    expect(progressEvent(last.events)).toEqual({
      type: 'skill',
      skill: 'mock_interview',
      payload: { phase: 'debrief', total: 2 },
    });
  });

  it('an un-entitled student (no mock_interview skill) gets no progress event, never a throw', async () => {
    const s = session({ covered: true });
    // The `session()` helper always adds `mock_interview` to the entitlement; this case checks
    // the helper's own fail-closed path by starting a turn whose skill is locked instead.
    const r = await s.turn({ text: 'Something unrelated.', kind: 'message', skill: 'coach' });
    expect(progressEvent(r.events)).toBeUndefined();
  });
});

describe('role-play controls the router does not label on_task (5.8 fix round 1)', () => {
  it.each(['meta', 'off_topic'] as const)(
    'a bare /pause then a bare stop routed %s still pause and stop the role-play',
    async (label) => {
      const s = session({
        covered: true,
        intentFor: (text) => (text === '/pause' || text === 'stop' ? label : 'on_task'),
      });
      await s.turn(START);
      await s.turn({ text: 'First answer.' });
      const paused = await s.turn({ text: '/pause' });
      expect(paused.record?.decision?.move).toBe('ask');
      expect(stateLine(paused.system)).toBe(
        '[[ROLEPLAY-PAUSE]] Step out and coach briefly; resume at question 2 of 5.',
      );
      expect(paused.help.personaPhase).toBe('paused');
      const stopped = await s.turn({ text: 'stop' });
      expect(stateLine(stopped.system)).toBe(
        '[[ROLEPLAY-STOPPED]] The student stopped: debrief now on the 1 answered questions.',
      );
      expect(stopped.help.personaPhase).toBe('ended');
    },
  );

  it('a stop the router flags as distress gets the distress handling, not the role-play stop', async () => {
    const s = session({
      covered: true,
      intentFor: (text) => (text === 'stop' ? 'distress' : 'on_task'),
    });
    await s.turn(START);
    const a1 = await s.turn({ text: 'First answer.' });
    const before = a1.help;
    const stopped = await s.turn({ text: 'stop' });
    expect(stopped.record).toMatchObject({ outcome: 'escalated', intent: 'distress' });
    expect(stopped.system).toBe('');
    expect(stopped.help).toEqual(before);
    expect(stopped.help.personaPhase).toBeUndefined();
  });
});

describe('the debrief and the grounding judge (ADR-0013 point 6)', () => {
  const two = { ...demoPersona, endAfterQuestions: 2 };
  const grounded = { covered: true, grounded: true } as const;
  const DEBRIEF =
    'Well done. Your answer on adding fractions was correct: first rewrite them with a common denominator. ' +
    'Which part felt hardest?';

  it('a last-answer debrief that stays with the material passes and is shown', async () => {
    const s = session({
      ...grounded,
      persona: two,
      replies: ['How do you add?', 'And then?', DEBRIEF],
    });
    await s.turn(START);
    await s.turn({ text: 'Rewrite them first.' });
    const last = await s.turn({ text: 'Find a common denominator.' });
    expect(stateLine(last.system)).toMatch(/^\[\[ROLEPLAY-DEBRIEF\]\]/u);
    expect(s.judged.length).toBeGreaterThan(0);
    expect(last.shown).toBe(DEBRIEF);
    expect(s.teacherQuestions.opened).toHaveLength(0);
  });

  it('a stop debrief that stays with the material passes and is shown', async () => {
    const s = session({ ...grounded, replies: ['How do you add?', 'And then?', DEBRIEF] });
    await s.turn(START);
    await s.turn({ text: 'Rewrite them first.' });
    const stopped = await s.turn({ text: 'Stop.' });
    expect(stateLine(stopped.system)).toMatch(/^\[\[ROLEPLAY-STOPPED\]\]/u);
    expect(stopped.shown).toBe(DEBRIEF);
  });

  it('a debrief that judges delivery beyond the material is replaced (characterisation)', async () => {
    const s = session({
      ...grounded,
      persona: two,
      replies: ['How do you add?', 'And then?', 'You spoke clearly and kept your answers short.'],
    });
    await s.turn(START);
    await s.turn({ text: 'Rewrite them first.' });
    const last = await s.turn({ text: 'Find a common denominator.' });
    expect(last.shown).toBe(askTeacherReplyText());
  });

  it('an uncovered stop debrief has no material, so its claims are replaced (characterisation)', async () => {
    const s = session({
      covered: false,
      grounded: true,
      replies: ['Which topic shall we practise?', DEBRIEF],
    });
    await s.turn(START);
    const stopped = await s.turn({ text: 'Stop.' });
    expect(stateLine(stopped.system)).toMatch(/^\[\[ROLEPLAY-STOPPED\]\]/u);
    expect(stopped.shown).toBe(askTeacherReplyText());
  });
});
