// The answer-key check (task 3.7, made robust in 4.5). One matcher serves every place the answer
// could reach the student: the stream gate (each sentence, with the text already shown), the
// answerLeak post-guard (the whole reply), skill payloads, tool outputs and source labels. So the
// incremental and final checks can never disagree about what counts as a leak.
//
// A key matches in any of these forms:
//   - text keys ("Warm", "n % 2 == 0"): on a folded copy of the text (NFKC, every \p{Nd} digit
//     ASCII, \p{Cf} dropped, lower case, backslashes dropped so JSON-escaped text matches, quote
//     marks unified) with spaces and commas ignored, at word boundaries: "Warm" matches "WARM." and
//     "W<ZWSP>arm" but not "Warmer", and "if marks >= 80:" does not match inside "elif marks >= 80:";
//   - number keys ("16", "sixteen", "24,000"): as whole numbers in any form numbers.ts reads
//     (digits in any script, literals, words in three scripts, arithmetic), never as substrings.
//     A one-digit key counts in words or arithmetic only in an answer context ("the answer is
//     three"), since "one step" or "1 + 2" are ordinary lesson text. A spoken fraction, "out of",
//     percentage or digit-by-digit decimal (numbers.ts's "weak" mentions) need that same answer
//     context whatever the key's length ("83% of students passed the test." is not a leak of
//     0.83; "the answer is 83%" is);
//   - either kind inside base64 (one decode level). Decoded noise can hold stray digits, so in
//     decoded text a one-digit key counts only in an answer context (or standing alone).
// A code-shaped key the student wrote as code in their own message may be quoted back: it is
// their code. "As code" means on a line that is clearly code (inside a ``` fence, indented, ending
// in a colon, or starting with a code keyword or an assignment) or right after `elif`, `while` or
// `return` (fix round 1: offering options in prose, "is it .upper() or .lower()?", backticked or
// not, never counts). Even then, a quote in an answer or confirmation context ("yes", "right",
// "use", "fix", "sahi", "haan", ...) is a leak. Plain words and numbers are never quoted back.
import { foldText } from '../../guardrails/textFold.js';
import { decodedBase64Spans } from './base64Leak.js';
import { numberWord, foldWord } from './numberWords.js';
import { mentionMatches, numberMentions, type NumericKey, numericKey } from './numbers.js';

