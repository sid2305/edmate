// Task 6.3c: the mistake-tagging producer. A wrong practice answer in a scripted turn, whose
// loaded help state holds a `practiceMistakeTag`, classifies it against the style card's
// `mistakeTags` (`classifyMistakeTags`) and attaches the result onto `CommitRecord.mistakesKnown`
// / `mistakesProposed`, which `commit.ts`'s `profiles.applyMistakes`/`recordProposedMistakes`
// read (6.3c). No stored tag, a correct answer, a non-practice skill or an unsettled attempt all
// mean no result; the producer never throws. Mirrors `runner.evidence.test.ts`'s structure.
import {
  demoPedagogyDecision,
  demoStyleCard,
  demoTurnInput,
  learnerProfileNew,
} from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { copyHelp, type HelpState, INITIAL_HELP_STATE } from '../pedagogy/helpState.js';
import { driveTurn } from '../testing/driveTurn.js';
import { testDecideResult, testDeps, testSteps, type TestSteps } from '../testing/testSteps.js';
import { runTurn } from './runner.js';
import type { Attempt } from '@edmate/contracts';

// demoStyleCard.mistakeTags = ['sign_error', 'unit_missing'] (packages/contracts/fixtures/valid/teacher.ts).
const KNOWN_TAG = 'sign_error';
const UNKNOWN_TAG = 'off_by_one';

const heldHelp = (extra: Partial<HelpState> = {}): HelpState =>
  copyHelp({
    ...INITIAL_HELP_STATE,
    answerKey: ['42'],
    practiceItemId: 'fx:linear:1:a',
    practiceModuleId: 'mod_test_01',
    practiceMistakeTag: KNOWN_TAG,
    ...extra,
  });

function turnWith(o: { attempt: Attempt; skill?: 'practice' | null; help?: HelpState }) {
  const steps = testSteps({
    route: { run: () => Promise.resolve({ intent: 'on_task', attempt: o.attempt, usage: [] }) },
    buildContext: () =>
      Promise.resolve({
        profile: learnerProfileNew,
        history: [],
        retrieved: [],
        lockedHit: false,
        helpRung: 0,
        helpState: o.help ?? heldHelp(),
      }),
    decide: {
      run: () =>
        Promise.resolve(
          testDecideResult(demoPedagogyDecision, {
            skill: o.skill === undefined ? 'practice' : o.skill,
          }),
        ),
    },
  });
  return driveTurnAndCommit(steps);
}

async function driveTurnAndCommit(steps: TestSteps) {
  const t = testDeps();
  const { result } = await driveTurn(runTurn(demoTurnInput, { deps: t.deps, steps }), t.clock);
  return { result, commit: steps.commits[0] };
}

describe('runner: mistake-tag classification (6.3c)', () => {
  it('a wrong answer with a held tag on the style card: mistakesKnown holds it, mistakesProposed is undefined', async () => {
    const { commit } = await turnWith({ attempt: 'wrong' });
    expect(commit?.mistakesKnown).toEqual([
      { tag: KNOWN_TAG, count: 1, lastSeen: commit?.mistakesKnown?.[0]?.lastSeen },
    ]);
    expect(typeof commit?.mistakesKnown?.[0]?.lastSeen).toBe('string');
    expect(commit?.mistakesProposed).toBeUndefined();
  });

  it('a wrong answer with a held tag NOT on the style card: mistakesProposed holds it, mistakesKnown is undefined', async () => {
    const help = heldHelp({ practiceMistakeTag: UNKNOWN_TAG });
    const { commit } = await turnWith({ attempt: 'wrong', help });
    expect(demoStyleCard.mistakeTags).not.toContain(UNKNOWN_TAG);
    expect(commit?.mistakesProposed).toEqual([
      { tag: UNKNOWN_TAG, count: 1, lastSeen: commit?.mistakesProposed?.[0]?.lastSeen },
    ]);
    expect(commit?.mistakesKnown).toBeUndefined();
  });

  it('a correct practice answer emits no mistakes', async () => {
    const { commit } = await turnWith({ attempt: 'correct' });
    expect(commit?.mistakesKnown).toBeUndefined();
    expect(commit?.mistakesProposed).toBeUndefined();
  });

  it('a non-practice skill turn emits no mistakes, even on a wrong attempt', async () => {
    const { commit } = await turnWith({ attempt: 'wrong', skill: null });
    expect(commit?.mistakesKnown).toBeUndefined();
    expect(commit?.mistakesProposed).toBeUndefined();
  });

  it('an unsettled attempt (partial) emits no mistakes', async () => {
    const { commit } = await turnWith({ attempt: 'partial' });
    expect(commit?.mistakesKnown).toBeUndefined();
    expect(commit?.mistakesProposed).toBeUndefined();
  });

  it('an unsettled attempt (none) emits no mistakes', async () => {
    const { commit } = await turnWith({ attempt: 'none' });
    expect(commit?.mistakesKnown).toBeUndefined();
    expect(commit?.mistakesProposed).toBeUndefined();
  });

  it('a held item with no stored mistake tag (defensive gap) emits no mistakes, never throws', async () => {
    const help = heldHelp();
    delete (help as { practiceMistakeTag?: string }).practiceMistakeTag;
    const { commit } = await turnWith({ attempt: 'wrong', help });
    expect(commit?.mistakesKnown).toBeUndefined();
    expect(commit?.mistakesProposed).toBeUndefined();
  });
});
