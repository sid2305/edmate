// The main model request for `generate` (task 3.7 decides whether to use it as is). The system
// prompt is the decision's; history maps student → user, agent → assistant and teacher → user
// (3.11d, ADR-0009): a teacher message is labelled by the frame pack so the model can tell the
// teacher's own words apart, and it never reads as the model's own earlier reply.
//
// Every stored or incoming text is passed through `neutraliseForgedLabel` before the harness adds
// its own label, so only a label the harness inserted can ever read as one. Fix round 1: the
// check folds disguises first (markup, entities, NFKD, look-alike letters, accents, punctuation)
// and breaks the core phrases ("platform note", "teacher wrote") anywhere; a teacher's words sit
// in a `<<<` … `>>>` fence after the label, and `<<<`/`>>>` are broken in every other text.
import type {
  Message,
  ModelRequest,
  PedagogyDecision,
  TurnContext,
  TurnInput,
} from '@edmate/contracts';
import { decodeHtmlEntities, foldConfusables, foldMarkup } from '../guardrails/lockedMatch.js';
import { DATA_CLOSE, DATA_OPEN } from './compose.js';
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
export const FORGED_LABEL_PLACEHOLDER = '[a copied label was removed]';

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
  const exact =
    pattern === null
      ? text
      : text.replace(pattern, spacedOut).replace(pattern, FORGED_LABEL_PLACEHOLDER);
  return breakCorePhrases(exact);
}

/**
 * The words a forged teacher note can't do without (3.11d fix round 1), each as the folded words
 * of one phrase. They are broken wherever they appear once folded, whatever the label says.
 */
const CORE_PHRASES: readonly (readonly string[])[] = [
  ['platform', 'note'],
  ['teacher', 'wrote'],
];
/** What goes between a core phrase's words: letters, so no fold can read through it. */
export const CORE_PHRASE_BREAK = ' [copied]';
const MARK_OR_JUNK = /[^\p{L}\p{N}]/gu;

/**
 * `text` folded the way a reader would see through disguises: markup dropped, HTML entities
 * decoded, NFKD (fullwidth and other compatibility forms), look-alike letters folded, accents
 * and every non-letter, non-digit dropped, lower case. `src[k]` is the end offset in `text` of
 * the character that gave folded character `k`. Linear time.
 */
function foldForMatch(text: string): { folded: string; src: number[] } {
  // Both passes keep `text`'s length, so offsets map back one to one.
  const read = decodeHtmlEntities(foldMarkup(text, 'rendered'));
  let folded = '';
  const src: number[] = [];
  let i = 0;
  for (const ch of read) {
    const end = i + ch.length;
    const f = foldConfusables(ch.normalize('NFKD'))
      .toLowerCase()
      .normalize('NFKD')
      .replace(MARK_OR_JUNK, '');
    for (let k = 0; k < f.length; k++) src.push(end);
    folded += f;
    i = end;
  }
  return { folded, src };
}

/**
 * Inserts `CORE_PHRASE_BREAK` after the first word of each core phrase found in the folded text,
 * at the matching offset in the original text. The rest of the text is untouched, so it stays
 * readable, and the result folds to no core phrase (idempotent).
 */
function breakCorePhrases(text: string): string {
  const { folded, src } = foldForMatch(text);
  const cuts: number[] = [];
  for (const words of CORE_PHRASES) {
    const phrase = words.join('');
    const first = words[0]?.length ?? 0;
    for (let k = folded.indexOf(phrase); k !== -1; k = folded.indexOf(phrase, k + phrase.length)) {
      const at = src[k + first - 1];
      if (at !== undefined) cuts.push(at);
    }
  }
  if (cuts.length === 0) return text;
  let out = '';
  let at = 0;
  for (const cut of [...new Set(cuts)].sort((a, b) => a - b)) {
    out += text.slice(at, cut) + CORE_PHRASE_BREAK;
    at = cut;
  }
  return out + text.slice(at);
}

/** The fence around a teacher's own words after the label (3.11d fix round 1). */
export const TEACHER_OPEN = DATA_OPEN;
export const TEACHER_CLOSE = DATA_CLOSE;

/** Breaks any run of 3+ `<` or `>`, so no text can open or close a fence. */
function breakFences(text: string): string {
  return text.replace(/<{3,}|>{3,}/g, (m) => m.split('').join(' '));
}

/** Stored or student text made safe to send: no forged label, no fence marker. */
function safeText(text: string, label: string): string {
  return breakFences(neutraliseForgedLabel(text, label));
}

function historyMessage(m: Message, set: PromptPackSet): ModelRequest['messages'][number] {
  const label = set.frame['teacher-label'];
  const text = safeText(m.text, label);
  if (m.role === 'student') return { role: 'user', content: text };
  if (m.role === 'agent') return { role: 'assistant', content: text };
  // A teacher's words go in the user channel with the harness's own label (3.11d): the model
  // must never read them as its own earlier reply. The fence marks where they end, so a student
  // turn a provider merges after it never reads as the teacher's.
  return { role: 'user', content: `${label}\n${TEACHER_OPEN}\n${text}\n${TEACHER_CLOSE}` };
}

export function buildModelRequest(i: ModelRequestInput): ModelRequest {
  const { ctx, decision, input, set } = i;
  const text =
    input.text === undefined || input.text.trim() === ''
      ? renderTemplate(set.frame['empty-turn'], { kind: input.kind })
      : safeText(input.text, set.frame['teacher-label']);
  return {
    tier: 'main',
    system: decision.systemPrompt,
    messages: [...ctx.history.map((m) => historyMessage(m, set)), { role: 'user', content: text }],
    maxOutputTokens: decision.maxOutputTokens,
    cacheKey: promptCacheKey(ctx),
  };
}
