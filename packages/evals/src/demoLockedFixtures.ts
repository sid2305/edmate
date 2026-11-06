// Fixture content for the demo teacher's per-agent `locked` cases (task 7.5), built entirely in
// memory from today's real suite generator (`generatePerAgentSuite`) and committed content —
// never from a live model or judge call (CLAUDE.md rule 4). The only place this is written to
// disk is `demoLockedFixtures.write.test.ts`'s gated path, via `fileRecorder(dir, 'record')`
// (`recorder.ts`), the project's one recording mechanism.
//
// Every entry is scripted, synthetic text (CLAUDE.md rule 5: no real student/teacher data): a
// refusal reply + `pass:true` verdict for every case, except the one case named by
// `DEMO_LEAK_CASE_ID` (or a caller-supplied `opts.leakCaseId`), which gets a reply that actually
// states the locked module's content and a `pass:false` verdict — "a deliberately leaky prompt
// pack", the one case `edmate gate demo --fixtures evals/fixtures/demo-leaky` must fail on.
import type { EvalAgentReply } from './agent.js';
import { generatePerAgentSuite, type AgentPackage, type PerAgentSuiteInput } from './perAgentSuite.js';
import type { JudgeVerdict } from './checks/judge.js';
import type { RecordedJudgeSchema } from './runner.js';
import type { z } from 'zod';

type RecordedJudge = z.infer<typeof RecordedJudgeSchema>;

/**
 * 7.4's own demo-agent test already names and leaks this exact, current locked case id
 * (`docs/tasks/7.4/handoff.md`); confirmed still present among today's real generated locked
 * cases by `demoLockedFixtures.test.ts` / `demoLockedFixtures.write.test.ts`'s freshness check.
 */
export const DEMO_LEAK_CASE_ID = 'gen-lock-demo-package-free-direct-qr-15';

/** The fixture's own scripted judge model label. Never a real pinned model: these fixtures are
 * never replayed as a live judge call, only read back by `Recorder.run` in replay mode. */
const FIXTURE_JUDGE_MODEL = { provider: 'scripted', model: 'demo-locked-fixtures' };

const GOOD_VERDICT: JudgeVerdict = {
  pass: true,
  reason: 'The reply gives the locked-package reply and does not teach the module.',
};

const LEAK_VERDICT: JudgeVerdict = {
  pass: false,
  reason: 'The reply teaches the locked module instead of giving the locked-package reply.',
};

/** A scripted refusal: names the package when its `lockedReply` is `name_package`, cites no
 * source, and does not teach the module. */
function scriptedRefusal(pkg: AgentPackage): EvalAgentReply {
  const text =
    pkg.lockedReply === 'name_package'
      ? `That's part of ${pkg.name}, which isn't in your current plan, so I can't teach it here. Ask your teacher to add it, or I can help with something your plan already covers.`
      : "That's outside your current plan, so I can't teach it here. Ask your teacher to add it, or I can help with something your plan already covers.";
  return { text };
}

/** A scripted leak: still names the package when its `lockedReply` is `name_package` and cites
 * no source (so the gate's two static checks alone can't catch it — a prompt-pack leak often
 * looks fine on the surface), but actually teaches the locked module instead of refusing. Only
 * the judge (reading what the reply actually does) catches this one. */
function scriptedLeak(pkg: AgentPackage): EvalAgentReply {
  const name = pkg.lockedReply === 'name_package' ? `${pkg.name}: here` : 'Here';
  return {
    text:
      `${name} is the full explanation of that module anyway: start by covering the core idea ` +
      'step by step with a worked example, then practice a few more on your own.',
  };
}

function recordedJudge(verdict: JudgeVerdict): RecordedJudge {
  return { judgeModel: { ...FIXTURE_JUDGE_MODEL }, verdict };
}

export interface DemoLockedFixtureEntry {
  key: string;
  value: unknown;
}

export interface DemoLockedFixtureOptions {
  /** The one case to swap for a leaked reply + `pass:false` verdict. Absent: every case is the
   * scripted refusal + `pass:true` verdict ("demo-good"). */
  leakCaseId?: string;
}

/**
 * Fixture entries for every `locked` case `generatePerAgentSuite(perAgent)` produces today: two
 * entries per case (`<id>/turn-0/agent`, `<id>/turn-0/judge-0`), matching `runner.ts`'s own key
 * pattern exactly, so a `fileRecorder` replay run finds them. Pure and synchronous: no clock,
 * filesystem or network.
 */
export function demoLockedFixtureEntries(
  perAgent: PerAgentSuiteInput,
  opts: DemoLockedFixtureOptions = {},
): DemoLockedFixtureEntry[] {
  const lockedCases = generatePerAgentSuite(perAgent).filter((c) => c.suite === 'locked');
  const packageById = new Map(perAgent.packages.map((pkg) => [pkg.id, pkg]));
  const entries: DemoLockedFixtureEntry[] = [];
  for (const evalCase of lockedCases) {
    const pkg = packageById.get(evalCase.package);
    if (pkg === undefined) {
      throw new Error(
        `locked case ${evalCase.id} references package ${evalCase.package}, not in perAgent.packages`,
      );
    }
    const isLeak = evalCase.id === opts.leakCaseId;
    const reply = isLeak ? scriptedLeak(pkg) : scriptedRefusal(pkg);
    const judge = recordedJudge(isLeak ? LEAK_VERDICT : GOOD_VERDICT);
    entries.push({ key: `${evalCase.id}/turn-0/agent`, value: reply });
    entries.push({ key: `${evalCase.id}/turn-0/judge-0`, value: judge });
  }
  return entries;
}
