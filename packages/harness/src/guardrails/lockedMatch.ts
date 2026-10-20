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
// 4.6b: before any of that, common HTML entities are decoded (`decodeHtmlEntities`), HTML markup
// is read three ways (`foldMarkup`), and a small, conservative set of Cyrillic and Greek
// look-alike letters is folded to the Latin letter they render as (`foldConfusables`), so
// `&#108;&#111;op`, `<b>loop</b>`, `lo<b></b>op` and `ӏоор` (palochka and Cyrillic о, р) all fold
// toward `loop`. The three markup readings (4.6b fix round 1) are:
//   - `text`: nothing removed; every character, tag names and attributes included, is text;
//   - `values`: only markup syntax is padded (`<`, `</`, the tag name, attribute names, `=`,
//     quotes, `/>`, `>`, and the `<!--` / `-->` of a comment); attribute values and comment
//     bodies stay as text;
//   - `rendered`: whole tags and comments are padded, as a browser would not show them.
// No text is ever removed in every reading at once, so wrapping prose in a tag hides nothing
// (`<x data="...prose...">` is read in `text` and `values`), while filler hidden in attributes
// between visible words is read through in `rendered`. Every reading is tried, like the two
// invisible-character readings. All of these passes are length-preserving (markup and entities
// become same-length zero-width padding, `\p{Cf}`, so `drop` joins across them and `space` splits;
// a confusable is a one-for-one swap), so a token's `start` still points at the exact place in
// the original text (`carryStart`'s callers slice the original text by it).
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
// written in reverse token or character order; confusables outside the small table above
// (`foldConfusables` is not an exhaustive Unicode confusables mapping); HTML entities without
// their closing semicolon (`&#108oop`); a tag whose name holds an invisible character (`<b` +
// U+200B + `>` is not a tag, so the markup stays as text in every reading); prose split between
// attribute names and attribute values of several tags (each reading sees only one of the two);
// and (4.6c, these matter only if raw model HTML is ever rendered to a student, which task 9.4
// forbids) `<a<b>` (a `<` right before a real tag is read as plain text, not as a tag of its
// own); a `<` inside a quoted attribute value (it ends the tag-parse attempt there, same as a bare
// `<` would, so anything after it in that attribute is read as new markup, not as more of the
// value); a comment closed by `--!>` instead of `-->` (not recognised, so the comment is never
// found closed and is read to the end of the text, or as `open`); and a tag name in a non-ASCII
// script (only an ASCII letter starts a tag name, so e.g. `<Ω>` is never a tag in any reading).
//
// 4.6c: markdown emphasis inside a word is now padded, but only in the `rendered` reading (the
// `text` and `values` readings still read `*`, `_`, `~` and `` ` `` as plain punctuation, so
// `lo**o**p` splits into `lo`, `o`, `p` there, same as before). `padMarkdownEmphasis` pads a run of
// `*` or `` ` `` of any length, and a run of exactly two `_` or `~` (markdown's doubled forms,
// `__bold__` and `~~strikethrough~~`), when the run sits directly between two letters on both
// sides, so `t**h**e`, `lo~~o~~p` and `` lo`o`p `` all fold to one word. A single `_` is left alone
// (it is a word character itself, so `snake_case_name` stays one token), and a run with a space or
// punctuation on either side (markdown's actual syntax, `a * b`, a bullet list `* item`) is never
// padding: pad only runs that already touch a letter on both sides, exactly as HTML markup and
// entities do.
import { decodedBase64Spans } from '../pipeline/generate/base64Leak.js';
import { foldText } from './textFold.js';

/** How HTML markup is read before tokens are taken (see the header). */
export type MarkupReading = 'text' | 'values' | 'rendered';
const MARKUP_READINGS: readonly MarkupReading[] = ['text', 'values', 'rendered'];

/** The zero-width space: the padding markup and decoded entities leave behind (`\p{Cf}`). */
const PAD = '\u200b';

/** One complete tag or comment: [start, end), and the ranges inside it that are text. */
interface MarkupSpan {
  start: number;
  end: number;
  keep: [number, number][];
}

