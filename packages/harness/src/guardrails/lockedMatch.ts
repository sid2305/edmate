// The locked-span matcher (task 4.6, ADR-0007): one algorithm for the harness and every
// RetrievalIndex adapter, so they can never disagree about what counts as a locked leak.
//
// A leak is any 8 contiguous tokens of a text that also appear, contiguously, in a teacher's
// material outside the student's allowed modules (ADR-0003 point 8; build plan guard table).
// Text is folded the way answerLeak folds it (textFold.ts: NFKC, every \p{Nd} digit ASCII, \p{Cf}
// dropped) and lower-cased, then split into tokens: runs of letters, marks, digits and `_`, with
// leading and trailing `_` cut (markdown `_emphasis_`; a run of only `_` is no token). So
// case, fullwidth forms, markdown, punctuation, extra whitespace and invisible characters inside a
// word change nothing. Invisible characters used as spaces are read both ways (dropped, and as a
// space), so `a<ZWSP>b` is tried as "ab" and as "a b".
//
// Fix round (4.6b): before any of that, HTML tags are stripped and common HTML entities are
// decoded (`stripHtmlTags`, `decodeHtmlEntities`), and a small, conservative set of Cyrillic and
// Greek look-alike letters is folded to the Latin letter they render as (`foldConfusables`), so
// `&#108;&#111;op`, `<b>loop</b>` and `ӏоор` (Cyrillic) all fold toward `loop`. Every one of these
// three passes is length-preserving (a tag or entity is replaced by same-length padding, a
// confusable is a one-for-one character swap), so a token's `start` still points at the exact
// place in the original text (`carryStart`'s callers slice the original text by it).
//
// The harness never holds locked text: it only prepares candidates (`lockedCandidates`) and asks
// the index (`RetrievalIndex.leakCheck`), which answers with one boolean. `lockedIndex` is what an
// adapter builds from the material it already stores.
//
// Known misses (judge-scored, task 4.5b; lockedLeak is a verbatim backstop only): spans under 8
// tokens; filler words interleaved; reordered sentences; renamed variables in code; summaries and
// paraphrase; contractions written differently ("does not" / "doesn't"); translation (folding
// normalises script, case and width, not language, so a translated sentence shares no tokens);
// hex- or decimal-escaped text outside HTML entities (`\x6c\x6f\x6f\x70`, `l...`); ROT13 and
// other letter ciphers; URL percent-encoding (`%6C%6F%6F%70`); words joined by camelCase or
// snake_case so the token boundary disappears (`theLoopRepeats`, `the_loop_repeats`); a span
// written in reverse token or character order; and confusables outside the small table above
// (`foldConfusables` is not an exhaustive Unicode confusables mapping).
import { decodedBase64Spans } from '../pipeline/generate/base64Leak.js';
import { foldText } from './textFold.js';

// A real tag's name starts right after `<` (or `</`) with a letter: `< 5` (a comparison, with a
// space) and `count > 0` (no matching `<` right before it) never match, so ordinary code with `<`
// and `>` as operators is left alone, even across a whole file with no real tags in it.
const TAG = /<\/?[a-zA-Z][-a-zA-Z0-9]*(?:\s[^<>]*)?\/?>/g;

/** Strips HTML tags, each replaced by spaces of the same length (keeps every index in place). */
export function stripHtmlTags(text: string): string {
  return text.replace(TAG, (m) => ' '.repeat(m.length));
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};
const ENTITY = /&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g;

/**
 * Decodes named (`&amp;`) and numeric (`&#108;`, `&#x6c;`) HTML entities. Each match is replaced
 * by its decoded character followed by zero-width-space padding up to the entity's own length, so
 * the result is exactly as long as `text` (the padding is `\p{Cf}`: the `drop` reading of
 * `lockedTokens` joins it into the surrounding word, the `space` reading splits there, same as any
 * other invisible character). An entity that does not decode is left as is.
 */
