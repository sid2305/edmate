// 13.2: nearest-rank percentile for latency samples (used by scripts/loadTest50.ts; the one piece
// of that load test's logic that is deterministic and belongs in the normal, CI-gated test suite).

/**
 * The nearest-rank percentile of `sorted` (already ascending). `p` is 0-100. Throws on an empty
 * array: there is no percentile of nothing.
 */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) throw new Error('percentile: sorted array is empty');
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(Math.max(rank, 1), sorted.length) - 1;
  return sorted[index] as number;
}
