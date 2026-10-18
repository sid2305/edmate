// Judge scoring: one rubric sentence, one reply, one yes/no verdict from the judge model,
// asked through the ModelGateway port. A malformed verdict throws; it is never scored.
import type { ModelGateway, ModelRequest } from '@edmate/contracts';
import { z } from 'zod';
import type { PriorTurn } from '../agent.js';

export const JudgeVerdictSchema = z.strictObject({
  pass: z.boolean(),
  reason: z.string().max(400),
});
export type JudgeVerdict = z.infer<typeof JudgeVerdictSchema>;

const JUDGE_SYSTEM = [
  'You are grading one teaching-agent reply against one yes/no statement about the reply.',
  'Judge only what the reply says, in the context of the earlier conversation.',
  'Set "pass" to true only if the statement is clearly true of the reply.',
  'Give a short "reason" (one sentence). Respond with the schema only.',
].join('\n');

function transcript(history: readonly PriorTurn[]): string {
  if (history.length === 0) return '(no earlier turns)';
  return history.map((t) => `Student: ${t.student}\nAgent: ${t.reply}`).join('\n\n');
}

export function buildJudgeRequest(
  rubric: string,
  reply: string,
  history: readonly PriorTurn[],
): ModelRequest {
  const content = [
    `<conversation>\n${transcript(history)}\n</conversation>`,
    `<reply>\n${reply}\n</reply>`,
    `<statement>\n${rubric}\n</statement>`,
  ].join('\n\n');
  return {
    tier: 'main',
    system: JUDGE_SYSTEM,
    messages: [{ role: 'user', content }],
    maxOutputTokens: 300,
    temperature: 0,
  };
}

export async function judge(
  gateway: ModelGateway,
  rubric: string,
  reply: string,
  history: readonly PriorTurn[],
): Promise<JudgeVerdict> {
  const verdict = await gateway.generateObject(
    buildJudgeRequest(rubric, reply, history),
    JudgeVerdictSchema,
  );
  // The port promises a validated object; checked again so a lax gateway can't score a turn.
  return JudgeVerdictSchema.parse(verdict);
}
