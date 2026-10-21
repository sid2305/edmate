// maxOutputTokens per move (build plan § Turn pipeline spec, step 7). Provisional until the 7.6
// cost data: coaching replies stay under 80 words, explain ≤ 150 words plus an example and a
// citation, and ask_teacher leaves room for the covered part of the answer.
import type { PedagogyDecision, Skill } from '@edmate/contracts';

export type Move = PedagogyDecision['move'];

export const MAX_OUTPUT_TOKENS: Readonly<Record<Move, number>> = Object.freeze({
  ask: 200,
  hint: 250,
  check: 250,
  redirect: 150,
  locked: 150,
  ask_teacher: 250,
  explain: 400,
  worked_example: 600,
  solution: 700,
});

/**
 * Skills whose output is longer than their move's default (summaries, rubric feedback, the
 * role-play debrief: two strengths and two improvements, each cited; 5.8, ADR-0013 §4).
 */
export const SKILL_OUTPUT_TOKENS: Readonly<Partial<Record<Skill, number>>> = Object.freeze({
  revision: 700,
  feedback: 500,
  mock_interview: 350,
});

export function maxOutputTokensFor(move: Move, skill: Skill | null): number {
  return (skill === null ? undefined : SKILL_OUTPUT_TOKENS[skill]) ?? MAX_OUTPUT_TOKENS[move];
}
