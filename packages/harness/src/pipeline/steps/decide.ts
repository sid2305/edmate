// Step 7, decide (build plan § Turn pipeline spec): the teaching policy (3.5) picks the move,
// then the composer (3.6) writes the system prompt from the prompt-pack set the agent pins.
// No model call. An unknown prompt-pack version throws in both `run` and `fallback`, so the turn
// ends with `provider_error` and nothing reaches the gateway.
import type { TurnContext } from '@edmate/contracts';
import { composeSystemPrompt } from '../../pedagogy/compose.js';
import { decidePolicy, fallbackPolicy, type PolicyResult } from '../../pedagogy/policy.js';
import { resolvePromptPackSet } from '../../pedagogy/promptPacks.js';
import { PilotLanguageClamped } from '../errors.js';
import { noTools, policyTools } from '../tools.js';
import type { DecideResult, StepEnv, Steps } from '../types.js';

function decided(env: StepEnv, ctx: TurnContext, policy: PolicyResult): DecideResult {
  const set = resolvePromptPackSet(env.deps.promptPacks, ctx.agent.promptPackVersion);
  const c = composeSystemPrompt({ ctx, policy, lang: env.input.lang, set });
  // Defence in depth (pilot policy): never let the turn fail over this, only report it.
  if (c.languageClamped) env.report(new PilotLanguageClamped());
  return {
    decision: {
      move: policy.move,
      rung: policy.rung,
      mustNotReveal: [...policy.mustNotReveal],
      systemPrompt: c.systemPrompt,
      tools: [...policy.tools],
      maxOutputTokens: policy.maxOutputTokens,
    },
    next: { rung: policy.next.helpRung, help: policy.next.help },
    reason: policy.reason,
    promptPack: c.promptPack,
    sources: c.sources,
  };
}

export const decide: Steps['decide'] = {
  run: (env, { ctx, help }) =>
    // The executor turns a throw (unknown pack version, locked material) into a rejection.
    new Promise<DecideResult>((resolve) => {
      // Only the entitled tools reach the policy (access rule 5); generate checks them again.
      const tools = policyTools(env.deps.tools ?? noTools, ctx.entitlement);
      resolve(decided(env, ctx, decidePolicy({ ctx, turn: env.input, help, tools })));
    }),
  // The `ask` fallback (`redirect` for distress) teaches nothing, so it shows no material: a
  // context that made `run` throw still gives a prompt with no retrieved text in it.
  fallback: (env, { ctx, help }) =>
    decided(env, { ...ctx, retrieved: [] }, fallbackPolicy(ctx, help)),
};
