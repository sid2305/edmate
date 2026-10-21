// Turn health: p50/p95 latency (incl. first token), error and guard rates, computed from traces
// (7.7, build plan § Turn pipeline spec). Pure: no db, no model calls, no new deps.
import type { TurnTrace } from '@edmate/contracts';

export interface LatencyStats {
  p50: number;
  p95: number;
  n: number;
}

export interface HealthMetrics {
  turns: number;
  /** Keyed by `trace.steps[].name`, including the derived `firstToken` entry. Per step, not a
   * single blended total: steps 3/4/6 run concurrently, so summing would overstate wall time. */
  stepLatencyMs: Partial<Record<string, LatencyStats>>;
  /** Turns with >=1 step outcome 'failed', over total turns. */
  errorRate: number;
  errorsByStep: Partial<Record<string, number>>;
  /** Turns with >=1 guard { ok: false }, over total turns. */
  guardRate: number;
  guardsByName: Record<string, number>;
}

/** Nearest-rank percentile; only called with a non-empty, already-sorted array. */
function percentile(sorted: readonly number[], p: number): number {
  const n = sorted.length;
  const idx = Math.min(n - 1, Math.ceil((p / 100) * n) - 1);
  return sorted[idx] ?? 0;
}

/** Only called with a non-empty array: `byStep`'s lists are seeded with their first value. */
function latencyStats(values: number[]): LatencyStats {
  const sorted = [...values].sort((a, b) => a - b);
  return { p50: percentile(sorted, 50), p95: percentile(sorted, 95), n: sorted.length };
}

export function computeHealthMetrics(traces: readonly TurnTrace[]): HealthMetrics {
  const byStep = new Map<string, number[]>();
  const errorsByStep: Record<string, number> = {};
  const guardsByName: Record<string, number> = {};
  let errorTurns = 0;
  let guardTurns = 0;

  for (const t of traces) {
    let hadError = false;
    for (const s of t.steps) {
      const list = byStep.get(s.name);
      if (list === undefined) byStep.set(s.name, [s.ms]);
      else list.push(s.ms);
      if (s.outcome === 'failed') {
        hadError = true;
        errorsByStep[s.name] = (errorsByStep[s.name] ?? 0) + 1;
      }
    }
    if (hadError) errorTurns += 1;

    let hadGuard = false;
    for (const g of t.guards) {
      if (!g.ok) {
        hadGuard = true;
        guardsByName[g.name] = (guardsByName[g.name] ?? 0) + 1;
      }
    }
    if (hadGuard) guardTurns += 1;
  }

  const stepLatencyMs: Partial<Record<string, LatencyStats>> = {};
  for (const [name, values] of byStep) stepLatencyMs[name] = latencyStats(values);

  const turns = traces.length;
  return {
    turns,
    stepLatencyMs,
    errorRate: turns === 0 ? 0 : errorTurns / turns,
    errorsByStep,
    guardRate: turns === 0 ? 0 : guardTurns / turns,
    guardsByName,
  };
}
