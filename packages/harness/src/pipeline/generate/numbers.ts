// Which numbers a text names (task 4.5), for the numeric answer-key check. A number counts in any
// form a student would read as that number: digits in any script ("16", "१६", "1<ZWSP>6"),
// numeric literals ("16.0", "+16", "016", "0x10", "0b10000", "1.6e1", "24,000", "2,40,000",
// "24k", "2.4 lakh", "24 hazaar"), single digits spaced out ("1 6"), number words in English,
// Hindi in Latin letters and Devanagari ("sixteen", "solah", "सोलह", "two thousand sixteen",
// "do sau"), and short arithmetic ("print(8*2)", f"{5+3}"). Numbers match as whole values, never
// as substrings: "160" does not name 16. Signs are ignored. Roman numerals are out of scope.
import { foldText } from '../../guardrails/textFold.js';
import { arithmeticSpans } from './arithmetic.js';
import { foldWord, numberWord, SCALE_SUFFIX_SOURCE, scaleSuffix } from './numberWords.js';

/** How a number was written: digits (and literals), words, or an arithmetic expression. */
export type MentionKind = 'digits' | 'word' | 'expr';

export interface NumberMention {
  /** Canonical decimal text of the absolute value: "16", "0.5", "240000". */
  value: string;
  kind: MentionKind;
  /** An answer word ("is", "=", "answer", "hai", "उत्तर", ...) is near it, or it stands alone. */
  answerContext: boolean;
}

/** Larger values are not named exactly (no leak check needs them). */
const MAX_VALUE = 1e15;

/** Canonical text for a value: integers as digits, others to 12 significant digits. */
export function canonicalNumber(n: number): string | undefined {
  const a = Math.abs(n);
  if (!Number.isFinite(a) || a > MAX_VALUE) return undefined;
  if (Number.isInteger(a)) return String(a);
  return String(Number(a.toPrecision(12)));
}

/** The text as the number checks read it: digits ASCII, \p{Cf} gone, lower case, words folded. */
export function foldForNumbers(text: string): string {
  return foldText(text, (u) => foldWord(u.toLowerCase())).s;
}

const LITERAL = new RegExp(
  String.raw`(?<![a-z_\d.])(?:0x([0-9a-f]+)|0b([01]+)|0o([0-7]+)|` +
    String.raw`(\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})+,\d{3}|\d+)(\.\d+)?(?:e([+-]?\d{1,3}))?` +
    String.raw`(?:\s?(${SCALE_SUFFIX_SOURCE})(?![\p{L}\p{M}]))?)(?![\d])`,
  'gu',
);
/** Two or more single digits each one space apart ("1 6", "2 4 0 0 0"): read as one number. */
const SPACED = /(?<![\d.,])\d(?: \d)+(?![\d])/g;

function literalValue(m: RegExpMatchArray): number {
  const [, hex, bin, oct, int, frac, exp, suffix] = m;
  if (hex !== undefined) return parseInt(hex, 16);
  if (bin !== undefined) return parseInt(bin, 2);
  if (oct !== undefined) return parseInt(oct, 8);
  let v = Number(`${(int as string).replace(/,/g, '')}${frac ?? ''}e${exp ?? '0'}`);
  if (suffix !== undefined) v *= scaleSuffix(suffix) as number;
  return v;
}

// ---- words and answer context ----------------------------------------------------------------

interface Token {
  text: string;
  start: number;
  end: number;
  /** A sentence break (. ! ? । newline) lies between this token and the one before. */
  breakBefore: boolean;
  /** Only spaces or hyphens lie between this token and the one before. */
  joinedBefore: boolean;
}

const TOKEN = /[\p{L}\p{M}]+|\d+|=/gu;
const MARKERS = new Set(
  [
    'is',
    '=',
    'equals',
    'equal',
    'answer',
    'answers',
    'output',
    'outputs',
    'result',
    'prints',
    'print',
    'printed',
    'shows',
    'gives',
    'becomes',
    'hai',
    'hain',
    'hoga',
    'hogi',
    'hota',
    'aayega',
    'ayega',
    'jawab',
    'javab',
    'uttar',
    'barabar',
    'है',
    'हैं',
    'होगा',
    'होगी',
    'उत्तर',
    'जवाब',
    'बराबर',
    'छपेगा',
    'आएगा',
  ].map(foldWord),
);
/** Answer words count up to three words before a number, or right after it ("teen hai"). */
const BEFORE_WINDOW = 3;
const AFTER_WINDOW = 1;

function tokenize(s: string): Token[] {
  const out: Token[] = [];
  let last = 0;
  for (const m of s.matchAll(TOKEN)) {
    const gap = s.slice(last, m.index);
    out.push({
      text: m[0],
      start: m.index,
      end: m.index + m[0].length,
      breakBefore: out.length === 0 || /[.!?।\n]/.test(gap),
      joinedBefore: /^[\s-]*$/.test(gap),
    });
    last = m.index + m[0].length;
  }
  return out;
}