const isAsciiLetter = (c: string): boolean => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
const isNameChar = (c: string): boolean => isAsciiLetter(c) || (c >= '0' && c <= '9') || c === '-';
const isSpace = (c: string): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
/** Characters that end an attribute name or an unquoted value. */
const ATTR_STOP = new Set([' ', '\t', '\n', '\r', '\f', '"', "'", '<', '>', '/', '=', '`']);

type TagParse = { end: number; keep: [number, number][] } | 'open' | 'none';

/**
 * Parses a tag starting at `text[i] === '<'`. `none`: not a tag (a `<` used as an operator, or a
 * `<` inside it first); `open`: still unfinished at the end of the text. A real tag's name starts
 * right after `<` (or `</`) with a letter, so `count < 5` is never one. A `<` anywhere inside
 * (even in a quoted value) ends the attempt, so each attempt reads only up to the next `<`: the
 * whole scan is linear.
 */
function parseTag(text: string, i: number): TagParse {
  const n = text.length;
  let p = i + 1;
  if (text.charAt(p) === '/') p++;
  if (p >= n) return 'open';
  if (!isAsciiLetter(text.charAt(p))) return 'none';
  while (p < n && isNameChar(text.charAt(p))) p++;
  const keep: [number, number][] = [];
  let first = true;
  for (;;) {
    if (p >= n) return 'open';
    const c = text.charAt(p);
    if (c === '>') return { end: p + 1, keep };
    if (c === '<') return 'none';
    if (c === '/') {
      if (p + 1 >= n) return 'open';
      if (text.charAt(p + 1) === '>') return { end: p + 2, keep };
      p++;
      continue;
    }
    if (isSpace(c)) {
      p++;
      first = false;
      continue;
    }
    // Right after the tag name only a space, `/` or `>` may come (`<b"` or `<a.b>` is no tag).
    if (first) return 'none';
    if (c === '"' || c === "'") {
      // A quoted value with no name: still text in the `values` reading.
      const close = quoted(text, p);
      if (typeof close !== 'number') return close;
      keep.push([p + 1, close]);
      p = close + 1;
      continue;
    }
    if (c === '=') {
      p++;
      while (p < n && isSpace(text.charAt(p))) p++;
      if (p >= n) return 'open';
      const v = text.charAt(p);
      if (v === '"' || v === "'") {
        const close = quoted(text, p);
        if (typeof close !== 'number') return close;
        keep.push([p + 1, close]);
        p = close + 1;
      } else {
        const from = p;
        while (p < n && !ATTR_STOP.has(text.charAt(p))) p++;
        if (p > from) keep.push([from, p]);
        // A stray quote or `=` right here: skip it as markup, never loop on it.
        else if (v !== '<' && v !== '>' && v !== '/' && !isSpace(v)) p++;
      }
      continue;
    }
    // An attribute name (markup in the `values` reading); `` ` `` alone is skipped the same way.
    const from = p;
    while (p < n && !ATTR_STOP.has(text.charAt(p))) p++;
    if (p === from) p++;
  }
}

/** The closing quote's index for the quote at `p`; `none` on a `<` first, `open` at the end. */
function quoted(text: string, p: number): number | 'open' | 'none' {
  const q = text.charAt(p);
  for (let k = p + 1; k < text.length; k++) {
    const c = text.charAt(k);
    if (c === q) return k;
    if (c === '<') return 'none';
  }
  return 'open';
}

/** Every complete tag and comment in `text`, and where an unfinished one starts (-1: none). */
function scanMarkup(text: string): { spans: MarkupSpan[]; open: number } {
  const spans: MarkupSpan[] = [];
  let open = -1;
  let commentEnds = true;
  const n = text.length;
  for (let i = text.indexOf('<'); i >= 0; ) {
    let next = i + 1;
    if (text.startsWith('<!--', i)) {
      const j = commentEnds ? text.indexOf('-->', i + 4) : -1;
      if (j >= 0) {
        spans.push({ start: i, end: j + 3, keep: [[i + 4, j]] });
        next = j + 3;
      } else {
        // No `-->` anywhere after here: every later `<!--` is unfinished too (never searched again).
        if (open < 0) open = i;
        commentEnds = false;
        next = i + 4;
      }
    } else if (i + 4 > n && text.charAt(i + 1) === '!' && '<!--'.startsWith(text.slice(i))) {
      // `<!` or `<!-` at the very end: may still become a comment.
      if (open < 0) open = i;
    } else {
      const t = parseTag(text, i);
      if (t === 'open') {
        if (open < 0) open = i;
      } else if (t !== 'none') {
        spans.push({ start: i, end: t.end, keep: t.keep });
        next = t.end;
      }
    }
    i = next >= n ? -1 : text.indexOf('<', next);
  }
  return { spans, open };
}

