// The teaching scorecard (task 7.8): `GateResult -> Scorecard`, pure. Per-agent pass rates for
// hints-before-answers, locked content and accuracy, meant to be published with each agent
// version (build plan line 632, PRD line 518). Persistence and the "published with" wiring are
// 8.7's (lead, 21 Oct 2026, Q3): this module only reads a gate run it is handed.
//
// A category combines both `platform` and `agent` origin into one public number (lead, Q1), but
// keeps the per-origin split visible in `byOrigin` so the combination never hides one failing
// origin behind the other's pass: `pass` is true only when every contributing origin passed.
//
// A category whose group has no row at all in the gate run (out of scope for that change kind)
// is `measured: false` -- never a fabricated pass or fail for a question the run didn't ask.
import { z } from 'zod';
import type { GateGroup, GateOrigin } from './gateScope.js';
import type { GateGroupResult, GateResult } from './qualityGate.js';

/** Scorecard category -> the gate group it reports (build plan / PRD S14 wording). */
export const SCORECARD_GROUPS = {
  hints_before_answers: 'pedagogy',
  locked_content: 'locked',
  accuracy: 'accuracy',
} as const satisfies Record<string, GateGroup>;
export type ScorecardCategoryKey = keyof typeof SCORECARD_GROUPS;

const GATE_ORIGINS = ['platform', 'agent'] as const satisfies readonly GateOrigin[];

export interface ScorecardCategoryOrigin {
  origin: GateOrigin;
  total: number;
  passed: number;
}

export interface ScorecardCategory {
  key: ScorecardCategoryKey;
  /** False when the gate run's `groups` has no row for this category's group at all. */
  measured: boolean;
  total: number;
  passed: number;
  /** null when total === 0 (unmeasured, or an expected group that ran with zero cases). */
  percent: number | null;
  /** True only when every contributing origin's `GateGroupResult.pass` is true. */
  pass: boolean;
  /** The platform/agent split behind the combined rate, in `GATE_ORIGINS` order. */
  byOrigin: ScorecardCategoryOrigin[];
}

export interface Scorecard {
  pass: boolean;
  changes: GateResult['changes'];
  /** One per `SCORECARD_GROUPS` key, in that order. */
  categories: ScorecardCategory[];
}

const ScorecardCategoryOriginSchema = z.object({
  origin: z.enum(GATE_ORIGINS),
  total: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
});

const ScorecardCategorySchema = z.object({
  key: z.enum(Object.keys(SCORECARD_GROUPS) as [ScorecardCategoryKey, ...ScorecardCategoryKey[]]),
  measured: z.boolean(),
  total: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  percent: z.number().nullable(),
  pass: z.boolean(),
  byOrigin: z.array(ScorecardCategoryOriginSchema),
});

export const ScorecardSchema: z.ZodType<Scorecard> = z.object({
  pass: z.boolean(),
  changes: z.array(z.string()) as unknown as z.ZodType<Scorecard['changes']>,
  categories: z.array(ScorecardCategorySchema),
});

function unmeasured(key: ScorecardCategoryKey): ScorecardCategory {
  return { key, measured: false, total: 0, passed: 0, percent: null, pass: false, byOrigin: [] };
}

function combine(key: ScorecardCategoryKey, rows: readonly GateGroupResult[]): ScorecardCategory {
  const total = rows.reduce((sum, r) => sum + r.total, 0);
  const passed = rows.reduce((sum, r) => sum + r.passed, 0);
  return {
    key,
    measured: true,
    total,
    passed,
    percent: total === 0 ? null : (passed / total) * 100,
    pass: rows.every((r) => r.pass),
    byOrigin: rows.map((r) => ({ origin: r.origin, total: r.total, passed: r.passed })),
  };
}

/** Pure: reads only `gate.groups`, `gate.pass` and `gate.changes`. No clock, no I/O. */
export function buildScorecard(gate: GateResult): Scorecard {
  const categories = (Object.keys(SCORECARD_GROUPS) as ScorecardCategoryKey[]).map((key) => {
    const group = SCORECARD_GROUPS[key];
    const rows = gate.groups.filter((g) => g.group === group);
    return rows.length === 0 ? unmeasured(key) : combine(key, rows);
  });
  return { pass: gate.pass, changes: gate.changes, categories };
}
