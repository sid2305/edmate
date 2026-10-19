// Which numbers a text names (task 4.5), for the numeric answer-key check. A number counts in any
// form a student would read as that number: digits in any script ("16", "१६", "1<ZWSP>6"),
// numeric literals ("16.0", "+16", "016", "0x10", "0b10000", "1.6e1", "24,000", "2,40,000",
// "24k", "2.4 lakh", "24 hazaar"), single digits spaced out ("1 6"), number words in English,
// Hindi in Latin letters and Devanagari ("sixteen", "solah", "सोलह", "two thousand sixteen",
// "do sau"), and short arithmetic ("print(8*2)", f"{5+3}"). Numbers match as whole values, never
// as substrings: "160" does not name 16. Signs are ignored. Roman numerals are out of scope.
// Fix round 1: "24 000" (space-grouped; NFKC turns no-break spaces into spaces), ".83", fraction
// keys ("5/6"), and decimals compared at the precision written (".83" and "0.833" name 0.83).
// Fix round 2 (4.5c): spoken fractions ("five sixths", "5 out of 6"), a percentage ("83%"), and a
// decimal read digit by digit ("zero point eight three") all name the value they compute, at the
// precision they imply (a percentage: its own written decimals plus two; a spoken decimal: the
// digits spoken after "point").
// Fix round 3: those four forms (spoken fraction, "out of", percentage, spoken decimal) need an
// answer context to count, whatever the key's length ("83% of students passed the test." and "5
// out of 6 tests passed." are ordinary lesson text, not a leak of key 0.83 or 5/6).
import { foldText } from '../../guardrails/textFold.js';
import { arithmeticSpans, evaluateArithmetic } from './arithmetic.js';
import { foldWord, numberWord, SCALE_SUFFIX_SOURCE, scaleSuffix } from './numberWords.js';

/** How a number was written: digits (and literals), words, or an arithmetic expression. */
export type MentionKind = 'digits' | 'word' | 'expr';

export interface NumberMention {
  /** Canonical decimal text of the absolute value: "16", "0.5", "240000". */
  value: string;
  /** The absolute value. */
  num: number;
  /** Digits after the decimal point as written (0 for integers and words, 12 for arithmetic). */
  decimals: number;
  kind: MentionKind;
  /** An answer word ("is", "=", "answer", "hai", "उत्तर", ...) is near it, or it stands alone. */
  answerContext: boolean;
  /**
   * A spoken fraction, "out of", percentage or digit-by-digit decimal (fix round 3): these need
   * an answer context whatever the key's length, the same as a one-digit key's words and
   * arithmetic ("83% of students passed" and "5 out of 6 tests passed" are ordinary lesson text).
   */
  weak: boolean;
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
    String.raw`(\d{1,3}(?:,\d{3})+|\d{1,3}(?: \d{3})+|\d{1,2}(?:,\d{2})+,\d{3}|\d+)` +
    String.raw`(\.\d+)?(?:e([+-]?\d{1,3}))?` +
    String.raw`(?:\s?(${SCALE_SUFFIX_SOURCE})(?![\p{L}\p{M}]))?)(?![\d])`,
  'gu',
);
/** A decimal written with no leading zero: ".83". */
const DOT_DECIMAL = /(?<![\p{L}\p{N}_.])\.(\d+)(?!\d)/gu;
/** Two or more single digits each one space apart ("1 6", "2 4 0 0 0"): read as one number. */
const SPACED = /(?<![\d.,])\d(?: \d)+(?![\d])/g;

/** Arithmetic results are exact as far as a check needs: compared at the key's precision. */
const COMPUTED_DECIMALS = 12;

