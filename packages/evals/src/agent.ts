// The agent under test, as the eval runner sees it (task 3.12). Deliberately smaller than the
// harness pipeline's contracts: a later task adapts the real pipeline (or a guard wrapper) to
// this interface without changing packages/evals.
import { z } from 'zod';

export interface PriorTurn {
  student: string;
  reply: string;
}

export interface EvalTurnInput {
  caseId: string;
  turnIndex: number;
  student: string;
  /** Every earlier turn of this case, in order. */
  priorTurns: PriorTurn[];
}

export const EvalAgentReplySchema = z.strictObject({
  text: z.string(),
  sources: z.array(z.strictObject({ title: z.string(), locator: z.string() })).exactOptional(),
});
export type EvalAgentReply = z.infer<typeof EvalAgentReplySchema>;

export interface EvalAgent {
  reply(input: EvalTurnInput): Promise<EvalAgentReply>;
}
