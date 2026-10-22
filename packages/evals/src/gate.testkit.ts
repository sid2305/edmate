// Test doubles for the quality gate tests (task 7.4). Not exported from the package and left out
// of the build (tsconfig.build.json): scripted agents and a scripted judge only, never a model.
import type { ModelRequest } from '@edmate/contracts';
import { manualClock, ScriptedGateway } from '@edmate/harness/testing';
import type { EvalAgent, EvalAgentReply, EvalTurnInput } from './agent.js';

/** The judge passes a statement only when the reply carries this marker. */
export const OK_MARK = '[ok]';

/**
 * A scripted judge with `count` passing and `count` failing verdicts. A verdict is matched by
 * whether the reply under judgement carries OK_MARK, so call order (and concurrency) don't matter.
 */
export function markerJudge(count: number): ScriptedGateway {
  const hasMark = (req: ModelRequest): boolean => {
    const content = req.messages[0]?.content ?? '';
    const reply = /<reply>\n([\s\S]*?)\n<\/reply>/.exec(content)?.[1] ?? '';
    return reply.includes(OK_MARK);
  };
  const entries = Array.from({ length: count }, () => [
    { match: hasMark, value: { pass: true, reason: 'meets the statement' } },
    { match: (req: ModelRequest) => !hasMark(req), value: { pass: false, reason: 'does not' } },
  ]).flat();
  return new ScriptedGateway({ generateObject: entries }, manualClock());
}

/** An agent that answers each turn with `decide(input)` and records every input it saw. */
export function scriptedAgent(
  decide: (input: EvalTurnInput) => EvalAgentReply | Promise<EvalAgentReply>,
): EvalAgent & { calls: EvalTurnInput[] } {
  const calls: EvalTurnInput[] = [];
  return {
    calls,
    async reply(input) {
      calls.push(input);
      return decide(input);
    },
  };
}

export const CITED: Pick<EvalAgentReply, 'sources'> = {
  sources: [{ title: 'Course notes', locator: 'section 1' }],
};
