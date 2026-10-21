// Access filter 3 and § Ask the teacher: the agent teaches only from the teacher's material.
// A question nothing allowed covers goes to `locked` when it matches a locked module, otherwise
// to `ask_teacher`. Never general knowledge.
import type { Chunk, TurnContext } from '@edmate/contracts';

/**
 * On the 0–1 relevance scale of `Chunk.score`. Calibrated by 5.3 on the demo Q&A set: the
 * production index maps its scores so this line separates in-course from out-of-course questions
 * (full text: 27 of 30 in-course at or above, 1 of 8 out-of-course). The vector side stays
 * provisional until the real model's vectors are recorded (B-24).
 */
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
