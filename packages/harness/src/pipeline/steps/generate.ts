// Step 8, generate (task 3.7): streams the reply through the turn gateway, runs the tool rounds,
// and sends the turn's events in this order:
//   hint_rung? → (token | skill)* in stream order → sources? → locked?
// (teacher_question, replace and done are the runner's). The runner picks the model for each
// attempt through `env.gateway`, times the attempt, retries once, and clears shown text.
//
// The request is 3.6's `buildModelRequest` plus the tools: those the decision named whose skill
// is in the entitlement, checked again here (access rule 5). Usage goes through `env.usage` as it
// streams, which enforces the per-turn cost ceiling.
import type { PedagogyDecision, TurnContext, TurnEvent } from '@edmate/contracts';
import { buildModelRequest } from '../../pedagogy/modelRequest.js';
import { resolvePromptPackSet } from '../../pedagogy/promptPacks.js';
import { citedSources } from '../generate/citations.js';
import { SkillEventDropped, skillEvent } from '../generate/skillEvent.js';
import { passThroughGate } from '../generate/streamGate.js';
import { runToolLoop } from '../generate/toolLoop.js';
import { noTools, offeredTools } from '../tools.js';
import type { Steps } from '../types.js';

/** The ladder moves whose rung the student's screen shows (9.4). */
const HINT_MOVES: ReadonlySet<PedagogyDecision['move']> = new Set([
  'hint',
  'worked_example',
  'solution',
]);

/** Names only the student's own package, and only when the teacher chose that (3.6). */
function lockedEvent(pkg: TurnContext['pkg']): Extract<TurnEvent, { type: 'locked' }> {
  return pkg.lockedReply === 'name_package'
    ? { type: 'locked', packageName: pkg.name }
    : { type: 'locked' };
}

export const generate: Steps['generate'] = async (env, { ctx, decision, sources }, emit) => {
  const { deps } = env;
  // Before anything is shown: a turn already at its ceiling makes no call and shows nothing.
  env.usage.checkBeforeCall();
  const set = resolvePromptPackSet(deps.promptPacks, ctx.agent.promptPackVersion);
  const request = buildModelRequest({ ctx, decision, input: env.input, set });
  const offered = offeredTools(deps.tools ?? noTools, decision.tools, ctx.entitlement);
  const gate = (deps.streamGate ?? passThroughGate)({ ctx, decision });

  if (HINT_MOVES.has(decision.move)) emit({ type: 'hint_rung', rung: decision.rung });
  const { draft } = await runToolLoop({
    gateway: env.gateway,
    request,
    offered,
    ctx,
    clock: deps.clock,
    cancel: env.cancel,
    usage: env.usage,
    gate,
    show: (text) => emit({ type: 'token', text }),
    onToolOutput: (entry, output) => {
      const e = skillEvent(entry, output, ctx, decision.mustNotReveal);
      if (e instanceof SkillEventDropped) env.report(e);
      else if (e !== undefined) emit(e);
    },
    report: env.report,
    mustNotReveal: decision.mustNotReveal,
    track: env.track,
  });

  const cited = citedSources(draft, sources);
  if (cited.length > 0) emit({ type: 'sources', items: cited });
  if (decision.move === 'locked') emit(lockedEvent(ctx.pkg));
  return { draft };
};