export function decodeHtmlEntities(text: string): string {
  return text.replace(ENTITY, (m, body: string) => {
    let ch: string | undefined;
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      ch =
        Number.isFinite(code) && code >= 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : undefined;
    } else {
      ch = NAMED_ENTITIES[body.toLowerCase()];
    }
    if (ch === undefined) return m;
    const pad = Math.max(0, m.length - ch.length);
    return ch + '​'.repeat(pad);
  });
}

// A small, conservative table of Cyrillic and Greek letters that render identically (or near
// identically) to a Latin letter: not an exhaustive confusables mapping (see known misses above).
const CONFUSABLES: Readonly<Record<string, string>> = {
  а: 'a', А: 'A', е: 'e', Е: 'E', о: 'o', О: 'O', р: 'p', Р: 'P', с: 'c', С: 'C',
  х: 'x', Х: 'X', у: 'y', У: 'Y', і: 'i', І: 'I', ѕ: 's', Ѕ: 'S', ј: 'j', Ј: 'J',
  Α: 'A', Β: 'B', Ε: 'E', Ζ: 'Z', Η: 'H', Ι: 'I', Κ: 'K', Μ: 'M', Ν: 'N', Ο: 'O',
  Ρ: 'P', Τ: 'T', Υ: 'Y', Χ: 'X', ο: 'o', ι: 'i',
};

/** Folds the look-alike letters in `CONFUSABLES`; every other character passes through unchanged. */
export function foldConfusables(text: string): string {
  let out = '';
  for (const ch of text) out += CONFUSABLES[ch] ?? ch;
  return out;
}

/** The three length-preserving passes above, composed. */
function deobfuscate(text: string): string {
  return foldConfusables(stripHtmlTags(decodeHtmlEntities(text)));
}

/** A leak is a span of this many tokens or more (ADR-0003 point 8). */
export const LOCKED_LEAK_MIN_TOKENS = 8;
/** Tokens of already-shown text checked again with each new sentence (one less than a span). */
export const LOCKED_STREAM_CARRY_TOKENS = LOCKED_LEAK_MIN_TOKENS - 1;

/** How invisible format characters are read: dropped (joining a word) or as a space. */
export type InvisibleReading = 'drop' | 'space';

export interface LockedToken {
  /** The folded, lower-case token. */
  t: string;
  /** Where it starts in the original text (UTF-16 index). */
  start: number;
}

const TOKEN = /[\p{L}\p{M}\p{N}_]+/gu;
const INVISIBLE = /\p{Cf}/gu;
const lower = (u: string): string => u.toLowerCase();

/** The folded tokens of `text`, each with its start in `text`. */
export function lockedTokens(text: string, invisible: InvisibleReading = 'drop'): LockedToken[] {
  // Every pass here (deobfuscate, and a space of the same length for `space`) keeps every index
  // the same length as the next, so a token's `start` still points into the original `text`.
  const deobfuscated = deobfuscate(text);
  const source =
    invisible === 'space' ? deobfuscated.replace(INVISIBLE, (m) => ' '.repeat(m.length)) : deobfuscated;
  const f = foldText(source, lower);
  const out: LockedToken[] = [];
  for (const m of f.s.matchAll(TOKEN)) {
    const lead = m[0].length - m[0].replace(/^_+/, '').length;
    const t = m[0].replace(/^_+|_+$/g, '');
    if (t !== '') out.push({ t, start: f.at[m.index + lead] as number });
  }
  return out;
}

const READINGS: readonly InvisibleReading[] = ['drop', 'space'];

function windows(tokens: readonly string[]): string[] {
  const out: string[] = [];
  for (let j = 0; j + LOCKED_LEAK_MIN_TOKENS <= tokens.length; j++) {
    out.push(tokens.slice(j, j + LOCKED_LEAK_MIN_TOKENS).join(' '));
  }
  return out;
}

/** Every 8-token window of `text`, in both readings of invisible characters, deduplicated. */
export function shingles(text: string): string[] {
  const out = new Set<string>();
  for (const r of READINGS) {
    for (const w of windows(lockedTokens(text, r).map((x) => x.t))) out.add(w);
  }
  return [...out];
}

