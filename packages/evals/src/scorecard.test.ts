// Task 7.8: the teaching scorecard, `GateResult -> Scorecard`. Per-category pass rates for
// hints-before-answers (pedagogy), locked content and accuracy, combining platform and agent
// origin into one number while keeping the per-origin split visible (lead, 21 Oct 2026, Q1).
import { describe, expect, it } from 'vitest';
import { demoSuiteInput } from './demoSuiteInput.testkit.js';
import { CITED, markerJudge, OK_MARK, scriptedAgent } from './gate.testkit.js';
import type { EvalAgent, EvalAgentReply, EvalTurnInput } from './agent.js';
import { runQualityGate, type GateGroupResult, type GateResult, type GateStats } from './qualityGate.js';
import { memoryRecorder } from './recorder.js';
import { buildScorecard, SCORECARD_GROUPS, ScorecardSchema, type Scorecard } from './scorecard.js';

const EMPTY_STATS: GateStats = {
  cases: 0,
  notRun: 0,
  deadlinePassed: false,
  deadlineMs: 900_000,
  agentCalls: 0,
  judgeCalls: 0,
  totalCalls: 0,
  maxCallsPerCase: 0,
  concurrency: 4,
  criticalPathCalls: 0,
  estimatedSeconds: 0,
};

function fakeGate(groups: GateGroupResult[]): GateResult {
  return {
    pass: groups.every((g) => g.pass),
    changes: ['material'],
    groups,
    failedCaseIds: [],
    results: [],
    stats: EMPTY_STATS,
  };
}

describe('buildScorecard: synthetic gate result', () => {
  it('combines platform and agent origin into one rate per category, keeping the split', () => {
    const gate = fakeGate([
      { origin: 'platform', group: 'pedagogy', total: 10, passed: 8, minPercent: 80, pass: true },
      { origin: 'agent', group: 'pedagogy', total: 5, passed: 4, minPercent: 80, pass: true },
      { origin: 'platform', group: 'locked', total: 20, passed: 20, minPercent: 100, pass: true },
      {
        origin: 'agent',
        group: 'locked',
        total: 10,
        passed: 9,
        minPercent: 100,
        pass: false,
        reason: 'below_threshold',
      },
      { origin: 'agent', group: 'accuracy', total: 50, passed: 50, minPercent: 99, pass: true },
    ]);

    const card = buildScorecard(gate);

    expect(card.pass).toBe(false);
    expect(card.changes).toEqual(['material']);
    expect(card.categories).toEqual([
      {
        key: 'hints_before_answers',
        measured: true,
        total: 15,
        passed: 12,
        percent: 80,
        pass: true,
        byOrigin: [
          { origin: 'platform', total: 10, passed: 8 },
          { origin: 'agent', total: 5, passed: 4 },
        ],
      },
      {
        key: 'locked_content',
        measured: true,
        total: 30,
        passed: 29,
        percent: (29 / 30) * 100,
        pass: false, // one contributing origin failed, even though the combined rate looks high
        byOrigin: [
          { origin: 'platform', total: 20, passed: 20 },
          { origin: 'agent', total: 10, passed: 9 },
        ],
      },
      {
        key: 'accuracy',
        measured: true,
        total: 50,
        passed: 50,
        percent: 100,
        pass: true,
        byOrigin: [{ origin: 'agent', total: 50, passed: 50 }],
      },
    ]);
  });

  it('marks a category measured: false when the gate run has no row for its group at all', () => {
    const gate = fakeGate([
      { origin: 'agent', group: 'accuracy', total: 10, passed: 10, minPercent: 99, pass: true },
    ]);

    const card = buildScorecard(gate);

    const pedagogy = card.categories.find((c) => c.key === 'hints_before_answers');
    const locked = card.categories.find((c) => c.key === 'locked_content');
    expect(pedagogy).toEqual({
      key: 'hints_before_answers',
      measured: false,
      total: 0,
      passed: 0,
      percent: null,
      pass: false,
      byOrigin: [],
    });
    expect(locked).toEqual({
      key: 'locked_content',
      measured: false,
      total: 0,
      passed: 0,
      percent: null,
      pass: false,
      byOrigin: [],
    });
  });

  it('never fabricates a pass or fail for an unmeasured category even when the whole gate passes', () => {
    const gate = fakeGate([
      { origin: 'platform', group: 'accuracy', total: 1, passed: 1, minPercent: 99, pass: true },
    ]);
    const card = buildScorecard(gate);
    expect(card.pass).toBe(true);
    const pedagogy = card.categories.find((c) => c.key === 'hints_before_answers');
    expect(pedagogy?.measured).toBe(false);
    expect(pedagogy?.pass).toBe(false);
  });

  it('a measured but empty group (expected, zero cases) gets percent: null, not a fabricated rate', () => {
    const gate = fakeGate([
      {
        origin: 'platform',
        group: 'accuracy',
        total: 0,
        passed: 0,
        minPercent: 99,
        pass: false,
        reason: 'empty_group',
      },
    ]);
    const card = buildScorecard(gate);
    const accuracy = card.categories.find((c) => c.key === 'accuracy');
    expect(accuracy).toEqual({
      key: 'accuracy',
      measured: true,
      total: 0,
      passed: 0,
      percent: null,
      pass: false,
      byOrigin: [{ origin: 'platform', total: 0, passed: 0 }],
    });
  });

  it('exposes one category per SCORECARD_GROUPS key, in that order', () => {
    const gate = fakeGate([]);
    const card = buildScorecard(gate);
    expect(card.categories.map((c) => c.key)).toEqual(Object.keys(SCORECARD_GROUPS));
  });
});

