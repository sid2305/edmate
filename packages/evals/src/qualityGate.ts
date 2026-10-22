// The quality gate (task 7.4): runs the cases a change puts in scope, scores each group against
// its publish threshold, and blocks publish on any failure. `gatedPublish` is the only publish
// path offered; 8.7 wires the real publish into it.
//
// "A material change finishes in < 15 minutes" is shown by a simulated critical-path time from
// counted model calls (wall clock means nothing under a scripted gateway) and enforced at run
// time by a deadline: once it passes no new case starts, and the gate fails closed.
import type { ModelGateway } from '@edmate/contracts';
import type { EvalAgent } from './agent.js';
import {
  GATE_THRESHOLDS,
  selectGateCases,
  type ChangeKind,
  type GateGroup,
  type GateOrigin,
  type ScopedCase,
} from './gateScope.js';
import type { JudgeModelConfig } from './judgeModel.js';
import { generatePerAgentSuite, type PerAgentSuiteInput } from './perAgentSuite.js';
import type { Recorder } from './recorder.js';
import { runCaseSafely, type CaseResult, type RunOptions } from './runner.js';
import type { EvalCase } from './schema.js';

/** Cases run at once. Provisional until 7.6 / 7.7 measure real throughput (lead, Q6). */
export const GATE_CONCURRENCY = 4;
/**
 * Conservative p95 seconds for one fully guarded agent turn or one judge call. Provisional
 * until 7.6 / 7.7 measure real p95 (lead, Q6).
 */
export const ASSUMED_CALL_SECONDS = 8;
/** Run-time deadline: the acceptance's "< 15 minutes". */
export const GATE_DEADLINE_MS = 15 * 60_000;
export const DEADLINE_NOT_RUN = 'not run: gate deadline passed';

export interface GateInput {
  changes: readonly ChangeKind[];
  platformCases: readonly EvalCase[];
  perAgent: PerAgentSuiteInput;
  /** One agent per package id (EvalTurnInput carries no package, so the gate routes by case). */
  agentFor: (packageId: string) => EvalAgent;
  judgeGateway: ModelGateway;
  judgeModel?: JudgeModelConfig;
  recorder: Recorder;
  styleSampleSeed?: string;
  concurrency?: number;
  deadlineMs?: number;
  now?: () => number;
}

export interface GateGroupResult {
  origin: GateOrigin;
  group: GateGroup;
  total: number;
  passed: number;
  minPercent: number;
  pass: boolean;
  reason?: 'empty_group' | 'below_threshold';
}

export interface GateStats {
  /** Cases in scope, run or not. */
  cases: number;
  /** Cases never started because the deadline passed; each counts as failed. */
  notRun: number;
  deadlinePassed: boolean;
  deadlineMs: number;
  /** One per turn of every case run (replayed or live alike). */
  agentCalls: number;
  /** One per judge statement of every case run. */
  judgeCalls: number;
  totalCalls: number;
  maxCallsPerCase: number;
  concurrency: number;
  /** ceil(totalCalls / concurrency) + maxCallsPerCase: Graham's list-scheduling upper bound. */
  criticalPathCalls: number;
  estimatedSeconds: number;
}

export interface GateResult {
  pass: boolean;
  changes: ChangeKind[];
  groups: GateGroupResult[];
  failedCaseIds: string[];
  /** In scope order. */
  results: CaseResult[];
  stats: GateStats;
}

export function groupVerdict(
  origin: GateOrigin,
  group: GateGroup,
  total: number,
  passed: number,
): GateGroupResult {
  const minPercent = GATE_THRESHOLDS[group];
  const base = { origin, group, total, passed, minPercent };
  if (total === 0) return { ...base, pass: false, reason: 'empty_group' };
  if (passed * 100 < minPercent * total) return { ...base, pass: false, reason: 'below_threshold' };
  return { ...base, pass: true };
}

function callsOf(evalCase: EvalCase): { agent: number; judge: number } {
  return {
    agent: evalCase.turns.length,
    judge: evalCase.turns.reduce((n, t) => n + (t.expect?.judge?.length ?? 0), 0),
  };
}

/** Call counts and the simulated critical path for the cases that ran. */
export function gateStats(
  ran: readonly EvalCase[],
  concurrency: number,
): Pick<
  GateStats,
  | 'agentCalls'
  | 'judgeCalls'
  | 'totalCalls'
  | 'maxCallsPerCase'
  | 'concurrency'
  | 'criticalPathCalls'
  | 'estimatedSeconds'
