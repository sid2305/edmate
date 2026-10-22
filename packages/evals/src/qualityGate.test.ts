// Task 7.4: the quality gate on a small synthetic world (scripted agent, scripted judge).
import { describe, expect, it, vi } from 'vitest';
import { CITED, markerJudge, OK_MARK, scriptedAgent } from './gate.testkit.js';
import { FULL_SCOPE_GATE_DEADLINE_MS, GateScopeError } from './gateScope.js';
import type { PerAgentSuiteInput } from './perAgentSuite.js';
import {
  ASSUMED_CALL_SECONDS,
  DEADLINE_NOT_RUN,
  GATE_CONCURRENCY,
  GATE_DEADLINE_MS,
  gatedPublish,
  gateStats,
  groupVerdict,
  runQualityGate,
  type GateInput,
  type GateResult,
} from './qualityGate.js';
import { memoryRecorder } from './recorder.js';
import type { EvalCase } from './schema.js';
import type { EvalAgent } from './agent.js';

/** One package `p1` covering module m1, with `n` answerable items: n accuracy cases, no locked. */
function world(n: number): PerAgentSuiteInput {
  return {
    teacherId: 't1',
    agentId: 'a1',
    packages: [
      { id: 'p1', name: 'Starter', moduleIds: ['m1'], lockedReply: 'generic', sourceLabel: 'p1' },
    ],
    answerable: Array.from({ length: n }, (_, i) => ({
      id: `q-${i}`,
      moduleId: 'm1',
      question: `Question number ${i}?`,
      answer: `Answer ${i}.`,
      provenance: 'question-bank' as const,
      sourceLabel: `bank#q-${i}`,
    })),
    outOfCourse: [],
  };
}

/** A good answer, except for the case ids in `failing`. */
function agentFailing(failing: readonly string[] = []) {
  return scriptedAgent((input) =>
    failing.includes(input.caseId) ? { text: 'wrong' } : { text: `right ${OK_MARK}`, ...CITED },
  );
}

function gateInput(over: Partial<GateInput> = {}): GateInput {
  const agent = agentFailing();
  return {
    changes: ['material'],
    platformCases: [],
    perAgent: world(4),
    agentFor: () => agent,
    judgeGateway: markerJudge(200),
    judgeModel: { provider: 'scripted', model: 'judge' },
    recorder: memoryRecorder('record'),
    ...over,
  };
}

const accId = (i: number) => `gen-acc-p1-q-${i}`;