const isLetter = (c: string): boolean => c !== '' && /\p{L}/u.test(c);
/** Markdown emphasis characters `foldMarkup`'s `rendered` reading may pad (see the header). */
const EMPHASIS = new Set(['*', '_', '~', '`']);

/**
 * Pads a run of `*` or `` ` `` of any length, or an exact doubled run (`__`, `~~`) of `_` or `~`,
 * with zero-width padding when it sits directly between two letters on both sides (4.6c; see the
 * header). Every other run of these characters — markdown's real syntax (`a * b`, `* item`), a
 * single `_` inside an identifier, a stray `~` or a run that does not touch a letter on one side —
 * is left as text. Linear time, length-preserving.
 */
function padMarkdownEmphasis(text: string): string {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text.charAt(i);
    if (!EMPHASIS.has(c)) {
      out += c;
      i++;
      continue;
    }
    let j = i;
    while (j < n && text.charAt(j) === c) j++;
    const len = j - i;
    const touchesLetters = isLetter(i > 0 ? text.charAt(i - 1) : '') && isLetter(text.charAt(j));
    const pad =
      touchesLetters && ((c === '*' || c === '`') ? true : len === 2);
    out += pad ? PAD.repeat(len) : text.slice(i, j);
    i = j;
  }
  return out;
}

/**
 * `text` read the way `reading` says (see the header): markup is replaced by zero-width padding
 * of the same length, so the result is exactly as long as `text`. Linear time.
 */
export function foldMarkup(text: string, reading: MarkupReading): string {
  if (reading === 'text') return text;
  let out = text;
  if (text.includes('<')) {
    const { spans } = scanMarkup(text);
    if (spans.length > 0) {
      let built = '';
      let at = 0;
      for (const s of spans) {
        built += text.slice(at, s.start);
        let k = s.start;
        if (reading === 'values') {
          for (const [a, b] of s.keep) {
            built += PAD.repeat(a - k) + text.slice(a, b);
            k = b;
          }
        }
        built += PAD.repeat(s.end - k);
        at = s.end;
      }
      out = built + text.slice(at);
    }
  }
  // 4.6c: markdown emphasis inside a word, rendered reading only.
  if (reading === 'rendered') out = padMarkdownEmphasis(out);
  return out;
}

const OPEN_ENTITY = /&#?[a-zA-Z0-9]*$/;

/**
 * Where an unfinished tag, comment or HTML entity at the very end of `text` starts, or -1. The
 * stream never cuts the held-back text inside one (the rest of it may still arrive and change how
 * the text before it is read), so it holds from here at the latest.
 */
export function unfinishedMarkupStart(text: string): number {
  const found = [scanMarkup(text).open, scanMarkup(decodeHtmlEntities(text)).open];
  const e = OPEN_ENTITY.exec(text);
  if (e !== null) found.push(e.index);
  const starts = found.filter((k) => k >= 0);
  return starts.length === 0 ? -1 : Math.min(...starts);
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
    return ch + PAD.repeat(pad);
  });
}

