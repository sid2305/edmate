// The agent under test, as the eval runner sees it (task 3.12). Deliberately smaller than the
// harness pipeline's contracts: a later task adapts the real pipeline (or a guard wrapper) to
// this interface without changing packages/evals.
import { z } from 'zod';
import type { EvalSkill } from './schema.js';

export interface PriorTurn {
  /** The teacher message that came just before this turn's student message, if any. */
  teacher?: string;
  student: string;
  reply: string;
}

export interface EvalTurnInput {
  caseId: string;
  turnIndex: number;
  /** A teacher message placed just before `student` in the transcript (task 3.11e). */
  teacher?: string;
  student: string;
  /** Every earlier turn of this case, in order. */
  priorTurns: PriorTurn[];
  /** The skill for this turn (task 3.11e). Absent: the agent's default. */
  skill?: EvalSkill;
  /** The case's persona template ref (task 3.11e). Absent: no persona. */
  persona?: string;
}

export const EvalAgentReplySchema = z.strictObject({
  text: z.string(),
  sources: z.array(z.strictObject({ title: z.string(), locator: z.string() })).exactOptional(),
  /** Whether the turn escalated (task 4.3). Absent: unknown, so a `must_escalate` check fails. */
  escalated: z.boolean().exactOptional(),
  /** Whether a guard blocked the turn by its verdict (task 4.4). Absent: a `must_block` check fails. */
  blocked: z.boolean().exactOptional(),
});
export type EvalAgentReply = z.infer<typeof EvalAgentReplySchema>;

export interface EvalAgent {
  reply(input: EvalTurnInput): Promise<EvalAgentReply>;
}
