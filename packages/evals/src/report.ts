// Reports (task 3.12). The JSON report carries no wall-clock time unless the caller passes one,
// so the same results always give the same report.
import type { CalibrationSummary } from './calibration.js';
import type { CaseResult } from './runner.js';

/** Cost per turn for one (model, suite) run (task 7.6 Phase B), from the run's usage rows. */
export interface ReportCost {
  /** Sum of every priced call's `costMicroUsd`, divided by the suite's total turn count. */
  perTurnMicroUsd: number;
  /** The same sum, split by the tier (`small`/`main`) the call actually used (lead answer Q3). */
  byTier: Record<string, number>;
  /** Calls with no price in the price table (`costMicroUsd: null`); never silently free. */
  unpricedCalls: number;
}

export interface JsonReport {
  suite?: string;
  generatedAt?: string;
  /** The `provider:model` label of the judge used for this run's judge fixtures, if any. */
  judgeModel?: string;
  /** Present only when a human double-check pass has been run against this report. */
  calibration?: CalibrationSummary;
  /** The configured model label this run used (task 7.6 Phase B, `evals/live-models.yaml`). */
  model?: string;
  /** Cost per turn for this (model, suite) run, from `memoryUsageMeter().rows` (task 7.6 Phase B). */
  cost?: ReportCost;
  total: number;
  passed: number;
  failed: number;
  cases: CaseResult[];
}

export function toJsonReport(
  results: readonly CaseResult[],
  meta: {
    suite?: string;
    generatedAt?: string;
    judgeModel?: string;
    calibration?: CalibrationSummary;
    model?: string;
    cost?: ReportCost;
  } = {},
): JsonReport {
  const passed = results.filter((r) => r.pass).length;
  return {
    ...(meta.suite === undefined ? {} : { suite: meta.suite }),
    ...(meta.generatedAt === undefined ? {} : { generatedAt: meta.generatedAt }),
    ...(meta.judgeModel === undefined ? {} : { judgeModel: meta.judgeModel }),
    ...(meta.calibration === undefined ? {} : { calibration: meta.calibration }),
    ...(meta.model === undefined ? {} : { model: meta.model }),
    ...(meta.cost === undefined ? {} : { cost: meta.cost }),
    total: results.length,
    passed,
    failed: results.length - passed,
    cases: structuredClone([...results]),
  };
}

/**
 * `<passed>/<total> passed`, then one line per failing case (its error, or its first failing
 * check), then every fixture a --record run overwrote.
 */
export function toSummary(
  results: readonly CaseResult[],
  opts: { overwritten?: readonly string[] } = {},
): string {
  const passed = results.filter((r) => r.pass).length;
  const lines = [`${passed}/${results.length} passed`];
  for (const r of results) {
    if (r.pass) continue;
    if (r.error !== undefined) {
      lines.push(`FAIL ${r.id} error: ${r.error}`);
      continue;
    }
    const turn = r.turns.find((t) => !t.pass);
    const check = turn?.checks.find((c) => !c.pass);
    const what =
      check === undefined
        ? ''
        : ` ${check.name}${check.detail === undefined ? '' : `: ${check.detail}`}`;
    lines.push(`FAIL ${r.id}${turn === undefined ? '' : ` turn ${turn.turnIndex}`}${what}`);
  }
  const overwritten = opts.overwritten ?? [];
  if (overwritten.length > 0) {
    const noun = overwritten.length === 1 ? 'fixture' : 'fixtures';
    lines.push(`overwrote ${overwritten.length} recorded ${noun}:`);
    for (const key of overwritten) lines.push(`  ${key}`);
  }
  return lines.join('\n') + '\n';
}
