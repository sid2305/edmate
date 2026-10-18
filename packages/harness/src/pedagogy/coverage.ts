// Access filter 3 and § Ask the teacher: the agent teaches only from the teacher's material.
// A question nothing allowed covers goes to `locked` when it matches a locked module, otherwise
// to `ask_teacher`. Never general knowledge.
import type { Chunk, TurnContext } from '@edmate/contracts';

/** Provisional, on a 0–1 scale; 5.3 calibrates it on the demo Q&A set. */
export const DEFAULT_COVERAGE_THRESHOLD = 0.5;

/** Covered = some chunk scores at or above the threshold. An unscored chunk does not count. */
export function isCovered(retrieved: readonly Chunk[], threshold: number): boolean {
  return retrieved.some((c) => c.score !== undefined && c.score >= threshold);
}

/** `null` when the turn is covered; otherwise the move that replaces teaching. */
export function coverageGate(
  ctx: Pick<TurnContext, 'retrieved' | 'lockedHit'>,
  threshold: number,
): 'locked' | 'ask_teacher' | null {
  if (isCovered(ctx.retrieved, threshold)) return null;
  return ctx.lockedHit ? 'locked' : 'ask_teacher';
}
