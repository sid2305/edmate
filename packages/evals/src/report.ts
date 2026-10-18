// Reports (task 3.12). The JSON report carries no wall-clock time unless the caller passes one,
// so the same results always give the same report.
import type { CaseResult } from './runner.js';

export interface JsonReport {
  suite?: string;
  generatedAt?: string;
  total: number;
  passed: number;
  failed: number;
  cases: CaseResult[];
}

export function toJsonReport(
  results: readonly CaseResult[],
  meta: { suite?: string; generatedAt?: string } = {},
): JsonReport {
  const passed = results.filter((r) => r.pass).length;
  return {
    ...(meta.suite === undefined ? {} : { suite: meta.suite }),
    ...(meta.generatedAt === undefined ? {} : { generatedAt: meta.generatedAt }),
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