/** English fraction denominator words ("five sixths", "three quarters"), singular or plural. */
const DENOMINATOR_WORDS: Record<string, number> = {
  half: 2,
  halves: 2,
  third: 3,
  thirds: 3,
  quarter: 4,
  quarters: 4,
  fourth: 4,
  fourths: 4,
  fifth: 5,
  fifths: 5,
  sixth: 6,
  sixths: 6,
  seventh: 7,
  sevenths: 7,
  eighth: 8,
  eighths: 8,
  ninth: 9,
  ninths: 9,
  tenth: 10,
  tenths: 10,
};
/** A spoken fraction, "five sixths" or "3 fourths": a number word or digit, then a denominator. */
const FRACTION_WORDS = new RegExp(
  String.raw`(\d+|[a-z]+)\s+(${Object.keys(DENOMINATOR_WORDS).join('|')})\b`,
  'gu',
);
/** "5 out of 6": a spoken fraction, numerator and denominator each a number word or digit. */
const OUT_OF = /(\d+|[a-z]+)\s+out\s+of\s+(\d+|[a-z]+)\b/gu;
/** A percentage ("83%", "83.5%"): the number over 100. */
const PERCENT = /(\d+(?:\.\d+)?)\s*%/gu;
/** Single digit words, for a decimal read digit by digit ("zero point eight three"). */
const DIGIT_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
};
/**
 * A decimal read digit by digit: one number word for the whole part (keeps false positives down;
 * "the point is ..." never names a number), "point", then one or more digit words.
 */
const SPOKEN_DECIMAL =
  /([a-z]+)\s+point\s+((?:(?:zero|one|two|three|four|five|six|seven|eight|nine)\s*)+)\b/gu;

/** `w` as a plain integer: a digit string, or a single small number word (no scale words). */
function smallWordValue(w: string): number | undefined {
  if (/^\d+$/.test(w)) return Number(w);
  const nw = numberWord(w);
  return nw?.kind === 'small' ? nw.value : undefined;
}

/** Digits after the point as written, less the exponent ("1.25" is 2, "1.6e1" is 0). */
function literalDecimals(m: RegExpMatchArray): number {
  const [, hex, bin, oct, , frac, exp] = m;
  if (hex !== undefined || bin !== undefined || oct !== undefined) return 0;
  return Math.max(0, (frac?.length ?? 1) - 1 - Number(exp ?? '0'));
}

function literalValue(m: RegExpMatchArray): number {
  const [, hex, bin, oct, int, frac, exp, suffix] = m;
  if (hex !== undefined) return parseInt(hex, 16);
  if (bin !== undefined) return parseInt(bin, 2);
  if (oct !== undefined) return parseInt(oct, 8);
  let v = Number(`${(int as string).replace(/[, ]/g, '')}${frac ?? ''}e${exp ?? '0'}`);
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

const TOKEN = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)?|\d+|=/gu;
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
    "it's",
    'its',
    'runs',
    'run',
    'chalega',
    'chalegi',
    'chalta',
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
    'चलेगा',
    'चलेगी',
  ].map(foldWord),
);
/**
 * "baar"/"times" ("do baar", "three times") are weak markers (4.5c, fix round 3): on their own
 * they are ordinary count words ("ek baar try karo", "read it three times"), so they count as an
 * answer word only when a run/print verb sits anywhere from the marker to the end of its sentence
 * ("three times it runs", "teen baar yeh chalega", not just right next to the marker), and never
 * when an imperative sits right next to the marker or ends the sentence (that beats a run verb
 * later in the sentence: "do baar chalega socho" still never counts).
 */
