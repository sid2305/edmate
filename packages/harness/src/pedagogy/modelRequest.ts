// The main model request for `generate` (task 3.7 decides whether to use it as is). The system
// prompt is the decision's; history maps student → user and agent/teacher → assistant, a teacher
// message labelled by the frame pack so the model can tell the teacher's own words apart.
import type {
  Message,
  ModelRequest,
  PedagogyDecision,
  TurnContext,
  TurnInput,
} from '@edmate/contracts';
import { type PromptPackSet, renderTemplate } from './promptPacks.js';

export interface ModelRequestInput {
  ctx: TurnContext;
  decision: PedagogyDecision;
  /** The scrubbed input (never the raw text). */
  input: Pick<TurnInput, 'kind' | 'text'>;
  /** The set `ctx.agent.promptPackVersion` pins (for the teacher label and the empty-turn line). */
  set: PromptPackSet;
}

/**
 * A provider prompt-caching hint for the stable prefix of the system prompt (safety → locale),
 * keyed by the agent, package, prompt-pack set and style card versions (ADR-0003 point 6: caches
 * are keyed by package version), never by student.
 *
 * It must NEVER be used as an app-level response or prompt cache key: it does not cover the
 * help state, the answer key, retrieved material, the learner summary or the input, so two
 * different students' turns share it.
 */
export function promptCacheKey(ctx: TurnContext): string {
  return [
    ctx.agent.id,
    ctx.agent.version,
    ctx.pkg.id,
    ctx.pkg.version,
    ctx.agent.promptPackVersion,
    ctx.styleCard.version,
  ].join(':');
}

function historyMessage(m: Message, set: PromptPackSet): ModelRequest['messages'][number] {
  if (m.role === 'student') return { role: 'user', content: m.text };
  if (m.role === 'agent') return { role: 'assistant', content: m.text };
  return { role: 'assistant', content: `${set.frame['teacher-label']}\n${m.text}` };
}

export function buildModelRequest(i: ModelRequestInput): ModelRequest {
  const { ctx, decision, input, set } = i;
  const text =
    input.text === undefined || input.text.trim() === ''
      ? renderTemplate(set.frame['empty-turn'], { kind: input.kind })
      : input.text;
  return {
    tier: 'main',
    system: decision.systemPrompt,
    messages: [...ctx.history.map((m) => historyMessage(m, set)), { role: 'user', content: text }],
    maxOutputTokens: decision.maxOutputTokens,
    cacheKey: promptCacheKey(ctx),
  };
}
