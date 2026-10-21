// Task 3.11e item 2: the persona question count is saved only for a reply the student saw. A
// generate error, a cancel, the postGuard-failure safe reply and a guard `replace` each save the
// count the turn loaded; an `ok` reply saves decide's count (loaded + 1).
import { demoPedagogyDecision, demoTurnInput, learnerProfileNew } from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { copyHelp, type HelpState, INITIAL_HELP_STATE } from '../pedagogy/helpState.js';
import { driveTurn } from '../testing/driveTurn.js';
import { testDecideResult, testDeps, testSteps, type StepOverrides } from '../testing/testSteps.js';
import { cancelSource } from './clock.js';
import { runTurn } from './runner.js';

const PERSONA_ID = 'per_test_01';
const loadedHelp: HelpState = {
  ...copyHelp(INITIAL_HELP_STATE),
  personaQuestionsAsked: 2,
  personaId: PERSONA_ID,
};
const decision = { ...demoPedagogyDecision, move: 'ask' as const, mustNotReveal: [] };

/** decide counted the question: loaded + 1. */
const counted = () =>
  Promise.resolve(
    testDecideResult(decision, {
      next: { rung: 0, help: { ...copyHelp(loadedHelp), personaQuestionsAsked: 3 } },
    }),
  );

async function savedCount(
  o: StepOverrides,
  cancel = cancelSource(),
  loaded: typeof loadedHelp = loadedHelp,
) {
  const t = testDeps();
  const steps = testSteps({
    buildContext: () =>
      Promise.resolve({
        profile: learnerProfileNew,
        history: [],
        retrieved: [],
        lockedHit: false,
        helpRung: 0,
        helpState: copyHelp(loaded),
      }),
    ...o,
    decide: { run: counted, ...o.decide },
  });
  const { result } = await driveTurn(
    runTurn(demoTurnInput, { deps: t.deps, steps, cancel: cancel.token }),
    t.clock,
  );
  expect(steps.commits).toHaveLength(1);
  const help = steps.commits[0]?.next?.help;
  return { help, outcome: steps.commits[0]?.outcome, result };
}

describe('the persona count is saved only for a reply the student saw (3.11e)', () => {
  it('an ok reply saves loaded + 1', async () => {
    const r = await savedCount({});
    expect(r.outcome).toBe('replied');
    expect(r.help?.personaQuestionsAsked).toBe(3);
    expect(r.help?.personaId).toBe(PERSONA_ID);
  });

  it('a generate error saves the loaded count', async () => {
    const r = await savedCount({ generate: () => Promise.reject(new Error('down')) });
    expect(r.outcome).toBe('error');
    expect(r.help?.personaQuestionsAsked).toBe(2);
    expect(r.help?.personaId).toBe(PERSONA_ID);
  });

  it('a cancel saves the loaded count', async () => {
    const c = cancelSource();
    const r = await savedCount(
      {
        decide: {
          run: () => {
            c.cancel();
            return counted();
          },
        },
      },
      c,
    );
    expect(r.outcome).toBe('error');
    expect(r.help?.personaQuestionsAsked).toBe(2);
  });

  it('the postGuard-failure safe reply saves the loaded count', async () => {
    const r = await savedCount({ postGuard: () => Promise.reject(new Error('guard down')) });
    expect(r.outcome).toBe('replied');
    expect(r.help?.personaQuestionsAsked).toBe(2);
    expect(r.help?.personaId).toBe(PERSONA_ID);
  });

  it('a guard replace saves the loaded count', async () => {
    const r = await savedCount({
      postGuard: () =>
        Promise.resolve({
          result: 'replace',
          text: 'rewritten',
          guards: [{ name: 'answerLeak', ok: false, action: 'replace' }],
          usage: [],
        }),
    });
    expect(r.outcome).toBe('replied');
    expect(r.help?.personaQuestionsAsked).toBe(2);
  });

  it('a loaded state with no count saves none on a failed turn', async () => {
    const t = testDeps();
    const steps = testSteps({
      decide: { run: counted },
      generate: () => Promise.reject(new Error('down')),
    });
    await driveTurn(runTurn(demoTurnInput, { deps: t.deps, steps }), t.clock);
    const help = steps.commits[0]?.next?.help;
    expect(help?.personaQuestionsAsked).toBeUndefined();
    expect(help?.personaId).toBeUndefined();
  });
});

// Task 5.8 (ADR-0013 §1): the stored role-play phase travels with the count, so a turn the
// student never saw never pauses, resumes or ends a role-play.
describe('the role-play phase is saved only for a reply the student saw (5.8)', () => {
  /** decide's next state for this turn's phase: the count as loaded, the phase as given. */
  const decided =
    (phase: 'paused' | 'ended' | undefined, from: typeof loadedHelp = loadedHelp) =>
    () => {
      const help = { ...copyHelp(from) };
      delete help.personaPhase;
      return Promise.resolve(
        testDecideResult(decision, {
          next: { rung: 0, help: phase === undefined ? help : { ...help, personaPhase: phase } },
        }),
      );
    };
  const failures: [string, StepOverrides][] = [
    ['a generate error', { generate: () => Promise.reject(new Error('down')) }],
    ['the postGuard-failure safe reply', { postGuard: () => Promise.reject(new Error('down')) }],
    [
      'a guard replace',
      {
        postGuard: () =>
          Promise.resolve({
            result: 'replace',
            text: 'rewritten',
            guards: [{ name: 'answerLeak', ok: false, action: 'replace' }],
            usage: [],
          }),
      },
    ],
  ];

  it.each(failures)('a failed debrief or stop turn (%s) saves no ended', async (_n, o) => {
    const r = await savedCount({ ...o, decide: { run: decided('ended') } });
    expect(r.help).not.toHaveProperty('personaPhase');
    expect(r.help?.personaQuestionsAsked).toBe(2);
  });

  it.each(failures)('a failed pause turn (%s) saves no paused', async (_n, o) => {
    const r = await savedCount({ ...o, decide: { run: decided('paused') } });
    expect(r.help).not.toHaveProperty('personaPhase');
    expect(r.help?.personaQuestionsAsked).toBe(2);
  });

  it('a failed resume turn keeps the loaded paused, so the next turn resumes again', async () => {
    const paused = { ...loadedHelp, personaPhase: 'paused' as const };
    const r = await savedCount(
      {
        generate: () => Promise.reject(new Error('down')),
        decide: { run: decided(undefined, paused) },
      },
      cancelSource(),
      paused,
    );
    expect(r.help?.personaPhase).toBe('paused');
  });

  it('a cancelled debrief turn saves no ended', async () => {
    const c = cancelSource();
    const r = await savedCount(
      {
        decide: {
          run: () => {
            c.cancel();
            return decided('ended')();
          },
        },
      },
      c,
    );
    expect(r.outcome).toBe('error');
    expect(r.help).not.toHaveProperty('personaPhase');
  });

  it.each(['paused', 'ended'] as const)('an ok reply saves %s', async (phase) => {
    const r = await savedCount({ decide: { run: decided(phase) } });
    expect(r.outcome).toBe('replied');
    expect(r.help?.personaPhase).toBe(phase);
  });
});
