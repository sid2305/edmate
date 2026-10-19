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
//     three"), since "one step" or "1 + 2" are ordinary lesson text;
//   - either kind inside base64 (one decode level). Decoded noise can hold stray digits, so in
//     decoded text a one-digit key counts only in an answer context (or standing alone).
// A code-shaped key the student wrote as code in their own message (`elif marks >= 80`, or inside
// backticks) may be quoted back: it is their code. Proposed in prose ("is .lower() the fix?") it
// may not, since echoing it confirms the answer. Plain words and numbers are never quoted back.
import { foldText } from '../../guardrails/textFold.js';
import { decodedBase64Spans } from './base64Leak.js';
import { numberMentions, numericKeyValue } from './numbers.js';

const SEP = '\u0000';
const QUOTES = /^['"‘’“”«»]$/u;
const SPACE = /^[\s\p{Z},]$/u;
const WORD = /[\p{L}\p{M}\p{N}_]/u;
/** A key holding any of these is code-shaped: the student's own code may be quoted back. */
const CODE_CHARS = /[=<>()[\]{}%*/+:."'!&|]/;
/** A word or symbol right before a key that makes it part of a code statement. */
const CODE_LEAD = new Set(['if', 'elif', 'while', 'return', 'print', 'and', 'or', 'not', 'else']);
const CODE_LEAD_SYMBOL = /[=(:[{]\s*$/;
const LAST_WORD = /([A-Za-z_]+)\s*$/;

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

/** True when the student's text holds `key` as part of a code statement or inside backticks. */
function writtenAsCode(c: Compact, raw: string, key: string): boolean {
  for (let i = c.s.indexOf(key); i >= 0; i = c.s.indexOf(key, i + 1)) {
    if (!startsAtBoundary(c, i, key) || !endsAtBoundary(c, i + key.length, key)) continue;
    const before = raw.slice(0, c.at[i]);
    if (before.split('`').length % 2 === 0) return true;
    if (CODE_LEAD_SYMBOL.test(before)) return true;
    const word = LAST_WORD.exec(before)?.[1]?.toLowerCase();
    if (word !== undefined && CODE_LEAD.has(word)) return true;
  }
  return false;
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

/** `reach`: room for number words, answer-context words and arithmetic around any key... */
const REACH_BASE = 512;
/** ...plus spacing and zero-width padding inside the key itself. */
const REACH_PER_KEY_UNIT = 8;

export interface AnswerKeyOptions {
  /** The student's own message: code-shaped keys it holds as code may be quoted back. */
  studentText?: string;
}

/** Builds the matcher for one turn's do-not-say list. */
export function compileAnswerKeys(
  mustNotReveal: readonly string[],
  opts: AnswerKeyOptions = {},
): AnswerKeyMatcher {
  const numbers = new Set<string>();
  let texts: string[] = [];
  for (const raw of mustNotReveal) {
    if (typeof raw !== 'string') continue;
    const n = numericKeyValue(raw);
    if (n !== undefined) {
      numbers.add(n);
      continue;
    }
    const k = normaliseForMatch(raw);
    if (k !== '') texts.push(k);
  }
  texts = [...new Set(texts)];
  if (opts.studentText !== undefined && opts.studentText !== '') {
    const own = compact(opts.studentText);
    const raw = opts.studentText;
    texts = texts.filter((k) => !(CODE_CHARS.test(k) && writtenAsCode(own, raw, k)));
  }

  const plainLeak = (text: string, decoded = false): boolean => {
    if (texts.length > 0) {
      const c = compact(text);
      if (texts.some((k) => hasTextKey(c, k))) return true;
    }
    if (numbers.size === 0) return false;
    return numberMentions(text).some(
      (m) =>
        numbers.has(m.value) &&
        (m.value.length > 1 || m.answerContext || (m.kind === 'digits' && !decoded)),
    );
  };

  const empty = texts.length === 0 && numbers.size === 0;
  const longest = Math.max(0, ...mustNotReveal.map((k) => (typeof k === 'string' ? k.length : 0)));
  return {
    empty,
    reach: REACH_BASE + REACH_PER_KEY_UNIT * longest,
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
      if (texts.length > 0) {
        const c = compact(text);
        for (const k of texts) {
          for (let p = Math.min(k.length - 1, c.s.length); p > 0; p--) {
            const i = c.s.length - p;
            if (c.s.endsWith(k.slice(0, p)) && startsAtBoundary(c, i, k)) {
              take(c.at[i] as number);
              break;
            }
          }
        }
      }
      // A number at the very end may go on ("1" then "6", or "1 " then "6").
      if (numbers.size > 0) {
        const m = /\p{Nd}[\p{Nd}\s.,]*$/u.exec(text);
        if (m !== null) take(m.index);
      }
      return start;
    },
  };
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