const SEP = '\u0000';
const QUOTES = /^['"‘’“”«»]$/u;
const SPACE = /^[\s\p{Z},]$/u;
const WORD = /[\p{L}\p{M}\p{N}_]/u;
/** An operator, bracket or quote mark (not an apostrophe inside a word) makes a key code. */
const CODE_CHARS = /[=<>()[\]{}%*/+:!&|"'`]/;
const APOSTROPHE_IN_WORD = /(?<=\p{L})['’](?=\p{L})/gu;
/** A word right before a key that makes it part of a code statement on any line. */
const CODE_LEAD = new Set(['elif', 'while', 'return']);
const LAST_WORD = /([A-Za-z_]+)\s*$/;
/** A line that starts like code: a statement keyword or an assignment. */
const CODE_LINE_START =
  /^\s*(?:(?:if|elif|else|for|while|def|return|print|import|from|class|try|except|with)\b|[A-Za-z_][\w.]*\s*[-+*/]?=[^=])/;
/** Words that make a quote of the student's code an answer or a confirmation. */
const CONFIRM = new Set(
  [
    'yes',
    'yeah',
    'yep',
    'right',
    'correct',
    'correctly',
    'exactly',
    'fix',
    'fixes',
    'fixed',
    'use',
    'using',
    'solution',
    'works',
    'sahi',
    'haan',
    'han',
    'bilkul',
    'हाँ',
    'हां',
    'सही',
    'बिल्कुल',
  ].map((w) => foldWord(w)),
);
const CONFIRM_WINDOW = 5;

/** True for a key with code characters (apostrophes inside words don't count). */
export function codeShaped(key: string): boolean {
  return CODE_CHARS.test(key.replace(APOSTROPHE_IN_WORD, ''));
}

/** Whether position `at` of `raw` sits on a line that is clearly code. */
function clearlyCode(raw: string, at: number): boolean {
  const before = raw.slice(0, at);
  if (before.split('```').length % 2 === 0) return true;
  const lineStart = before.lastIndexOf('\n') + 1;
  const nl = raw.indexOf('\n', at);
  const line = raw.slice(lineStart, nl < 0 ? raw.length : nl);
  // A question ("x = s.lower() is right?") is prose, whatever it starts with.
  if (/\?\s*$/.test(line)) return false;
  return /^(?: {2,}|\t)/.test(line) || /:\s*$/.test(line) || CODE_LINE_START.test(line);
}

/** A code line's text and where it starts in `raw`. */
interface CodeLine {
  line: string;
  lineStart: number;
}

/** Every line of `raw` that is clearly code (see `clearlyCode`), with its start offset. */
function codeLines(raw: string): CodeLine[] {
  const out: CodeLine[] = [];
  let lineStart = 0;
  for (const line of raw.split('\n')) {
    if (clearlyCode(raw, lineStart)) out.push({ line, lineStart });
    lineStart += line.length + 1;
  }
  return out;
}

/** A trailing `# ...` or `// ...` comment, with the whitespace before it. */
const TRAILING_COMMENT = /\s*(?:#|\/\/).*$/;

/** `line` with a trailing comment and trailing whitespace dropped (fix round 3). */
function dropTrailingComment(line: string): string {
  return line.replace(TRAILING_COMMENT, '').replace(/\s+$/, '');
}

/**
 * Whether `a` and `b` are the same line except for a run that covers [ks, ke) (the key's span in
 * `a`): everything up to the key matches (`p >= ks`), everything from the key on matches
 * (`sa <= ke`), and the two lines are not in fact identical. A trailing comment (fix round 3: "#
 * maybe this" next to "# or this") and trailing whitespace are dropped first, since they are not
 * part of the code the two lines offer.
 */
function differsOnlyAroundKey(a: string, b: string, ks: number, ke: number): boolean {
  const an = dropTrailingComment(a);
  const bn = dropTrailingComment(b);
  if (an === bn) return false;
  let p = 0;
  while (p < an.length && p < bn.length && an[p] === bn[p]) p++;
  let i = an.length - 1;
  let j = bn.length - 1;
  while (i >= 0 && j >= 0 && an[i] === bn[j]) {
    i--;
    j--;
  }
  const sa = i + 1;
  return p >= ks && sa <= ke && sa > p;
}

/**
 * Whether the student's own message offers the key as one of two or more code options that
 * differ only at the key (fix round 2, 4.5c): `if s.upper()...` next to `if s.lower()...`. Such a
 * key never gets the own-code exemption, offered or not: the student picked neither yet.
 */
function offeredAsOptions(raw: string, c: Compact, key: string): boolean {
  const lines = codeLines(raw);
  if (lines.length < 2) return false;
  for (const [start, end] of occurrences(c, key)) {
    const a = lines.find((l) => start >= l.lineStart && start < l.lineStart + l.line.length);
    if (a === undefined) continue;
    const ks = start - a.lineStart;
    const ke = end - a.lineStart;
    for (const b of lines) {
      if (b.lineStart === a.lineStart) continue;
      if (differsOnlyAroundKey(a.line, b.line, ks, ke)) return true;
    }
  }
  return false;
}

/** Up to CONFIRM_WINDOW words either side of [start, end), within the sentence. */
function confirmedNear(raw: string, start: number, end: number): boolean {
  const sentenceEnd = /[!?\n।]|\.(?:\s|$)/;
  const before = raw.slice(Math.max(0, start - 200), start);
  const cut = Math.max(before.search(/[^!?\n।]*$/), before.lastIndexOf('. ') + 1);
  const after = raw.slice(end, end + 200);
  const stop = after.search(sentenceEnd);
  const words = (s: string) =>
    [...s.matchAll(/[\p{L}\p{M}]+/gu)].map((m) => foldWord(m[0].toLowerCase()));
  const near = [
    ...words(before.slice(cut)).slice(-CONFIRM_WINDOW),
    ...words(stop < 0 ? after : after.slice(0, stop)).slice(0, CONFIRM_WINDOW),
  ];
  return near.some((w) => CONFIRM.has(w));
}

function foldUnit(u: string): string {
  if (u === '\\') return '';
  if (SPACE.test(u)) return SEP;
  if (QUOTES.test(u)) return '"';
  return u.toLowerCase();
}

/** The compact folded text: separators removed, each unit's original index and boundary kept. */
interface Compact {
  s: string;
  at: number[];
  /** `sep[k]`: a space or comma came right before unit k (always true at 0). */
  sep: boolean[];
}

function compact(text: string): Compact {
  const f = foldText(text, foldUnit);
  let s = '';
  const at: number[] = [];
  const sep: boolean[] = [];
  let pending = true;
  for (let k = 0; k < f.s.length; k++) {
    const u = f.s[k] as string;
    if (u === SEP) {
      pending = true;
      continue;
    }
    s += u;
    at.push(f.at[k] as number);
    sep.push(pending);
    pending = false;
  }
  sep.push(true);
  return { s, at, sep };
}

/**
 * The compact form keys and texts are compared in: NFKC, ASCII digits, no \p{Cf}, lower case, no
 * backslashes, one kind of quote mark, and no spaces or commas.
 */
export function normaliseForMatch(text: string): string {
  return compact(text).s;
}

const isWord = (ch: string | undefined): boolean => ch !== undefined && WORD.test(ch);

function startsAtBoundary(c: Compact, i: number, key: string): boolean {
  return !isWord(key[0]) || c.sep[i] === true || !isWord(c.s[i - 1]);
}

function endsAtBoundary(c: Compact, end: number, key: string): boolean {
  return !isWord(key[key.length - 1]) || c.sep[end] === true || !isWord(c.s[end]);
}

function hasTextKey(c: Compact, key: string): boolean {
  for (let i = c.s.indexOf(key); i >= 0; i = c.s.indexOf(key, i + 1)) {
    if (startsAtBoundary(c, i, key) && endsAtBoundary(c, i + key.length, key)) return true;
  }
  return false;
}

/** Each word-bounded occurrence of `key` in `c`, as [start, end) in the original text. */
function occurrences(c: Compact, key: string): [number, number][] {
  const out: [number, number][] = [];
  for (let i = c.s.indexOf(key); i >= 0; i = c.s.indexOf(key, i + 1)) {
    if (startsAtBoundary(c, i, key) && endsAtBoundary(c, i + key.length, key)) {
      out.push([c.at[i] as number, (c.at[i + key.length - 1] as number) + 1]);
    }
  }
  return out;
}

/** True when the student's text holds `key` as code (see the file comment). */
function writtenAsCode(c: Compact, raw: string, key: string): boolean {
  return occurrences(c, key).some(([start, end]) => {
    // On a code line the words around are code (an `answer` variable), not a confirmation.
    if (clearlyCode(raw, start)) return true;
    if (confirmedNear(raw, start, end)) return false;
    const word = LAST_WORD.exec(raw.slice(0, start))?.[1]?.toLowerCase();
    return word !== undefined && CODE_LEAD.has(word);
  });
}

export interface AnswerKeyMatcher {
  /** True when no key is left to look for (no keys, or only empty ones). */
  readonly empty: boolean;
  /**
   * How far back from new text a key's match can start, in UTF-16 units: a check of the shown
   * text plus new text only needs this much of the shown text (the stream gate's window).
   */
  readonly reach: number;
  /** True when `text` reveals any key, in any form, plain or inside base64. */
  leaks(text: string): boolean;
  /**
   * Where a tail of `text` that could be the start of a key begins (an index into `text`), or -1.
   * The stream gate holds that tail back until it knows how it ends.
   */
  tailStart(text: string): number;
}

/**
 * `reach` (visible units: the gate does not count whitespace or invisible units): a key's own
 * length with room for case and quote variants, plus, for number keys, room for number words,
 * answer-context words and arithmetic around them. The gate also widens the window back to the
 * start of a word, so a base64 run or a number is never cut.
 */
const REACH_BASE = 64;
const REACH_NUMBERS = 512;
const REACH_PER_KEY_UNIT = 4;

export interface AnswerKeyOptions {
  /** The student's own message: code-shaped keys it holds as code may be quoted back. */
  studentText?: string;
}

/** Builds the matcher for one turn's do-not-say list. */
export function compileAnswerKeys(
  mustNotReveal: readonly string[],
  opts: AnswerKeyOptions = {},
): AnswerKeyMatcher {
  const numbers: NumericKey[] = [];
  const keyed = new Map<string, string>();
  for (const raw of mustNotReveal) {
    if (typeof raw !== 'string') continue;
    const n = numericKey(raw);
    if (n !== undefined) {
      if (!numbers.some((x) => x.value === n.value && x.decimals === n.decimals)) numbers.push(n);
      continue;
    }
    const k = normaliseForMatch(raw);
    if (k !== '' && !keyed.has(k)) keyed.set(k, raw);
  }
  let texts = [...keyed.keys()];
  /** The student's own code: allowed back, except in an answer or confirmation context. */
  let own: string[] = [];
  if (opts.studentText !== undefined && opts.studentText !== '') {
    const c = compact(opts.studentText);
    const raw = opts.studentText;
    own = texts.filter(
      (k) =>
        codeShaped(keyed.get(k) as string) &&
        writtenAsCode(c, raw, k) &&
        !offeredAsOptions(raw, c, k),
    );
    texts = texts.filter((k) => !own.includes(k));
  }

  const plainLeak = (text: string, decoded = false): boolean => {
    if (texts.length > 0 || own.length > 0) {
      const c = compact(text);
      if (texts.some((k) => hasTextKey(c, k))) return true;
      // Decoded text is never a quote of the student's code.
      if (decoded && own.some((k) => hasTextKey(c, k))) return true;
      const quoted = own.flatMap((k) => occurrences(c, k));
      if (quoted.some(([start, end]) => confirmedNear(text, start, end))) return true;
    }
    if (numbers.length === 0) return false;
    return numberMentions(text).some((m) =>
      numbers.some(
        (k) =>
          mentionMatches(m, k) &&
          (m.weak
            ? m.answerContext
            : k.value.length > 1 || m.answerContext || (m.kind === 'digits' && !decoded)),
      ),
    );
  };

  const tailKeys = [...texts, ...own];
  const longestTail = Math.max(0, ...tailKeys.map((k) => k.length));
  const empty = tailKeys.length === 0 && numbers.length === 0;
  const longest = Math.max(0, ...mustNotReveal.map((k) => (typeof k === 'string' ? k.length : 0)));
  return {
    empty,
    reach: REACH_BASE + REACH_PER_KEY_UNIT * longest + (numbers.length > 0 ? REACH_NUMBERS : 0),
    leaks(text) {
      if (empty || text === '') return false;
      return plainLeak(text) || decodedBase64Spans(text).some((d) => plainLeak(d, true));
    },
    tailStart(text) {
      if (empty || text === '') return -1;
      let start = -1;
      const take = (i: number) => {
        if (start < 0 || i < start) start = i;
      };
      if (tailKeys.length > 0) {
        // Only the end can hold a key's start: as many visible units as the longest key, plus
        // one for the boundary check (spaces and invisible units are walked over, not counted).
        const from = visibleUnitsBack(text, longestTail + 1);
        const c = compact(text.slice(from));
        for (const k of tailKeys) {
          for (let p = Math.min(k.length - 1, c.s.length); p > 0; p--) {
            const i = c.s.length - p;
            if (c.s.endsWith(k.slice(0, p)) && (i > 0 || from === 0) && startsAtBoundary(c, i, k)) {
              take(from + (c.at[i] as number));
              break;
            }
          }
        }
      }
      // A number at the very end may go on ("1" then "6", "1 " then "6", "twenty" then "four").
      if (numbers.length > 0) {
        const m = /\p{Nd}[\p{Nd}\s.,]*$/u.exec(text);
        if (m !== null) take(m.index);
        const w = numberWordTail(text);
        if (w >= 0) take(w);
      }
      return start;
    },
  };
}

/** Where the last `n` units that are neither whitespace nor invisible start in `text`. */
function visibleUnitsBack(text: string, n: number): number {
  let i = text.length;
  let counted = 0;
  while (i > 0 && counted < n) {
    i--;
    if (!/[\s\p{Cf}]/u.test(text.charAt(i))) counted++;
  }
  return i;
}

/** Words looked at for a number-word tail. */
const WORD_TAIL_UNITS = 200;

/**
 * Where a run of number words ("two thousand", "twenty") at the end of `text` starts, ignoring
 * trailing whitespace, hyphens and invisible characters, else -1.
 */
function numberWordTail(text: string): number {
  let e = text.length;
  while (e > 0 && /[\s\p{Cf}-]/u.test(text.charAt(e - 1))) e--;
  const from = Math.max(0, e - WORD_TAIL_UNITS);
  const words = [...text.slice(from, e).matchAll(/[\p{L}\p{M}]+/gu)];
  let first = -1;
  let sawNumber = false;
  for (let k = words.length - 1; k >= 0; k--) {
    const m = words[k] as RegExpMatchArray;
    const next = words[k + 1];
    const gapEnd = next === undefined ? e - from : (next.index as number);
    if (
      !/^[\s\p{Cf}-]*$/u.test(text.slice(from, e).slice((m.index as number) + m[0].length, gapEnd))
    )
      break;
    const w = foldWord(m[0].toLowerCase());
    if (numberWord(w) !== undefined) sawNumber = true;
    else if (w !== 'and') break;
    first = from + (m.index as number);
  }
  return sawNumber ? first : -1;
}

/** Every string in the value, keys included, plus numbers as text. */
function leaves(value: unknown, out: string[]): string[] {
  if (typeof value === 'string') out.push(value);
  else if (typeof value === 'number') out.push(String(value));
  else if (Array.isArray(value)) for (const v of value) leaves(v, out);
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      leaves(v, out);
    }
  }
  return out;
}

/** True when any non-empty do-not-say string appears in the value (its JSON or any leaf). */
export function revealsAnswerKey(value: unknown, mustNotReveal: readonly string[]): boolean {
  const m = compileAnswerKeys(mustNotReveal);
  if (m.empty) return false;
  const texts = leaves(value, []);
  try {
    const json = JSON.stringify(value) as string | undefined;
    if (json !== undefined) texts.push(json);
  } catch {
    // Leaves alone are checked.
  }
  return texts.some((t) => m.leaks(t));
}