describe('runQualityGate', () => {
  it('passes accuracy at exactly 99% and fails just below it', async () => {
    const onePercent = await runQualityGate(
      gateInput({ perAgent: world(100), agentFor: () => agentFailing([accId(7)]) }),
    );
    expect(onePercent.groups).toEqual([
      {
        origin: 'agent',
        group: 'accuracy',
        total: 100,
        passed: 99,
        minPercent: 99,
        pass: true,
      },
    ]);
    expect(onePercent.pass).toBe(true);
    expect(onePercent.failedCaseIds).toEqual([accId(7)]);

    const twoPercent = await runQualityGate(
      gateInput({ perAgent: world(100), agentFor: () => agentFailing([accId(7), accId(8)]) }),
    );
    expect(twoPercent.pass).toBe(false);
    expect(twoPercent.groups[0]).toMatchObject({
      passed: 98,
      pass: false,
      reason: 'below_threshold',
    });
    expect(twoPercent.failedCaseIds).toEqual([accId(7), accId(8)]);
  });

  it('fails an expected group with no cases (empty_group), never a vacuous pass', async () => {
    const r = await runQualityGate(gateInput({ perAgent: world(0) }));
    expect(r.pass).toBe(false);
    expect(r.groups).toEqual([
      {
        origin: 'agent',
        group: 'accuracy',
        total: 0,
        passed: 0,
        minPercent: 99,
        pass: false,
        reason: 'empty_group',
      },
    ]);
  });

  it('expects per-agent locked cases when a package locks a module', async () => {
    const perAgent: PerAgentSuiteInput = {
      ...world(2),
      packages: [
        ...world(0).packages,
        {
          id: 'p0',
          name: 'Nothing',
          moduleIds: [],
          lockedReply: 'name_package',
          sourceLabel: 'p0',
        },
      ],
    };
    const agent = scriptedAgent((input) =>
      input.caseId.startsWith('gen-lock-')
        ? { text: `That is in another package. ${OK_MARK}` }
        : { text: `right ${OK_MARK}`, ...CITED },
    );
    const r = await runQualityGate(gateInput({ perAgent, agentFor: () => agent }));
    expect(r.groups.map((g) => `${g.origin}:${g.group}:${g.total}:${g.passed}`)).toEqual([
      'agent:accuracy:2:2',
      // 2 direct + 3 module templates, every one missing the package name "Nothing".
      'agent:locked:5:0',
    ]);
    expect(r.pass).toBe(false);
  });

  it('throws on an unknown suite or a duplicate id before running anything', async () => {
    const agent = agentFailing();
    const nonsense: EvalCase = {
      id: 'ns-1',
      suite: 'nonsense-suite',
      package: 'p1',
      reviewed_by: 'lead',
      source: 's',
      turns: [{ student: 'hi', expect: { must_contain: ['x'] } }],
    };
    await expect(
      runQualityGate(
        gateInput({ changes: ['first_publish'], platformCases: [nonsense], agentFor: () => agent }),
      ),
    ).rejects.toThrow(GateScopeError);
    await expect(
      runQualityGate(
        gateInput({
          changes: ['first_publish'],
          platformCases: [{ ...nonsense, id: accId(0), suite: 'leak' }],
          agentFor: () => agent,
        }),
      ),
    ).rejects.toThrow(/duplicate case id/);
    expect(agent.calls).toEqual([]);
  });

  it('records a case whose agent throws as failed, with its error', async () => {
    const agent = scriptedAgent((input) => {
      if (input.caseId === accId(1)) throw new Error('agent crashed');
      return { text: `right ${OK_MARK}`, ...CITED };
    });
    const r = await runQualityGate(gateInput({ agentFor: () => agent }));
    expect(r.pass).toBe(false);
    expect(r.failedCaseIds).toEqual([accId(1)]);
    expect(r.results[1]).toMatchObject({ id: accId(1), pass: false, error: 'agent crashed' });
  });

  it('routes each case to its package agent, asking agentFor once per package', async () => {
    const perAgent: PerAgentSuiteInput = {
      ...world(1),
      packages: [
        ...world(0).packages,
        { id: 'p2', name: 'Also', moduleIds: ['m1'], lockedReply: 'generic', sourceLabel: 'p2' },
      ],
    };
    const agents = new Map<string, EvalAgent & { calls: { caseId: string }[] }>();
    const agentFor = vi.fn((pkg: string) => {
      const a = agentFailing();
      agents.set(pkg, a);
      return a;
    });
    const r = await runQualityGate(gateInput({ perAgent, agentFor }));
    expect(r.pass).toBe(true);
    expect(agentFor.mock.calls.map((c) => c[0])).toEqual(['p1', 'p2']);
    expect(agents.get('p1')?.calls.map((c) => c.caseId)).toEqual(['gen-acc-p1-q-0']);
    expect(agents.get('p2')?.calls.map((c) => c.caseId)).toEqual(['gen-acc-p2-q-0']);
  });

  it('keeps results in case order and never runs more than `concurrency` at once', async () => {
    let inFlight = 0;
    let peak = 0;
    const agent = scriptedAgent(async (input) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      // Later cases finish sooner, so completion order differs from case order.
      const ticks = 20 - Number(input.caseId.split('-').pop());
      for (let i = 0; i < ticks; i += 1) await Promise.resolve();
      inFlight -= 1;
      return { text: `right ${OK_MARK}`, ...CITED };
    });
    const r = await runQualityGate(
      gateInput({ perAgent: world(10), agentFor: () => agent, concurrency: 3 }),
    );
    expect(r.results.map((x) => x.id)).toEqual(Array.from({ length: 10 }, (_, i) => accId(i)));
    expect(peak).toBe(3);
    expect(r.stats.concurrency).toBe(3);
  });

  it('rejects a concurrency or deadline that is not a positive integer', async () => {
    for (const concurrency of [0, 1.5, Number.NaN]) {
      await expect(runQualityGate(gateInput({ concurrency }))).rejects.toThrow(RangeError);
    }
    await expect(runQualityGate(gateInput({ deadlineMs: 0 }))).rejects.toThrow(RangeError);
  });

  it('fails closed once the deadline passes: no new case starts, the rest are marked not run', async () => {
    let clock = 1_000;
    const agent = scriptedAgent(() => {
      clock += 6 * 60_000; // each reply "takes" six minutes
      return { text: `right ${OK_MARK}`, ...CITED };
    });
    const r = await runQualityGate(
      gateInput({ perAgent: world(5), agentFor: () => agent, concurrency: 1, now: () => clock }),
    );
    // Cases start at 0, 6 and 12 minutes; the fourth would start at 18 > 15.
    expect(agent.calls).toHaveLength(3);
    expect(r.pass).toBe(false);
    expect(r.results.slice(3)).toEqual([
      { id: accId(3), suite: 'accuracy', pass: false, error: DEADLINE_NOT_RUN, turns: [] },
      { id: accId(4), suite: 'accuracy', pass: false, error: DEADLINE_NOT_RUN, turns: [] },
    ]);
    expect(r.failedCaseIds).toEqual([accId(3), accId(4)]);
    expect(r.stats).toMatchObject({ deadlinePassed: true, notRun: 2, cases: 5 });
    expect(DEADLINE_NOT_RUN).toBe('not run: gate deadline passed');
  });

  it('fails closed on a deadline overrun even when the threshold would allow the misses', async () => {
    let clock = 0;
    const agent = scriptedAgent(() => {
      clock += 1;
      return { text: `right ${OK_MARK}`, ...CITED };
    });
    const r = await runQualityGate(
      gateInput({
        perAgent: world(200),
        agentFor: () => agent,
        concurrency: 1,
        deadlineMs: 199,
        now: () => clock,
      }),
    );
    expect(r.stats.notRun).toBe(1);
    expect(r.groups[0]).toMatchObject({ passed: 199, total: 200, pass: true });
    expect(r.pass).toBe(false);
  });

  it('counts calls and estimates the critical path', async () => {
    const r = await runQualityGate(gateInput({ perAgent: world(5) }));
    // 5 cases x (1 agent turn + 1 judge statement) = 10 calls; ceil(10 / 4) + 2 = 5.
    expect(r.stats).toEqual({
      cases: 5,
      notRun: 0,
      deadlinePassed: false,
      deadlineMs: GATE_DEADLINE_MS,
      agentCalls: 5,
      judgeCalls: 5,
      totalCalls: 10,
      maxCallsPerCase: 2,
      concurrency: GATE_CONCURRENCY,
      criticalPathCalls: 5,
      estimatedSeconds: 5 * ASSUMED_CALL_SECONDS,
    });
    expect({ GATE_CONCURRENCY, ASSUMED_CALL_SECONDS, GATE_DEADLINE_MS }).toEqual({
      GATE_CONCURRENCY: 4,
      ASSUMED_CALL_SECONDS: 8,
      GATE_DEADLINE_MS: 900_000,
    });
  });

  it('returns JSON-serialisable results', async () => {
    const r = await runQualityGate(gateInput());
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    expect(r.changes).toEqual(['material']);
  });

  it('task 7.4c: a full-scope gate gets the 120-minute default, not the 15-minute one', async () => {
    let clock = 0;
    const agent = scriptedAgent(() => {
      clock += 8 * 60_000; // each reply "takes" eight minutes
      return { text: `right ${OK_MARK}`, ...CITED };
    });
    // 10 cases x 8 minutes = an ~80-minute critical path: under 120 min, over 15 min.
    const r = await runQualityGate(
      gateInput({
        changes: ['first_publish'],
        platformCases: [],
        perAgent: world(10),
        agentFor: () => agent,
        concurrency: 1,
        now: () => clock,
      }),
    );
    expect(agent.calls).toHaveLength(10);
    expect(r.stats).toMatchObject({
      notRun: 0,
      deadlinePassed: false,
      deadlineMs: FULL_SCOPE_GATE_DEADLINE_MS,
    });
  });

  it('task 7.4c: the same ~80-minute run trips the 15-minute default under a material-only scope', async () => {
    let clock = 0;
    const agent = scriptedAgent(() => {
      clock += 8 * 60_000;
      return { text: `right ${OK_MARK}`, ...CITED };
    });
    const r = await runQualityGate(
      gateInput({
        changes: ['material'],
        perAgent: world(10),
        agentFor: () => agent,
        concurrency: 1,
        now: () => clock,
      }),
    );
    expect(agent.calls).toHaveLength(2);
    expect(r.stats).toMatchObject({ notRun: 8, deadlinePassed: true, deadlineMs: GATE_DEADLINE_MS });
    expect(r.pass).toBe(false);
    expect(r.results.some((x) => x.error === DEADLINE_NOT_RUN)).toBe(true);
  });

  it('task 7.4c: an explicit deadlineMs on a full-scope input overrides the default both ways', async () => {
    let clock = 0;
    const tinyDeadlineAgent = scriptedAgent(() => {
      clock += 8 * 60_000;
      return { text: `right ${OK_MARK}`, ...CITED };
    });
    const shorter = await runQualityGate(
      gateInput({
        changes: ['first_publish'],
        platformCases: [],
        perAgent: world(10),
        agentFor: () => tinyDeadlineAgent,
        concurrency: 1,
        now: () => clock,
        deadlineMs: 5 * 60_000, // shorter than the 120-min full-scope default
      }),
    );
    expect(tinyDeadlineAgent.calls).toHaveLength(1);
    expect(shorter.stats).toMatchObject({ notRun: 9, deadlinePassed: true, deadlineMs: 5 * 60_000 });

    clock = 0;
    const generousDeadlineAgent = scriptedAgent(() => {
      clock += 8 * 60_000;
      return { text: `right ${OK_MARK}`, ...CITED };
    });
    const longer = await runQualityGate(
      gateInput({
        changes: ['material'], // the 15-min default would trip this run; the override doesn't
        perAgent: world(10),
        agentFor: () => generousDeadlineAgent,
        concurrency: 1,
        now: () => clock,
        deadlineMs: 200 * 60_000, // longer than both the 15-min and 120-min defaults
      }),
    );
    expect(generousDeadlineAgent.calls).toHaveLength(10);
    expect(longer.stats).toMatchObject({
      notRun: 0,
      deadlinePassed: false,
      deadlineMs: 200 * 60_000,
    });
  });
});