export interface LockedIndex {
  /** True when any candidate holds 8 contiguous tokens of locked (and not allowed) material. */
  hits(candidates: readonly string[]): boolean;
}

/**
 * The index an adapter builds from a teacher's material: `locked` is every text outside the
 * allowed modules (one string per module, in source order, so a span across two chunks of a
 * module still matches); `allowed` is the allowed modules' text. A window found in both is
 * ignored: the student may see it anyway.
 */
export function lockedIndex(locked: readonly string[], allowed: readonly string[]): LockedIndex {
  const ok = new Set(allowed.flatMap(shingles));
  const bad = new Set<string>();
  for (const text of locked) for (const w of shingles(text)) if (!ok.has(w)) bad.add(w);
  return { hits: (candidates) => candidates.some((c) => shingles(c).some((w) => bad.has(w))) };
}

/**
 * The token spans holding every 8-token window of `tokens` that the student did not write
 * (`own`): consecutive such windows make one span. Only the student's own windows are left out,
 * so a window that mixes their quote with new words is still checked (echoing a quote and adding
 * locked words to it is caught).
 */
function unownedSpans(tokens: readonly string[], own: ReadonlySet<string>): string[][] {
  if (own.size === 0) return [[...tokens]];
  const spans: string[][] = [];
  let from = -1;
  const close = (lastWindow: number) => {
    spans.push(tokens.slice(from, lastWindow + LOCKED_LEAK_MIN_TOKENS));
    from = -1;
  };
  const all = windows(tokens);
  all.forEach((w, j) => {
    if (!own.has(w)) {
      if (from < 0) from = j;
    } else if (from >= 0) {
      close(j - 1);
    }
  });
  if (from >= 0) close(all.length - 1);
  return spans;
}

/**
 * What the harness sends to `leakCheck` for `texts`: each text and the decoded text of its base64
 * runs, folded into token spans of 8 or more (shorter text can't hold a leak), in both readings
 * of invisible characters, deduplicated. The 8-token windows the student wrote themselves
 * (`studentText`) are left out: quoting the student's own words back is not a leak, but any
 * window with a new word in it still counts.
 */
export function lockedCandidates(texts: readonly string[], studentText = ''): string[] {
  const own = new Set(shingles(studentText));
  const out = new Set<string>();
  for (const text of texts) {
    for (const t of [text, ...decodedBase64Spans(text)]) {
      for (const r of READINGS) {
        for (const run of unownedSpans(
          lockedTokens(t, r).map((x) => x.t),
          own,
        )) {
          if (run.length >= LOCKED_LEAK_MIN_TOKENS) out.add(run.join(' '));
        }
      }
    }
  }
  return [...out];
}

const WORD_END = /[\p{L}\p{M}\p{N}_\p{Cf}]$/u;

/**
 * Where the stream's carryover starts in `shown`: the last 7 tokens, or 8 when `shown` ends inside
 * a word (the next piece may finish it). Checking carryover + new sentence finds every span that
 * ends in the new sentence.
 */
export function carryStart(shown: string): number {
  const toks = lockedTokens(shown);
  const n = LOCKED_STREAM_CARRY_TOKENS + (WORD_END.test(shown) ? 1 : 0);
  return toks.length <= n ? 0 : (toks[toks.length - n] as LockedToken).start;
}

function leaves(value: unknown, out: string[]): void {
  if (typeof value === 'string') out.push(value);
  else if (typeof value === 'number') out.push(String(value));
  else if (Array.isArray(value)) for (const v of value) leaves(v, out);
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      leaves(v, out);
    }
  }
}

/**
 * Every string (keys included) and number in a JSON value, then all of them joined by spaces.
 * Never only `JSON.stringify`: its escaped newlines (`\n`) glue tokens together.
 */
export function stringLeaves(value: unknown): string[] {
  const out: string[] = [];
  leaves(value, out);
  out.push(out.join(' '));
  return out;
}
