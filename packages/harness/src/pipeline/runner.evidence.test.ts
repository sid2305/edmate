// Task 6.4a: the graded-check evidence producer. A practice skill turn whose `attempt` grades
// `'correct'` or `'wrong'` against the loaded help state's held item builds one `EvidenceEvent`
// (its stored `practiceTopicId`) onto `CommitRecord.evidence`, the already-shipped consumer
// `commit.ts`'s `profiles.applyEvidence` reads (3.17). No topic stored, no practice skill, or an
// unsettled attempt (`'none'`/`'partial'`) all mean no event; the producer never throws.
import { demoPedagogyDecision, demoTurnInput, learnerProfileNew } from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { copyHelp, type HelpState, INITIAL_HELP_STATE } from '../pedagogy/helpState.js';
import { driveTurn } from '../testing/driveTurn.js';
import { testDecideResult, testDeps, testSteps, type TestSteps } from '../testing/testSteps.js';
import { runTurn } from './runner.js';
import type { Attempt } from '@edmate/contracts';

const heldHelp = (extra: Partial<HelpState> = {}): HelpState =>
  copyHelp({
    ...INITIAL_HELP_STATE,
    answerKey: ['42'],
    practiceItemId: 'fx:linear:1:a',
    practiceModuleId: 'mod_test_01',
    practiceTopicId: 'linear',
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

describe('runner: graded-check EvidenceEvent (6.4a)', () => {
  it('a correct practice answer emits one EvidenceEvent with the held topic', async () => {
    const { commit } = await turnWith({ attempt: 'correct' });
    expect(commit?.evidence).toEqual([
      {
        studentId: 'stu_test_01',
        teacherId: 'tch_test_01',
        topicId: 'linear',
        correct: true,
        source: 'practice',
        weight: 1,
        ts: commit?.evidence?.[0]?.ts,
      },
    ]);
    expect(typeof commit?.evidence?.[0]?.ts).toBe('string');
  });

  it('a wrong practice answer emits correct: false', async () => {
    const { commit } = await turnWith({ attempt: 'wrong' });
    expect(commit?.evidence).toEqual([
      expect.objectContaining({ correct: false, source: 'practice', topicId: 'linear', weight: 1 }),
    ]);
  });

  it('a non-practice skill turn emits no evidence, even on a graded attempt', async () => {
    const { commit } = await turnWith({ attempt: 'correct', skill: null });
    expect(commit?.evidence).toBeUndefined();
  });

  it('an unsettled attempt (partial) emits no evidence', async () => {
    const { commit } = await turnWith({ attempt: 'partial' });
    expect(commit?.evidence).toBeUndefined();
  });

  it('an unsettled attempt (none) emits no evidence', async () => {
    const { commit } = await turnWith({ attempt: 'none' });
    expect(commit?.evidence).toBeUndefined();
  });

  it('a held item with no stored topic (defensive gap) emits no evidence, never throws', async () => {
    const help = heldHelp();
    delete (help as { practiceTopicId?: string }).practiceTopicId;
    const { commit } = await turnWith({ attempt: 'correct', help });
    expect(commit?.evidence).toBeUndefined();
  });
});