/** Whether tokens [i, j] have an answer marker within the window, in the same sentence. */
function inAnswerContext(toks: readonly Token[], i: number, j: number): boolean {
  if (i >= toks.length) return false;
  let alone = true;
  for (let k = i - 1; k >= 0 && !(toks[k + 1] as Token).breakBefore; k--) {
    alone = false;
    if (i - k <= BEFORE_WINDOW && MARKERS.has((toks[k] as Token).text)) return true;
  }
  for (let k = j + 1; k < toks.length && !(toks[k] as Token).breakBefore; k++) {
    alone = false;
    if (k - j <= AFTER_WINDOW && MARKERS.has((toks[k] as Token).text)) return true;
  }
  return alone;
}

/** Index range of the tokens a character span covers. */
function tokensOf(toks: readonly Token[], start: number, end: number): [number, number] {
  let i = toks.findIndex((t) => t.end > start);
  if (i < 0) i = toks.length;
  let j = i - 1;
  while (j + 1 < toks.length && (toks[j + 1] as Token).start < end) j++;
  return [i, Math.max(i, j)];
}

/** Number-word sequences: "two thousand sixteen" is one number, "one six" two. */
function wordMentions(toks: readonly Token[], out: NumberMention[]): void {
  let total = 0;
  let current = 0;
  let first = -1;
  let lastSmall: 'none' | 'unit' | 'teen' | 'tens' = 'none';
  let lastAt = -1;
  const emit = () => {
    if (first < 0) return;
    const value = canonicalNumber(total + current) as string;
    out.push({ value, kind: 'word', answerContext: inAnswerContext(toks, first, lastAt) });
    total = 0;
    current = 0;
    first = -1;
    lastSmall = 'none';
  };
  toks.forEach((t, k) => {
    const w = /^\d/.test(t.text) ? undefined : numberWord(t.text);
    const continues = first >= 0 && t.joinedBefore && !t.breakBefore && lastAt === k - 1;
    if (w === undefined) {
      // "one hundred and six": "and" right after a scale word keeps the number going.
      if (t.text === 'and' && continues && lastSmall === 'none') {
        lastAt = k;
        return;
      }
      emit();
      return;
    }
    if (!continues) emit();
    if (first < 0) first = k;
    if (w.kind === 'small') {
      const v = w.value;
      const kind = v < 10 ? 'unit' : v < 20 || v % 10 !== 0 ? 'teen' : 'tens';
      const fits = current % 100 === 0 || (lastSmall === 'tens' && kind === 'unit');
      if (!fits) {
        emit();
        first = k;
      }
      current += v;
      lastSmall = kind;
    } else if (w.value === 100) {
      current = (current === 0 ? 1 : current) * 100;
      lastSmall = 'none';
    } else {
      total += (current === 0 ? 1 : current) * w.value;
      current = 0;
      lastSmall = 'none';
    }
    lastAt = k;
  });
  emit();
}

/** Every number `text` names, with how it was written and whether it reads as an answer. */
export function numberMentions(text: string): NumberMention[] {
  const s = foldForNumbers(text);
  const toks = tokenize(s);
  const out: NumberMention[] = [];
  const push = (n: number, kind: MentionKind, start: number, end: number) => {
    const value = canonicalNumber(n);
    if (value === undefined) return;
    const [i, j] = tokensOf(toks, start, end);
    out.push({ value, kind, answerContext: inAnswerContext(toks, i, j) });
  };
  for (const m of s.matchAll(LITERAL))
    push(literalValue(m), 'digits', m.index, m.index + m[0].length);
  for (const m of s.matchAll(SPACED)) {
    push(Number(m[0].replace(/ /g, '')), 'digits', m.index, m.index + m[0].length);
  }
  for (const a of arithmeticSpans(s)) push(a.value, 'expr', a.start, a.end);
  wordMentions(toks, out);
  return out;
}

/** The set of canonical values `text` names, in any form and context. */
export function numbersMentioned(text: string): Set<string> {
  return new Set(numberMentions(text).map((m) => m.value));
}

/**
 * The canonical value when the whole of `key` is one number (a literal or a number-word phrase),
 * else undefined: such a key is matched as a number, never as a substring.
 */
export function numericKeyValue(key: string): string | undefined {
  // Quotes, backticks and a closing full stop around a key are not part of it.
  const s = foldForNumbers(key).replace(/^[\s`'"]+|[\s`'".]+$/g, '');
  if (s === '') return undefined;
  const lit = new RegExp(LITERAL.source, 'u').exec(s);
  if (lit !== null && lit.index === 0 && lit[0].length === s.length) {
    return canonicalNumber(literalValue(lit));
  }
  const toks = tokenize(s);
  const onlyWords =
    s.replace(/[\p{L}\p{M}\s-]/gu, '') === '' &&
    toks.every((t) => t.text === 'and' || numberWord(t.text) !== undefined);
  if (!onlyWords) return undefined;
  const words: NumberMention[] = [];
  wordMentions(toks, words);
  return words.length === 1 ? (words[0] as NumberMention).value : undefined;
}