describe('gateStats', () => {
  it('is zero for no cases and counts every turn and judge statement', () => {
    expect(gateStats([], 4)).toMatchObject({
      totalCalls: 0,
      criticalPathCalls: 0,
      estimatedSeconds: 0,
    });
    const twoTurns: EvalCase = {
      id: 'c',
      suite: 'persona',
      package: 'p',
      reviewed_by: 'lead',
      source: 's',
      turns: [{ student: 'a' }, { student: 'b', expect: { judge: ['x', 'y'], max_words: 3 } }],
    };
    expect(gateStats([twoTurns, twoTurns], 4)).toMatchObject({
      agentCalls: 4,
      judgeCalls: 4,
      totalCalls: 8,
      maxCallsPerCase: 4,
      criticalPathCalls: 2 + 4,
    });
  });
});

describe('groupVerdict', () => {
  it('compares in integers at the boundary', () => {
    expect(groupVerdict('agent', 'leak', 50, 49)).toMatchObject({ pass: true, minPercent: 98 });
    expect(groupVerdict('agent', 'leak', 50, 48)).toMatchObject({ pass: false });
    expect(groupVerdict('platform', 'locked', 3, 3)).toMatchObject({ pass: true });
    expect(groupVerdict('platform', 'locked', 3, 2).reason).toBe('below_threshold');
    expect(groupVerdict('platform', 'pedagogy', 5, 4)).toMatchObject({
      pass: true,
      minPercent: 80,
    });
  });
});

describe('gatedPublish', () => {
  const result = (pass: boolean) => ({ pass }) as GateResult;

  it('publishes exactly once on a passing gate', async () => {
    const publish = vi.fn(() => Promise.resolve('v1'));
    await expect(gatedPublish(() => Promise.resolve(result(true)), publish)).resolves.toEqual({
      published: true,
      gate: result(true),
      value: 'v1',
    });
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('never publishes on a failing gate', async () => {
    const publish = vi.fn(() => Promise.resolve('v1'));
    await expect(gatedPublish(() => Promise.resolve(result(false)), publish)).resolves.toEqual({
      published: false,
      gate: result(false),
    });
    expect(publish).not.toHaveBeenCalled();
  });

  it('never publishes when the gate throws, or when pass is anything but true', async () => {
    const publish = vi.fn(() => Promise.resolve('v1'));
    await expect(gatedPublish(() => Promise.reject(new Error('boom')), publish)).rejects.toThrow(
      'boom',
    );
    const truthy = { pass: 'yes' } as unknown as GateResult;
    await expect(gatedPublish(() => Promise.resolve(truthy), publish)).resolves.toMatchObject({
      published: false,
    });
    expect(publish).not.toHaveBeenCalled();
  });
});