> {
  let agentCalls = 0;
  let judgeCalls = 0;
  let maxCallsPerCase = 0;
  for (const c of ran) {
    const calls = callsOf(c);
    agentCalls += calls.agent;
    judgeCalls += calls.judge;
    maxCallsPerCase = Math.max(maxCallsPerCase, calls.agent + calls.judge);
  }
  const totalCalls = agentCalls + judgeCalls;
  const criticalPathCalls =
    totalCalls === 0 ? 0 : Math.ceil(totalCalls / concurrency) + maxCallsPerCase;
  return {
    agentCalls,
    judgeCalls,
    totalCalls,
    maxCallsPerCase,
    concurrency,
    criticalPathCalls,
    estimatedSeconds: criticalPathCalls * ASSUMED_CALL_SECONDS,
  };
}

function positiveInteger(value: number, what: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${what} must be a positive integer, got ${value}`);
  }
  return value;
}

/** True when some package excludes a module the course teaches: then something must be locked. */
function locksSomething(input: PerAgentSuiteInput): boolean {
  const modules = new Set(input.answerable.map((a) => a.moduleId));
  return input.packages.some((p) => [...modules].some((m) => !p.moduleIds.includes(m)));
}

export async function runQualityGate(input: GateInput): Promise<GateResult> {
  const concurrency = positiveInteger(input.concurrency ?? GATE_CONCURRENCY, 'concurrency');
  const deadlineMs = positiveInteger(input.deadlineMs ?? GATE_DEADLINE_MS, 'deadlineMs');
  const now = input.now ?? Date.now;
  const styleOnly = input.changes.every((c) => c === 'style_card');

  const scope = selectGateCases({
    changes: input.changes,
    platformCases: input.platformCases,
    perAgentCases: styleOnly ? undefined : generatePerAgentSuite(input.perAgent),
    requireAgentLocked: locksSomething(input.perAgent),
    styleSampleSeed: input.styleSampleSeed,
  });

  const agents = new Map<string, EvalAgent>();
  const optsFor = (packageId: string): RunOptions => {
    let agent = agents.get(packageId);
    if (agent === undefined) {
      agent = input.agentFor(packageId);
      agents.set(packageId, agent);
    }
    return {
      agent,
      judgeGateway: input.judgeGateway,
      recorder: input.recorder,
      ...(input.judgeModel === undefined ? {} : { judgeModel: input.judgeModel }),
    };
  };

  const started = now();
  const results: CaseResult[] = new Array<CaseResult>(scope.cases.length);
  const ran: EvalCase[] = [];
  let next = 0;
  let deadlinePassed = false;
  const worker = async (): Promise<void> => {
    while (next < scope.cases.length) {
      const index = next;
      next += 1;
      const { evalCase } = scope.cases[index] as ScopedCase;
      if (deadlinePassed || now() - started >= deadlineMs) {
        deadlinePassed = true;
        results[index] = {
          id: evalCase.id,
          suite: evalCase.suite,
          pass: false,
          error: DEADLINE_NOT_RUN,
          turns: [],
        };
        continue;
      }
      ran.push(evalCase);
      results[index] = await runCaseSafely(evalCase, optsFor(evalCase.package));
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, scope.cases.length) }, () => worker()),
  );

  // Expected groups first (in scope order), then any other group a case fell into.
  const tally = new Map<
    string,
    { origin: GateOrigin; group: GateGroup; total: number; passed: number }
  >();
  const slot = (origin: GateOrigin, group: GateGroup) => {
    const key = `${origin}:${group}`;
    let entry = tally.get(key);
    if (entry === undefined) {
      entry = { origin, group, total: 0, passed: 0 };
      tally.set(key, entry);
    }
    return entry;
  };
  for (const g of scope.expectedGroups) slot(g.origin, g.group);
  scope.cases.forEach((c, i) => {
    const entry = slot(c.origin, c.group);
    entry.total += 1;
    if (results[i]?.pass === true) entry.passed += 1;
  });
  const groups = [...tally.values()].map((t) => groupVerdict(t.origin, t.group, t.total, t.passed));
  const notRun = results.filter((r) => r.error === DEADLINE_NOT_RUN).length;

  return {
    pass: notRun === 0 && groups.every((g) => g.pass),
    changes: [...input.changes],
    groups,
    failedCaseIds: results.filter((r) => !r.pass).map((r) => r.id),
    results,
    stats: {
      cases: scope.cases.length,
      notRun,
      deadlinePassed,
      deadlineMs,
      ...gateStats(ran, concurrency),
    },
  };
}

/** Calls `publish` only when the gate returns `pass: true`; a gate that throws never publishes. */
export async function gatedPublish<T>(
  gate: () => Promise<GateResult>,
  publish: () => Promise<T>,
): Promise<
  { published: true; gate: GateResult; value: T } | { published: false; gate: GateResult }
> {
  const result = await gate();
  if (result.pass !== true) return { published: false, gate: result };
  return { published: true, gate: result, value: await publish() };
}
