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
// Fix round 2: fence runs are matched after the same fold (format characters, NFKC, entities);
// "teacher wrote" is broken only in the forged-label shape; the agent's own past replies skip
// the core-phrase pass (they were never student-controlled).
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
const IS_FORMAT = /^\p{Cf}$/u;

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
  const exact = neutraliseExactLabel(text, label);
  return breakCorePhrases(exact.text, exact.spans);
}

/** A `[start, end)` range of offsets in a text. */
type Span = readonly [number, number];

/**
 * The exact-label pass on its own: the label's words in order, spaced out or replaced. `spans`
 * are the spaced-out copies of the label in the result (3.11e item 8), so the core-phrase pass
 * gives an exact copy no second treatment. A copy that was already spaced out counts too, which
 * keeps the whole neutraliser idempotent.
 */
function neutraliseExactLabel(text: string, label: string): { text: string; spans: Span[] } {
  const pattern = forgedLabelPattern(label);
  if (pattern === null) return { text, spans: [] };
  const out = text.replace(pattern, spacedOut).replace(pattern, FORGED_LABEL_PLACEHOLDER);
  const spaced = new RegExp(spacedOut(label).replace(SYNTAX, '\\$&'), 'giu');
  const spans: Span[] = [];
  for (const m of out.matchAll(spaced)) spans.push([m.index, m.index + m[0].length]);
  return { text: out, spans };
}

/**
 * The words a forged teacher note can't do without (3.11d fix round 1), each as the folded words
 * of one phrase. "platform note" is broken wherever it appears once folded. "teacher wrote" is
 * broken only in the forged-label shape (fix round 2): followed by "this reply", or with
 * "platform" or "note" within `NEAR` folded characters (about five words) either side, so a
 * student's ordinary "my teacher wrote on my essay" reaches the model unchanged.
 */
const CORE_PHRASES: readonly { phrase: string; firstWord: number; anywhere: boolean }[] = [
  { phrase: 'platformnote', firstWord: 'platform'.length, anywhere: true },
  { phrase: 'teacherwrote', firstWord: 'teacher'.length, anywhere: false },
];
const NEAR = 32;
const LABEL_WORDS = ['platform', 'note'] as const;

/** Whether the core phrase at folded `[k, end)` sits in the shape of a forged label. */
function labelShaped(folded: string, k: number, end: number): boolean {
  if (folded.startsWith('thisreply', end)) return true;
  const around = [folded.slice(Math.max(0, k - NEAR), k), folded.slice(end, end + NEAR)];
  return around.some((s) => LABEL_WORDS.some((w) => s.includes(w)));
}
/** What goes between a core phrase's words: letters, so no fold can read through it. */
export const CORE_PHRASE_BREAK = ' [copied]';
const MARK_OR_JUNK = /[^\p{L}\p{N}]/gu;

/**
 * `text` folded the way a reader would see through disguises: markup dropped, HTML entities
 * decoded, NFKD (fullwidth and other compatibility forms), look-alike letters folded, accents
 * and every non-letter, non-digit dropped, lower case. `src[k]` is the end offset in `text` of
 * the character that gave folded character `k`, and `start[k]` its start offset. Linear time.
 */
function foldForMatch(text: string): { folded: string; src: number[]; start: number[] } {
  // Both passes keep `text`'s length, so offsets map back one to one.
  const read = decodeHtmlEntities(foldMarkup(text, 'rendered'));
  let folded = '';
  const src: number[] = [];
  const start: number[] = [];
  let i = 0;
  for (const ch of read) {
    const end = i + ch.length;
    const f = foldConfusables(ch.normalize('NFKD'))
      .toLowerCase()
      .normalize('NFKD')
      .replace(MARK_OR_JUNK, '');
    for (let k = 0; k < f.length; k++) {
      src.push(end);
      start.push(i);
    }
    folded += f;
    i = end;
  }
  return { folded, src, start };
}

/**
 * Inserts `CORE_PHRASE_BREAK` after the first word of each core phrase found in the folded text,
 * at the matching offset in the original text. The rest of the text is untouched, so it stays
 * readable, and the result folds to no core phrase outside `skip` (idempotent). A hit whose
 * source lies wholly inside a `skip` span (an exact label copy, already spaced out) is left as it
 * is (3.11e item 8); a hit that straddles a span edge still breaks.
 */