describe('ScorecardSchema', () => {
  it('rejects a changes entry that is not a known change kind', () => {
    const bogus = {
      pass: true,
      changes: ['bogus'],
      categories: [],
    };
    expect(() => ScorecardSchema.parse(bogus)).toThrow();
  });

  it('accepts a real buildScorecard output', () => {
    const gate = fakeGate([
      { origin: 'platform', group: 'accuracy', total: 1, passed: 1, minPercent: 99, pass: true },
    ]);
    const card = buildScorecard(gate);
    expect(() => ScorecardSchema.parse(card)).not.toThrow();
  });
});

describe('buildScorecard: 7.4 demo fixtures through runQualityGate (7.8 acceptance)', () => {
  const input = demoSuiteInput();
  const nameOf = (pkgId: string): string => {
    const pkg = input.packages.find((p) => p.id === pkgId);
    if (pkg === undefined) throw new Error(`no demo package ${pkgId}`);
    return pkg.name;
  };

  type Kind = 'locked' | 'out-of-course' | 'accuracy';
  const kindOf = (caseId: string): Kind =>
    caseId.startsWith('gen-lock-')
      ? 'locked'
      : caseId.startsWith('gen-acc-ooc-')
        ? 'out-of-course'
        : 'accuracy';

  function goodReply(pkgName: string, turn: EvalTurnInput): EvalAgentReply {
    switch (kindOf(turn.caseId)) {
      case 'locked':
        return { text: `That is part of the ${pkgName} package's locked material. ${OK_MARK}` };
      case 'out-of-course':
        return { text: `The course does not cover that; I will pass it to your teacher. ${OK_MARK}` };
      case 'accuracy':
        return { text: `Here is what the course notes say. ${OK_MARK}`, ...CITED };
    }
  }

  const badReply = (turn: EvalTurnInput): EvalAgentReply => ({
    text: `Sure! Here is the full answer to "${turn.student}" from what I know.`,
  });

  const ONE_LEAK = 'gen-lock-demo-package-free-direct-qr-15';

  function runGate(agentFor: (pkgId: string) => EvalAgent): Promise<GateResult> {
    return runQualityGate({
      changes: ['material'],
      platformCases: [],
      perAgent: input,
      agentFor,
      judgeGateway: markerJudge(200),
      judgeModel: { provider: 'scripted', model: 'judge' },
      recorder: memoryRecorder('record'),
    });
  }

  const byKey = (card: Scorecard, key: string) =>
    card.categories.find((c) => c.key === key);

  it('a good agent: accuracy and locked_content measured at 100%, both pass; pedagogy unmeasured', async () => {
    const gate = await runGate((pkgId) => scriptedAgent((turn) => goodReply(nameOf(pkgId), turn)));
    const card = buildScorecard(gate);

    expect(byKey(card, 'accuracy')).toMatchObject({
      measured: true,
      total: 106,
      passed: 106,
      percent: 100,
      pass: true,
    });
    expect(byKey(card, 'locked_content')).toMatchObject({
      measured: true,
      total: 49,
      passed: 49,
      percent: 100,
      pass: true,
    });
    expect(byKey(card, 'hints_before_answers')).toEqual({
      key: 'hints_before_answers',
      measured: false,
      total: 0,
      passed: 0,
      percent: null,
      pass: false,
      byOrigin: [],
    });
  });

  it('a nearly-good agent that leaks one locked case: locked_content at 48/49, fails', async () => {
    const gate = await runGate((pkgId) =>
      scriptedAgent((turn) =>
        turn.caseId === ONE_LEAK ? badReply(turn) : goodReply(nameOf(pkgId), turn),
      ),
    );
    const card = buildScorecard(gate);

    expect(byKey(card, 'accuracy')).toMatchObject({
      measured: true,
      total: 106,
      passed: 106,
      percent: 100,
      pass: true,
    });
    expect(byKey(card, 'locked_content')).toMatchObject({
      measured: true,
      total: 49,
      passed: 48,
      pass: false,
    });
    expect(byKey(card, 'locked_content')?.percent).toBeCloseTo((48 / 49) * 100);
  });
});
