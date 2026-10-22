// Task 7.4 acceptance: "a deliberately bad agent cannot publish; a material change finishes in
// < 15 minutes". A material-change gate on the public demo teacher (7.3's per-agent suite),
// through scripted agents and a scripted judge: no model call (rule 4).
import { describe, expect, it, vi } from 'vitest';
import type { EvalAgent, EvalAgentReply, EvalTurnInput } from './agent.js';
import { demoSuiteInput } from './demoSuiteInput.testkit.js';
import { CITED, markerJudge, OK_MARK, scriptedAgent } from './gate.testkit.js';
import { gatedPublish, runQualityGate, type GateResult } from './qualityGate.js';
import { memoryRecorder } from './recorder.js';

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

/** Gives the locked-package reply, defers out-of-course questions, answers with a source. */
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

/** Teaches locked modules, answers anything from general knowledge, cites nothing. */
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

const groupsOf = (r: GateResult) =>
  r.groups.map((g) => `${g.origin}:${g.group} ${g.passed}/${g.total} ${g.pass ? 'pass' : 'FAIL'}`);

describe('material-change quality gate on the demo teacher (task 7.4 acceptance)', () => {
  it('blocks a deliberately bad agent: publish is never called and the failures are named', async () => {
    const publish = vi.fn(() => Promise.resolve('published'));
    const out = await gatedPublish(() => runGate(() => scriptedAgent(badReply)), publish);
    expect(out.published).toBe(false);
    expect(publish).not.toHaveBeenCalled();
    expect(out.gate.pass).toBe(false);
    expect(groupsOf(out.gate)).toEqual(['agent:accuracy 0/106 FAIL', 'agent:locked 0/49 FAIL']);
    expect(out.gate.failedCaseIds).toHaveLength(155);
    expect(out.gate.failedCaseIds).toContain(ONE_LEAK);
  });

  it('blocks a nearly good agent that leaks exactly one locked case (locked = 0 leaks)', async () => {
    const publish = vi.fn(() => Promise.resolve('published'));
    const out = await gatedPublish(
      () =>
        runGate((pkgId) =>
          scriptedAgent((turn) =>
            turn.caseId === ONE_LEAK ? badReply(turn) : goodReply(nameOf(pkgId), turn),
          ),
        ),
      publish,
    );
    expect(out.published).toBe(false);
    expect(publish).not.toHaveBeenCalled();
    expect(groupsOf(out.gate)).toEqual(['agent:accuracy 106/106 pass', 'agent:locked 48/49 FAIL']);
    expect(out.gate.failedCaseIds).toEqual([ONE_LEAK]);
  });

  it('publishes a good agent exactly once, and the material gate fits in 15 minutes', async () => {
    const publish = vi.fn(() => Promise.resolve('published'));
    const out = await gatedPublish(
      () => runGate((pkgId) => scriptedAgent((turn) => goodReply(nameOf(pkgId), turn))),
      publish,
    );
    expect(out).toMatchObject({ published: true, value: 'published' });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(groupsOf(out.gate)).toEqual(['agent:accuracy 106/106 pass', 'agent:locked 49/49 pass']);
    // The "< 15 minutes" proxy: counted calls at 8 s each, 4 at a time (Graham bound).
    expect(out.gate.stats.estimatedSeconds).toBeLessThan(900);
    expect(out.gate.stats).toMatchInlineSnapshot(`
      {
        "agentCalls": 155,
        "cases": 155,
        "concurrency": 4,
        "criticalPathCalls": 80,
        "deadlineMs": 900000,
        "deadlinePassed": false,
        "estimatedSeconds": 640,
        "judgeCalls": 155,
        "maxCallsPerCase": 2,
        "notRun": 0,
        "totalCalls": 310,
      }
    `);
  });
});