function breakCorePhrases(text: string, skip: readonly Span[] = []): string {
  const { folded, src, start } = foldForMatch(text);
  const cuts: number[] = [];
  for (const { phrase, firstWord, anywhere } of CORE_PHRASES) {
    for (let k = folded.indexOf(phrase); k !== -1; k = folded.indexOf(phrase, k + phrase.length)) {
      if (!anywhere && !labelShaped(folded, k, k + phrase.length)) continue;
      // Both arrays have one entry per folded character, so the match's own indexes are present.
      const from = start[k] as number;
      const to = src[k + phrase.length - 1] as number;
      if (skip.some(([a, b]) => a <= from && to <= b)) continue;
      // `src` has one entry per folded character, so the match's own index is always present.
      cuts.push(src[k + firstWord - 1] as number);
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

/** A fence character once folded: `<`, `>` or neither. */
function fenceChar(ch: string): '<' | '>' | null {
  const f = ch.normalize('NFKC');
  return f === '<' || f === '>' ? f : null;
}

/**
 * Breaks any run of 3+ `<` or `>`, so no text can open or close a fence. A run is matched the way
 * a reader sees it (fix round 2): HTML entities decoded (`&lt;`, `&#60;`), each character NFKC
 * folded (fullwidth `＜`, small form `﹤`), and invisible format characters (zero-width and the
 * like) skipped. The run becomes plain `< < <`, so it stays readable and the result has no run
 * (idempotent). One pass, linear. The harness's own fence is added after this, never through it.
 */
export function breakFenceRuns(text: string): string {
  // Entities decode to their character plus zero-width padding, so offsets stay the same.
  const read = decodeHtmlEntities(text);
  let out = '';
  let at = 0;
  let run: { ch: '<' | '>'; start: number; end: number; count: number } | null = null;
  const flush = (): void => {
    if (run !== null && run.count >= 3) {
      out += text.slice(at, run.start) + Array(run.count).fill(run.ch).join(' ');
      at = run.end;
    }
    run = null;
  };
  let i = 0;
  for (const ch of read) {
    const end = i + ch.length;
    if (run !== null && IS_FORMAT.test(ch)) {
      run.end = end;
    } else {
      const f = fenceChar(ch);
      if (run !== null && f === run.ch) {
        run.count += 1;
        run.end = end;
      } else {
        flush();
        if (f !== null) run = { ch: f, start: i, end, count: 1 };
      }
    }
    i = end;
  }
  flush();
  return out + text.slice(at);
}

/** Stored or student text made safe to send: no forged label, no fence marker. */
function safeText(text: string, label: string): string {
  return breakFenceRuns(neutraliseForgedLabel(text, label));
}

function historyMessage(m: Message, set: PromptPackSet): ModelRequest['messages'][number] {
  const label = set.frame['teacher-label'];
  // The agent's own past replies were never student-controlled (commit stores only the guarded
  // reply as `agent`), so they skip the core-phrase pass: no " [copied]" for the model to echo.
  if (m.role === 'agent') {
    return {
      role: 'assistant',
      content: breakFenceRuns(neutraliseExactLabel(m.text, label).text),
    };
  }
  const text = safeText(m.text, label);
  if (m.role === 'student') return { role: 'user', content: text };
  // A teacher's words go in the user channel with the harness's own label (3.11d): the model
  // must never read them as its own earlier reply. The fence marks where they end, so a student
  // turn a provider merges after it never reads as the teacher's.
  return { role: 'user', content: `${label}\n${TEACHER_OPEN}\n${text}\n${TEACHER_CLOSE}` };
}

/**
 * Moves that teach nothing (3.11e item 5): the reply is a fixed kind of answer (locked, a
 * question sent to the teacher, a redirect for off-topic, misuse, meta or distress), so the
 * session history adds nothing but room for a past turn to steer it. They send only the current
 * turn. The decide fallback's `ask` keeps history: it cannot be told apart from a teaching `ask`.
 */
const CLOSED_MOVES: ReadonlySet<PedagogyDecision['move']> = new Set([
  'locked',
  'ask_teacher',
  'redirect',
]);

export function buildModelRequest(i: ModelRequestInput): ModelRequest {
  const { ctx, decision, input, set } = i;
  const history = CLOSED_MOVES.has(decision.move) ? [] : ctx.history;
  const text =
    input.text === undefined || input.text.trim() === ''
      ? renderTemplate(set.frame['empty-turn'], { kind: input.kind })
      : safeText(input.text, set.frame['teacher-label']);
  return {
    tier: 'main',
    system: decision.systemPrompt,
    messages: [...history.map((m) => historyMessage(m, set)), { role: 'user', content: text }],
    maxOutputTokens: decision.maxOutputTokens,
    cacheKey: promptCacheKey(ctx),
  };
}