const WEAK_MARKERS = new Set(['baar', 'times', 'बार'].map(foldWord));
const RUN_VERBS = new Set(
  [
    'chalega',
    'chalegi',
    'chalti',
    'chalta',
    'runs',
    'prints',
    'print',
    'executes',
    'execute',
    'loops',
    'loop',
    'चलेगा',
    'चलेगी',
    'छपेगा',
  ].map(foldWord),
);
const IMPERATIVES = new Set(
  ['karo', 'padho', 'socho', 'dekho', 'try', 'read', 'likho'].map(foldWord),
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

const wordOf = (t: Token): string => t.text.replace('’', "'");

/** The word right next to `k` (index `k - 1` or `k + 1`), in the same sentence, else undefined. */
function neighborWord(toks: readonly Token[], k: number, dir: -1 | 1): string | undefined {
  const n = k + dir;
  if (n < 0 || n >= toks.length) return undefined;
  const between = dir === 1 ? (toks[n] as Token) : (toks[k] as Token);
  if (between.breakBefore) return undefined;
  return wordOf(toks[n] as Token);
}

/** The index of the last token of the sentence (by breakBefore boundaries) that holds token `k`. */
function sentenceEnd(toks: readonly Token[], k: number): number {
  let end = k;
  while (end + 1 < toks.length && !(toks[end + 1] as Token).breakBefore) end++;
  return end;
}

/**
 * Whether token `k` counts as an answer marker: a strong marker always does; a weak marker
 * ("baar", "times") only when a run/print verb sits anywhere from it to the end of the sentence
 * ("three times it runs", "teen baar yeh chalega", not just right next to the marker), never when
 * an imperative sits right next to the marker or ends the sentence (see WEAK_MARKERS). A word
 * before the marker is never scanned for a run verb: a sentence can open with an instruction word
 * that happens to spell the same as a run verb ("Loop teen baar. Chalega." — "Loop" here is the
 * instruction, not a report that the code runs, and the run verb it does hold is in the next
 * sentence).
 */
function isAnswerMarker(toks: readonly Token[], k: number): boolean {
  const w = wordOf(toks[k] as Token);
  if (MARKERS.has(w)) return true;
  if (!WEAK_MARKERS.has(w)) return false;
  const before = neighborWord(toks, k, -1);
  const after = neighborWord(toks, k, 1);
  if (
    (before !== undefined && IMPERATIVES.has(before)) ||
    (after !== undefined && IMPERATIVES.has(after))
  ) {
    return false;
  }
  const end = sentenceEnd(toks, k);
  if (IMPERATIVES.has(wordOf(toks[end] as Token))) return false;
  for (let i = k + 1; i <= end; i++) {
    if (RUN_VERBS.has(wordOf(toks[i] as Token))) return true;
  }
  return false;
}

/** Whether tokens [i, j] have an answer marker within the window, in the same sentence. */
function inAnswerContext(toks: readonly Token[], i: number, j: number): boolean {
  if (i >= toks.length) return false;
  let alone = true;
  for (let k = i - 1; k >= 0 && !(toks[k + 1] as Token).breakBefore; k--) {
    alone = false;
    if (i - k <= BEFORE_WINDOW && isAnswerMarker(toks, k)) return true;
  }
  for (let k = j + 1; k < toks.length && !(toks[k] as Token).breakBefore; k++) {
    alone = false;
    if (k - j <= AFTER_WINDOW && isAnswerMarker(toks, k)) return true;
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
    const num = total + current;
    const value = canonicalNumber(num) as string;
    out.push({
      value,
      num,
      decimals: 0,
      kind: 'word',
      answerContext: inAnswerContext(toks, first, lastAt),
      weak: false,
    });
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
  const push = (
    n: number,
    decimals: number,
    kind: MentionKind,
    start: number,
    end: number,
    weak = false,
  ) => {
    const value = canonicalNumber(n);
    if (value === undefined) return;
    const [i, j] = tokensOf(toks, start, end);
    const num = Math.abs(n);
    const d = Number.isInteger(num) ? 0 : decimals;
    out.push({ value, num, decimals: d, kind, answerContext: inAnswerContext(toks, i, j), weak });
  };
  for (const m of s.matchAll(LITERAL)) {
    push(literalValue(m), literalDecimals(m), 'digits', m.index, m.index + m[0].length);
  }
  for (const m of s.matchAll(DOT_DECIMAL)) {
    const digits = m[1] as string;
    push(Number(`0.${digits}`), digits.length, 'digits', m.index, m.index + m[0].length);
  }
  for (const m of s.matchAll(SPACED)) {
    push(Number(m[0].replace(/ /g, '')), 0, 'digits', m.index, m.index + m[0].length);
  }
  for (const a of arithmeticSpans(s)) push(a.value, COMPUTED_DECIMALS, 'expr', a.start, a.end);
  for (const m of s.matchAll(FRACTION_WORDS)) {
    const num = smallWordValue(m[1] as string);
    const denom = DENOMINATOR_WORDS[m[2] as string];
    if (num === undefined || denom === undefined) continue;
    push(num / denom, COMPUTED_DECIMALS, 'word', m.index, m.index + m[0].length, true);
  }
  for (const m of s.matchAll(OUT_OF)) {
    const num = smallWordValue(m[1] as string);
    const denom = smallWordValue(m[2] as string);
    if (num === undefined || denom === undefined || denom === 0) continue;
    push(num / denom, COMPUTED_DECIMALS, 'word', m.index, m.index + m[0].length, true);
  }
  for (const m of s.matchAll(PERCENT)) {
    const text = m[1] as string;
    const dot = text.indexOf('.');
    const written = dot < 0 ? 0 : text.length - dot - 1;
    push(Number(text) / 100, written + 2, 'digits', m.index, m.index + m[0].length, true);
  }
  for (const m of s.matchAll(SPOKEN_DECIMAL)) {
    const whole = smallWordValue(m[1] as string);
    if (whole === undefined) continue;
    const digitWords = (m[2] as string).trim().split(/\s+/);
    const digits = digitWords.map((w) => DIGIT_WORDS[w]);
    if (digits.some((d) => d === undefined)) continue;
    const value = whole + Number(`0.${digits.join('')}`);
    push(value, digits.length, 'word', m.index, m.index + m[0].length, true);
  }
  wordMentions(toks, out);
  return out;
}

/** The set of canonical values `text` names, in any form and context. */
export function numbersMentioned(text: string): Set<string> {
  return new Set(numberMentions(text).map((m) => m.value));
}

/** A key that is one number. */
export interface NumericKey {
  value: string;
  num: number;
  /** Digits after the point as written; -1 for a fraction key ("5/6"), whose value is exact. */
  decimals: number;
}

/**
 * The key when the whole of `key` is one number (a literal, a fraction "a/b" or a number-word
 * phrase), else undefined: such a key is matched as a number, never as a substring.
 */
export function numericKey(key: string): NumericKey | undefined {
  // Quotes, backticks and a closing full stop around a key are not part of it.
  const s = foldForNumbers(key).replace(/^[\s`'"]+|[\s`'".]+$/g, '');
  if (s === '') return undefined;
  const of = (n: number, decimals: number): NumericKey | undefined => {
    const value = canonicalNumber(n);
    return value === undefined ? undefined : { value, num: Math.abs(n), decimals };
  };
  const lit = new RegExp(LITERAL.source, 'u').exec(s);
  if (lit !== null && lit.index === 0 && lit[0].length === s.length) {
    return of(literalValue(lit), literalDecimals(lit));
  }
  if (/^\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?$/.test(s)) {
    const v = evaluateArithmetic(s);
    return v === undefined ? undefined : of(v, Number.isInteger(v) ? 0 : -1);
  }
  const toks = tokenize(s);
  const onlyWords =
    s.replace(/[\p{L}\p{M}\s-]/gu, '') === '' &&
    toks.every((t) => t.text === 'and' || numberWord(t.text) !== undefined);
  if (!onlyWords) return undefined;
  const words: NumberMention[] = [];
  wordMentions(toks, words);
  const w = words.length === 1 ? (words[0] as NumberMention) : undefined;
  return w === undefined ? undefined : { value: w.value, num: w.num, decimals: 0 };
}

/** The canonical value of a one-number key (see numericKey), else undefined. */
export function numericKeyValue(key: string): string | undefined {
  return numericKey(key)?.value;
}

/** Fraction keys match decimals written to at least this many places ("0.83" for 5/6). */
const FRACTION_MIN_DECIMALS = 2;

/**
 * Whether a mention names the key: the same canonical value; or, for a key with decimals, a
 * mention written to at least that precision that rounds to it (".83", "0.833" for 0.83); or, for
 * a fraction key, a decimal of 2+ places the fraction rounds to ("0.83" for 5/6).
 */
export function mentionMatches(m: NumberMention, k: NumericKey): boolean {
  if (m.value === k.value) return true;
  if (k.decimals > 0 && m.decimals >= k.decimals) {
    return m.num.toFixed(k.decimals) === k.num.toFixed(k.decimals);
  }
  if (k.decimals < 0 && m.decimals >= FRACTION_MIN_DECIMALS) {
    const d = Math.min(m.decimals, COMPUTED_DECIMALS);
    return k.num.toFixed(d) === m.num.toFixed(d);
  }
  return false;
}

// ---- claimed arithmetic results (task 4.7, grounding Rule C) ----------------------------------

/** One "expression, then a claimed result" pair, e.g. "7 // 2 is 4". */
export interface ArithmeticClaim {
  /** The claimed number's span in the ORIGINAL text. */
  start: number;
  end: number;
  /** The value the expression really has (Python semantics: `//` floors, `**` binds right). */
  computed: number;
  /** `computed` as text, sign kept: what a fix writes. */
  computedText: string;
  correct: boolean;
}

/**
 * Connector words between an expression and its claimed result. Strict on purpose (lead answer 9):
 * "expr is N", "expr = N", "expr == N" and the same in Hindi ("ka answer N", "का जवाब N"); any
 * looser phrasing is left to the judge.
 */
const CONNECTOR = String.raw`(?:==|=|(?:is|equals|gives|ka|ki|answer|jawab|uttar|result|output|the)(?![\p{L}\p{M}])|का|की|जवाब|उत्तर)`;
const CLAIM_AFTER = new RegExp(
  String.raw`^(?:\s*${CONNECTOR}){1,3}\s*([-−]?)(\d+(?:\.\d+)?)(?![\d.]*\d)(?!\s*(?:\*\*|//|[-+*/%×÷])\s*\d)`,
  'u',
);
/** A unary sign next to `**`: the evaluator binds the sign first, Python binds `**` first. */
const UNARY_WITH_POWER = /(?:^|[-+*/%(])\s*[-+]\s*\d/;

function signedText(n: number): string | undefined {
  const c = canonicalNumber(n);
  return c === undefined ? undefined : `${n < 0 ? '-' : ''}${c}`;
}

/** Whether the claim names the computed value, at the precision it was written ("3.33"). */
function claimHolds(claimed: string, computed: number): boolean {
  if (Number(computed.toPrecision(12)) === Number(claimed)) return true;
  const dot = claimed.indexOf('.');
  return dot >= 0 && computed.toFixed(claimed.length - dot - 1) === claimed;
}

/** Every arithmetic expression in `text` that is directly followed by a claimed result. */
export function arithmeticClaims(text: string): ArithmeticClaim[] {
  const f = foldText(text, (u) => foldWord(u.toLowerCase()));
  const s = f.s;
  const out: ArithmeticClaim[] = [];
  for (const span of arithmeticSpans(s)) {
    const expr = s.slice(span.start, span.end);
    if (expr.includes('**') && UNARY_WITH_POWER.test(expr)) continue;
    const m = CLAIM_AFTER.exec(s.slice(span.end));
    const computedText = signedText(span.value);
    if (m === null || computedText === undefined) continue;
    const sign = m[1] as string;
    const digits = m[2] as string;
    const claimEnd = span.end + m[0].length;
    const claimStart = claimEnd - digits.length - sign.length;
    out.push({
      start: f.at[claimStart] as number,
      end: claimEnd < f.at.length ? (f.at[claimEnd] as number) : text.length,
      computed: span.value,
      computedText,
      correct: claimHolds(`${sign === '' ? '' : '-'}${digits}`, span.value),
    });
  }
  return out;
}

/** `text` with every wrong claimed result replaced by the computed value; `fixed` counts them. */
export function correctArithmeticClaims(text: string): { text: string; fixed: number } {
  const wrong = arithmeticClaims(text).filter((c) => !c.correct);
  let out = text;
  for (const c of [...wrong].reverse()) {
    out = out.slice(0, c.start) + c.computedText + out.slice(c.end);
  }
  return { text: out, fixed: wrong.length };
}
