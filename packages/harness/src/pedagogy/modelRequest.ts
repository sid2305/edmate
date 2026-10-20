// The main model request for `generate` (task 3.7 decides whether to use it as is). The system
// prompt is the decision's; history maps student → user, agent → assistant and teacher → user
// (3.11d, ADR-0009): a teacher message is labelled by the frame pack so the model can tell the
// teacher's own words apart, and it never reads as the model's own earlier reply.
//
// Every stored or incoming text is passed through `neutraliseForgedLabel` before the harness adds
// its own label, so only a label the harness inserted can ever read as one.
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

/** What a forged copy becomes when spacing it out could still read as the label. */
export const FORGED_LABEL_PLACEHOLDER = '[a copied platform note was removed]';

/** Regex syntax characters (the only escapes a `u` regex allows). */
const SYNTAX = /[\^$\\.*+?()[\]{}|/]/g;
const FORMAT_CHARS = /\p{Cf}/gu;
const GAP = /[\s\p{Cf}]+/gu;

/**
 * The label's words in order, any case, any whitespace between words, and invisible format
 * characters (zero-width and the like) allowed anywhere. Null for an empty label.
 */
function forgedLabelPattern(label: string): RegExp | null {
  const words = label
    .trim()
    .split(/\s+/)
    .filter((w) => w !== '');
  if (words.length === 0) return null;
  const word = (w: string): string =>
    Array.from(w)
      .map((c) => c.replace(SYNTAX, '\\$&'))
      .join('\\p{Cf}*');
  return new RegExp(words.map(word).join('[\\s\\p{Cf}]*'), 'giu');
}

/** `Platform note:` → `P l a t f o r m   n o t e :`: still readable, never the label. */
function spacedOut(match: string): string {
  return match
    .replace(FORMAT_CHARS, '')
    .trim()
    .split(GAP)
    .map((w) => Array.from(w).join(' '))
    .join('   ');
}

/**
 * Breaks any copy of the platform's own teacher-label text inside stored or student-authored text
 * (3.11d), so it can never be mistaken for a genuine platform-inserted note. The copy is spaced
 * out (the same idea as the composer's `<<<`/`>>>` neutraliser) so the text stays readable; a
 * label so short that spacing it out still matches is replaced by a fixed placeholder instead.
 */
export function neutraliseForgedLabel(text: string, label: string): string {
  const pattern = forgedLabelPattern(label);
  if (pattern === null) return text;
  const spaced = text.replace(pattern, spacedOut);
  return spaced.replace(pattern, FORGED_LABEL_PLACEHOLDER);
}

function historyMessage(m: Message, set: PromptPackSet): ModelRequest['messages'][number] {
  const label = set.frame['teacher-label'];
  const text = neutraliseForgedLabel(m.text, label);
  if (m.role === 'student') return { role: 'user', content: text };
  if (m.role === 'agent') return { role: 'assistant', content: text };
  // A teacher's words go in the user channel with the harness's own label (3.11d): the model
  // must never read them as its own earlier reply.
  return { role: 'user', content: `${label}\n${text}` };
}

export function buildModelRequest(i: ModelRequestInput): ModelRequest {
  const { ctx, decision, input, set } = i;
  const text =
    input.text === undefined || input.text.trim() === ''
      ? renderTemplate(set.frame['empty-turn'], { kind: input.kind })
      : neutraliseForgedLabel(input.text, set.frame['teacher-label']);
  return {
    tier: 'main',
    system: decision.systemPrompt,
    messages: [...ctx.history.map((m) => historyMessage(m, set)), { role: 'user', content: text }],
    maxOutputTokens: decision.maxOutputTokens,
    cacheKey: promptCacheKey(ctx),
  };
}