// A small, conservative table of Cyrillic and Greek letters that render identically (or near
// identically) to a Latin letter: not an exhaustive confusables mapping (see known misses above).
const CONFUSABLES: Readonly<Record<string, string>> = {
  а: 'a', А: 'A', е: 'e', Е: 'E', о: 'o', О: 'O', р: 'p', Р: 'P', с: 'c', С: 'C',
  х: 'x', Х: 'X', у: 'y', У: 'Y', і: 'i', І: 'I', ѕ: 's', Ѕ: 'S', ј: 'j', Ј: 'J',
  Α: 'A', Β: 'B', Ε: 'E', Ζ: 'Z', Η: 'H', Ι: 'I', Κ: 'K', Μ: 'M', Ν: 'N', Ο: 'O',
  Ρ: 'P', Τ: 'T', Υ: 'Y', Χ: 'X', ο: 'o', ι: 'i',
  // 4.6b fix round 1 (safety review): palochka (lower and capital, both render as l/I), Cyrillic
  // capitals В Н К М Т, Greek α ν ρ τ κ and Cyrillic ԁ һ ԛ ԝ.
  'ӏ': 'l', 'Ӏ': 'l',
  'В': 'B', 'Н': 'H', 'К': 'K', 'М': 'M', 'Т': 'T',
  'α': 'a', 'ν': 'v', 'ρ': 'p', 'τ': 't', 'κ': 'k',
  'ԁ': 'd', 'һ': 'h', 'ԛ': 'q', 'ԝ': 'w',
};

/** Folds the look-alike letters in `CONFUSABLES`; every other character passes through unchanged. */
export function foldConfusables(text: string): string {
  let out = '';
  for (const ch of text) out += CONFUSABLES[ch] ?? ch;
  return out;
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

/** Invisible characters read as spaces of the same length. */
const spaced = (s: string): string => s.replace(INVISIBLE, (m) => ' '.repeat(m.length));

/**
 * `text` after every length-preserving pass for one reading: entities decoded, markup read as
 * `markup` says, confusables folded, and (for `space`) invisible characters as spaces. Exactly as
 * long as `text`, so every index still points into it.
 */
function prepared(text: string, invisible: InvisibleReading, markup: MarkupReading): string {
  const folded = foldConfusables(foldMarkup(decodeHtmlEntities(text), markup));
  return invisible === 'space' ? spaced(folded) : folded;
}

/** Every distinct prepared form of `text`, over all six readings (usually far fewer differ). */
function preparedForms(text: string): string[] {
  const decoded = decodeHtmlEntities(text);
  const out = new Set<string>();
  for (const m of MARKUP_READINGS) {
    const folded = foldConfusables(foldMarkup(decoded, m));
    out.add(folded);
    out.add(spaced(folded));
  }
  return [...out];
}

/** The tokens of an already-prepared text. */
function tokensOf(source: string): LockedToken[] {
  const f = foldText(source, lower);
  const out: LockedToken[] = [];
  for (const m of f.s.matchAll(TOKEN)) {
    const lead = m[0].length - m[0].replace(/^_+/, '').length;
    const t = m[0].replace(/^_+|_+$/g, '');
    if (t !== '') out.push({ t, start: f.at[m.index + lead] as number });
  }
  return out;
}

/**
 * The folded tokens of `text` in one reading, each with its start in `text`. The defaults read
 * invisible characters as dropped and markup as text (nothing removed); `shingles`,
 * `lockedCandidates` and `carryStart` try every reading.
 */
export function lockedTokens(
  text: string,
  invisible: InvisibleReading = 'drop',
  markup: MarkupReading = 'text',
): LockedToken[] {
  return tokensOf(prepared(text, invisible, markup));
}

function windows(tokens: readonly string[]): string[] {
  const out: string[] = [];
  for (let j = 0; j + LOCKED_LEAK_MIN_TOKENS <= tokens.length; j++) {
    out.push(tokens.slice(j, j + LOCKED_LEAK_MIN_TOKENS).join(' '));
  }
  return out;
}

/** Every 8-token window of `text`, in every reading (invisible characters, markup), deduplicated. */
export function shingles(text: string): string[] {
  const out = new Set<string>();
  for (const form of preparedForms(text)) {
    for (const w of windows(tokensOf(form).map((x) => x.t))) out.add(w);
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
      for (const form of preparedForms(t)) {
        for (const run of unownedSpans(
          tokensOf(form).map((x) => x.t),
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
  // The earliest start over every reading (4.6b fix round 1): a reading with fewer tokens (markup
  // padded away, invisible characters joining words) needs more of the text carried.
  let start = shown.length;
  for (const form of preparedForms(shown)) {
    const toks = tokensOf(form);
    const n = LOCKED_STREAM_CARRY_TOKENS + (WORD_END.test(form) ? 1 : 0);
    if (toks.length <= n) return 0;
    start = Math.min(start, (toks[toks.length - n] as LockedToken).start);
  }
  return start;
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
