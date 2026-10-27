// Task 6.4a: the graded-check evidence producer. A practice skill turn whose `attempt` grades
// `'correct'` or `'wrong'` against the loaded help state's held item builds one `EvidenceEvent`
// (its stored `practiceTopicId`) onto `CommitRecord.evidence`, the already-shipped consumer
// `commit.ts`'s `profiles.applyEvidence` reads (3.17). No topic stored, no practice skill, or an
// unsettled attempt (`'none'`/`'partial'`) all mean no event; the producer never throws.
import {
  demoPedagogyDecision,
  demoTurnInput,
  learnerProfileNew,
  usageMain,
} from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { copyHelp, type HelpState, INITIAL_HELP_STATE } from '../pedagogy/helpState.js';
import { driveTurn } from '../testing/driveTurn.js';
import { memoryToolRegistry } from '../testing/memoryToolRegistry.js';
import { FIXTURE_PROMPT_PACK_VERSION } from '../testing/promptPackFixtures.js';
import { testDecideResult, testDeps, testSteps, type TestSteps } from '../testing/testSteps.js';
import { demoPracticeBank } from '../tools/demoPracticeBank.js';
import { practiceNextItemTool } from '../tools/practice.js';
import { runTurn } from './runner.js';
import { defaultSteps } from './steps/index.js';
import type { Steps } from './types.js';
import type { Attempt, ModelChunk, PedagogyDecision } from '@edmate/contracts';

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

// 6.4c: when evidenceFor skips a graded practice turn for no usable topic, the skip is recorded
// through the trace's existing guard path (name/ok/action only -- never student text or the item).
describe('runner: evidenceFor records its skip reason (6.4c)', () => {
  it('a graded generated-item turn (no stored topic) records a no_topic skip', async () => {
    const help = heldHelp();
    delete (help as { practiceTopicId?: string }).practiceTopicId;
    const { result } = await turnWith({ attempt: 'correct', help });
    expect(result.trace?.guards).toContainEqual({
      name: 'evidenceSkip',
      ok: false,
      action: 'no_topic',
    });
  });

  it('a graded bank-item turn with a topic records no skip', async () => {
    const { result } = await turnWith({ attempt: 'correct' });
    expect(result.trace?.guards.some((g) => g.name === 'evidenceSkip')).toBe(false);
  });

  it('a graded turn with a stored topic that fails the id shape records a bad_topic_id skip', async () => {
    const help = heldHelp({ practiceTopicId: 'bad topic!' });
    const { result, commit } = await turnWith({ attempt: 'correct', help });
    expect(result.trace?.guards).toContainEqual({
      name: 'evidenceSkip',
      ok: false,
      action: 'bad_topic_id',
    });
    expect(commit?.evidence).toBeUndefined();
  });
});

// Fix round 1: a generated (non-bank) practice item has no real topic row (its own `topicId` is
// always `<moduleId>:practice`, a harness-internal label `EvidenceEventSchema.topicId`'s `id()`
// shape rejects — a `:` is not in `^[A-Za-z0-9_-]+$`). Driven through the real `practice.next_item`
// tool and the real `generate` step (not the hand-picked 'linear' fixture above), so
// `topicIdFor`/`issuedItem` actually resolve the item's topic the way production does, this
// confirms a graded generated item emits no evidence and the turn still commits (never throws, the
// bug this fix round closes: before it, `topicId` was `module-arithmetic:practice`, which commit's
// real `profiles.applyEvidence` consumer — out of scope here — would reject).
describe('runner: a generated practice item never emits evidence (fix round 1)', () => {
  const say = (text: string): ModelChunk => ({ type: 'text', text });
  const used: ModelChunk = { type: 'usage', usage: usageMain };
  const callItem: ModelChunk = {
    type: 'tool_call',
    id: 'c1',
    name: 'practice.next_item',
    args: {},
  };
  const decision: PedagogyDecision = {
    ...demoPedagogyDecision,
    move: 'ask',
    mustNotReveal: [],
    tools: ['practice.next_item'],
  };
  const main = (...steps: ModelChunk[]) => ({
    match: (r: { tier: string }) => r.tier === 'main',
    steps: [...steps],
  });
  // `defaultSteps.generate` (the real generate step) loads the agent's own prompt pack version;
  // the fixture packs are only registered under `FIXTURE_PROMPT_PACK_VERSION` (as in
  // runner.practiceAnswerKey.test.ts's `fixtureEntitle`).
  const fixtureEntitle: Steps['entitle'] = async (env) => {
    const e = await testSteps().entitle(env);
    return { ...e, agent: { ...e.agent, promptPackVersion: FIXTURE_PROMPT_PACK_VERSION } };
  };

  it('issuing, then grading, a generated item: no evidence, the turn still commits', async () => {
    const tools = memoryToolRegistry([practiceNextItemTool(demoPracticeBank([]))]);
    const issueDeps = testDeps({
      overrides: { tools },
      script: { stream: [main(callItem, used), main(say('Here.'), used)] },
    });
    const issueSteps = testSteps({
      entitle: fixtureEntitle,
      route: { run: () => Promise.resolve({ intent: 'on_task', attempt: 'none', usage: [] }) },
      decide: { run: () => Promise.resolve(testDecideResult(decision)) },
      generate: defaultSteps.generate,
      postGuard: defaultSteps.postGuard,
    });
    await driveTurn(
      runTurn(demoTurnInput, { deps: issueDeps.deps, steps: issueSteps }),
      issueDeps.clock,
    );
    const savedHelp = issueSteps.commits[0]?.next?.help;
    expect(savedHelp?.practiceItemId).toMatch(/^gen:/);
    expect(savedHelp).not.toHaveProperty('practiceTopicId');

    const gradeDeps = testDeps({
      overrides: { tools },
      script: { stream: [main(say('Nice work.'), used)] },
    });
    const gradeSteps = testSteps({
      entitle: fixtureEntitle,
      route: { run: () => Promise.resolve({ intent: 'on_task', attempt: 'correct', usage: [] }) },
      buildContext: () =>
        Promise.resolve({
          profile: learnerProfileNew,
          history: [],
          retrieved: [],
          lockedHit: false,
          helpRung: 0,
          helpState: savedHelp ?? copyHelp(INITIAL_HELP_STATE),
        }),
      decide: { run: () => Promise.resolve(testDecideResult({ ...decision, tools: [] })) },
      generate: defaultSteps.generate,
      postGuard: defaultSteps.postGuard,
    });
    const { events } = await driveTurn(
      runTurn(demoTurnInput, { deps: gradeDeps.deps, steps: gradeSteps }),
      gradeDeps.clock,
    );
    expect(events.some((e) => e.type === 'error')).toBe(false);
    const graded = gradeSteps.commits[0];
    expect(graded).toBeDefined();
    expect(graded?.evidence).toBeUndefined();
  });
});
