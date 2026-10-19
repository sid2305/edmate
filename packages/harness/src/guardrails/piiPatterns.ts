// Regex PII detection for the piiScrub guard (task 4.2). Pure functions, no model call.
//
// Matching runs on two same-meaning copies ("views") of the text, never on the text itself:
// every decimal digit (Devanagari, Bengali, fullwidth, mathematical, ...) folded to ASCII,
// fullwidth ASCII folded, spaces and dashes normalised, and invisible format characters
// (zero-width space/joiners, BOM, soft hyphen, bidi marks: \p{Cf}) either shown as a space (so
// they act as a separator) or dropped (so they can't split a number). Each view keeps a map back
// to the original, and the spans found in either are redacted in the original text, which is
// otherwise kept byte for byte.
//
// Scope (build plan § guard table): phone, email, card (plus CVV/expiry next to a card), OTP-like
// numbers, the student's own name when they introduce themselves, and the locale pack's patterns.
// Street addresses are out of scope (lead decision 18 Oct 2026).

/** In priority order: on overlapping spans of equal length, the earlier category names the result. */
export const PII_CATEGORIES = Object.freeze([
  'card',
  'phone',
  'id',
  'otp',
  'email',
  'name',
] as const);
export type PiiCategory = (typeof PII_CATEGORIES)[number];

/** Placeholders hold no digit, no `@` and no name-shaped word, so no pattern matches them. */
export const PII_PLACEHOLDERS: Readonly<Record<PiiCategory, string>> = Object.freeze({
  card: '[card]',
  phone: '[phone]',
  id: '[id]',
  otp: '[otp]',
  email: '[email]',
  name: '[name]',
});

export interface PiiSpan {
  start: number;
  end: number;
  category: PiiCategory;
}

/** A locale pattern that does not compile with 'gu', or a scrub that does not settle. */
export class PiiPatternError extends Error {
  override readonly name = 'PiiPatternError';
}

/** The only flags a locale pattern is compiled with: never `i`, never `y` or `m`. */
const LOCALE_FLAGS = 'gu';
/** Redaction rounds before the scrub gives up (fails closed). Real text settles in two. */
const MAX_ROUNDS = 4;

/** Compiles each locale-pack source with exactly 'gu'. Any failure throws (fail closed). */
export function compileLocalePatterns(sources: readonly string[]): RegExp[] {
  return sources.map((source, i) => {
    try {
      if (typeof source !== 'string') throw new TypeError('not a string');
      return new RegExp(source, LOCALE_FLAGS);
    } catch {
      // Named by position only: the source is config, but keep messages free of any text.
      throw new PiiPatternError(`locale PII pattern ${i} does not compile with flags gu`);
    }
  });
}

// ---- views ----------------------------------------------------------------------------------

interface View {
  s: string;
  /** Per view UTF-16 unit: the original span [from, to) it came from. */
  from: number[];
  to: number[];
}

const ND = /^\p{Nd}$/u;
const CF = /^\p{Cf}$/u;
const ZS = /^\p{Zs}$/u;
const DASHES = /^[‐-―−﹘﹣]$/u;
const digitCache = new Map<number, number>();

const isNd = (cp: number): boolean => ND.test(String.fromCodePoint(cp));

/** The digit value of a \p{Nd} code point: Unicode keeps each digit set contiguous, 0 first. */
function digitValue(cp: number): number {
  const cached = digitCache.get(cp);
  if (cached !== undefined) return cached;
  let start = cp;
  while (isNd(start - 1)) start--;
  const v = (cp - start) % 10;
  digitCache.set(cp, v);
  return v;
}

function fold(ch: string, cp: number): string {
  if (cp >= 0x30 && cp <= 0x39) return ch;
  if (ND.test(ch)) return String(digitValue(cp));
  if (cp >= 0xff01 && cp <= 0xff5e) return String.fromCharCode(cp - 0xfee0);
  if (ZS.test(ch)) return ' ';
  if (DASHES.test(ch)) return '-';
  return ch;
}

function buildView(text: string, dropInvisible: boolean): View {
  const parts: string[] = [];
  const from: number[] = [];
  const to: number[] = [];
  for (let i = 0; i < text.length;) {
    const cp = text.codePointAt(i) as number;
    const len = cp > 0xffff ? 2 : 1;
    const ch = text.slice(i, i + len);
    let out: string;
    if (CF.test(ch)) {
      if (dropInvisible) {
        i += len;
        continue;
      }
      out = ' ';
    } else {
      out = fold(ch, cp);
    }
    for (let k = 0; k < out.length; k++) {
      from.push(i);
      to.push(i + len);
    }
    parts.push(out);
    i += len;
  }
  return { s: parts.join(''), from, to };
}

// ---- generic patterns (on a view: ASCII digits) ---------------------------------------------

/** Phone separators: space . - ( ), one or two of them (a zero-width char shows as a space). */
const S = String.raw`(?:[ .\-()]{1,2})`;
const CC = String.raw`\+\d{1,3}`;
const GROUPED = String.raw`(?:\d{5}${S}\d{5}|\d{3}${S}\d{3}${S}\d{4}|\d{4}${S}\d{3}${S}\d{3})`;
const PHONE_GROUPED = new RegExp(
  String.raw`(?<![\d+])(?:${CC}${S}?|0${S}?|\()?${GROUPED}(?!\d)`,
  'g',
);
const PHONE_CC = new RegExp(String.raw`(?<![\d+])${CC}${S}?\d{9,12}(?!\d)`, 'g');
const PHONE_SPACED = new RegExp(
  String.raw`(?<![\d+])(?<!\d[ .\-])(?:${CC}${S}?)?(\d(?:[ .\-]\d){9})(?![ .\-]?\d)`,
  'gd',
);
const BARE_TEN = /(?<![\d+])0?\d{10}(?!\d)/g;
const PHONE_KEYWORDS = new RegExp(
  String.raw`(?<![\p{L}\p{M}[])(?:phone|mobile|cell|whats\s?app|contact|call|text\s+me|sms|tel|ph|mob|(?:my|mera|meri|mere)\s+(?:number|no\.?|num))(?![\p{L}\p{M}])|फ़ोन|फोन|मोबाइल|मेरा\s+नंबर|कॉल|व्हाट्सएप`,
  'giu',
);
/** How far (in view characters) a keyword may sit from the number it marks. */
const KEYWORD_WINDOW = 30;

const CARD = new RegExp(
  String.raw`(?<![\d+])(?:\d{13,19}|\d{4}(?:[ \-]\d{4}){2}[ \-]\d{3,7}|\d{4}[ \-]\d{6}[ \-]\d{4,5})(?!\d)`,
  'g',
);
const YEAR_GROUPS = /^(?:(?:19|20)\d\d[ -]?)+$/;
const CVV_AFTER = new RegExp(
  String.raw`(?<![\p{L}\p{M}])(?:cvv2?|cvc2?|cid|csc|security\s+code)\s*[:#=\-]?\s*(\d{3,4})(?!\d)`,
  'gdiu',
);
const CVV_BEFORE = new RegExp(
  String.raw`(?<!\d)(\d{3,4})\s*(?:is\s+(?:the\s+|my\s+)?)?(?:cvv2?|cvc2?)(?![\p{L}\p{M}])`,
  'gdiu',
);
const EXPIRY = new RegExp(
  String.raw`(?<![\p{L}\p{M}])(?:exp(?:iry|ires|iration)?(?:\s+date)?|valid\s+(?:thru|through|till|until|upto))\s*[:.\-]?\s*(\d{1,2}\s*[/\-]\s*\d{2,4})(?!\d)`,
  'gdiu',
);
const BARE_EXPIRY = /[\s,;:]*(\d{1,2}\s*\/\s*\d{2,4})(?!\d)/dy;

const OTP_STRONG = new RegExp(
  String.raw`(?<![\p{L}\p{M}[])(?:otp|pin|passcode|(?:verification|login|sign[\s-]?in|access|auth|confirmation)\s+code|one[\s-]?time\s+(?:code|password|pin))(?![\p{L}\p{M}])|ओटीपी|पिन`,
  'giu',
);
const OTP_CODE = new RegExp(
  String.raw`(?:(?<![\p{L}\p{M}_])code(?![\p{L}\p{M}_])|कोड)\s*(?:is|hai|aaya|aya|mila|:|-|है|आया|मिला)?\s*(?:hai|है)?\s*(\d{4,8})(?!\d)`,
  'gdiu',
);
const OTP_NUMBER = /(?<!\d)\d{4,8}(?!\d)/g;

const AT = String.raw`(?:@|\s?[\[({]at[\])}]\s?)`;
const DOT = String.raw`(?:\.|\s?[\[({]dot[\])}]\s?)`;
const EMAIL = new RegExp(
  String.raw`(?<![\p{L}\p{N}._%+\-])[\p{L}\p{N}][\p{L}\p{N}._%+\-]*${AT}[\p{L}\p{N}][\p{L}\p{N}\-]*(?:${DOT}[\p{L}\p{N}\-]+)*${DOT}\p{L}{2,}(?![\p{L}\p{N}])`,
  'giu',
);

// Own name: an introduction phrase, then up to three name words.
/** "my name is" and friends: any script, any case, after them. */
const NAME_STRONG = new RegExp(
  String.raw`(?<![\p{L}\p{M}])(?:my\s+name\s+is|my\s+name['’]s|mera\s+(?:naam|nam|name))(?![\p{L}\p{M}])|मेरा\s+नाम`,
  'giu',
);
/** "I'm", "I am", "myself", "call me": only Title-Case words after them. */
const NAME_WEAK = new RegExp(
  String.raw`(?<![\p{L}\p{M}])(?:i['’]?m|i\s+am|myself|call\s+me)(?![\p{L}\p{M}])`,
  'giu',
);
/** "main <Name> hoon": the shape is checked here, the words by nameWords. */
const NAME_MAIN = new RegExp(
  String.raw`(?<![\p{L}\p{M}])[Mm]ain(?=(?:[^\S\r\n]+\p{Lu}[\p{Ll}\p{M}]+){1,3}[^\S\r\n]+(?:hoon|hun|hu|hoo)(?![\p{L}\p{M}]))`,
  'gu',
);
const WORD_ANY = /[^\S\r\n]+([\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*)/duy;
const WORD_TITLE =
  /[^\S\r\n]+(\p{Lu}[\p{Ll}\p{M}]*(?:['’-]\p{Lu}?[\p{Ll}\p{M}]+)*)(?![\p{L}\p{M}])/duy;
/** Words that end a name, or that follow "I'm" without being one. Lower-cased. */
const NOT_A_NAME = new Set(
  (
    'hai he h hain hu hoon hun है हैं हूँ हूं and aur or but so i im is the a an from in on at ' +
    'to of for with kya क्या what kaun कौन not nahi नहीं और से का की ' +
    'ready done learning stuck confused back here new trying sorry fine good okay ok going ' +
    'working sure still very really also just using getting doing studying writing reading ' +
    'having looking unable able happy sad tired bored excited interested curious lost late ' +
    'free busy python java beginner student teacher my me name naam mera meri ' +
    // Feelings and states: a distress message must never lose these words (safety review).
    'feeling feel feels felt suicidal suicide depressed depression alone lonely akela akeli ' +
    'marna marne mar mujhe jaana jana chahta chahti chahiye hopeless helpless worthless useless ' +
    'scared afraid frightened anxious nervous worried upset angry hurt hurting broken empty numb ' +
    'stressed overwhelmed crying dying dead finished unsafe unhappy miserable pareshan pareshaan ' +
    'udaas udas dukhi thaka thaki thak ghabraya ghabrayi dara dari bimar beemar sick ill ' +
    'exhausted ashamed guilty embarrassed trapped desperate suffering struggling failing ' +
    'kill killing ending gone over tension frustrated irritated jealous ' +
    // Nationality, language and medium words.
    'indian hindi english tamil telugu marathi bengali bangla gujarati punjabi kannada ' +
    'malayalam urdu odia assamese nepali medium american british foreign ' +
    // Common adjectives and fillers.
    'bad weak strong smart dumb stupid poor rich young old big small tall short fat thin ugly ' +
    'normal alright great better best worse worst later soon now today tomorrow kal aaj abhi ' +
    'always never sometimes again too quite pretty extremely totally completely literally ' +
    'class grade standard'
  ).split(' '),
);
const MAX_NAME_WORDS = 3;

// ---- detection ------------------------------------------------------------------------------

function all(re: RegExp, s: string): RegExpExecArray[] {
  return [...s.matchAll(re)];
}

/** The span of capture group 1 (patterns compiled with the d flag). */
function group1(m: RegExpExecArray): [number, number] {
  return (m.indices as RegExpIndicesArray)[1] as [number, number];
}

const span = (start: number, end: number, category: PiiCategory): PiiSpan => ({
  start,
  end,
  category,
});

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

function cards(s: string): PiiSpan[] {
  const out: PiiSpan[] = [];
  for (const m of all(CARD, s)) {
    if (YEAR_GROUPS.test(m[0]) || !luhn(m[0].replace(/\D/g, ''))) continue;
    out.push(span(m.index, m.index + m[0].length, 'card'));
  }
  if (out.length === 0) return out;
  // CVV and expiry only count next to a card number in the same message.
  for (const re of [CVV_AFTER, CVV_BEFORE, EXPIRY]) {
    for (const m of all(re, s)) out.push(span(...group1(m), 'card'));
  }
  for (const c of [...out]) {
    BARE_EXPIRY.lastIndex = c.end;
    const m = BARE_EXPIRY.exec(s);
    if (m !== null) out.push(span(...group1(m), 'card'));
  }
  return out;
}

const ranges = (re: RegExp, s: string): [number, number][] =>
  all(re, s).map((m) => [m.index, m.index + m[0].length]);

/** A run of ten single digits that counts as a phone: not 0/1 bits, not a counting run. */
function phoneLikeDigits(d: string): boolean {
  if (/^[01]+$/.test(d)) return false;
  // Ten digits with one constant step can only step by 0 or ±1 (all 9s, 0..9, 9..0).
  const steps = new Set<number>();
  for (let i = 1; i < d.length; i++) steps.add(Number(d[i]) - Number(d[i - 1]));
  return steps.size !== 1;
}

function phones(s: string): PiiSpan[] {
  const out: PiiSpan[] = [];
  for (const m of all(PHONE_GROUPED, s)) out.push(span(m.index, m.index + m[0].length, 'phone'));
  for (const m of all(PHONE_CC, s)) out.push(span(m.index, m.index + m[0].length, 'phone'));
  for (const m of all(PHONE_SPACED, s)) {
    if (phoneLikeDigits((m[1] as string).replace(/\D/g, ''))) {
      out.push(span(m.index, m.index + m[0].length, 'phone'));
    }
  }
  return out;
}

function otps(s: string): PiiSpan[] {
  return all(OTP_CODE, s).map((m) => span(...group1(m), 'otp'));
}

/** A number that is PII only when a keyword of its kind is within the window. */
interface Candidate {
  start: number;
  end: number;
  category: 'phone' | 'otp';
  /** Keyword spans of the candidate's kind, sorted by start. */
  keywords: readonly [number, number][];
}

function candidates(s: string): Candidate[] {
  const phoneKw = ranges(PHONE_KEYWORDS, s);
  const otpKw = ranges(OTP_STRONG, s);
  return [
    ...ranges(BARE_TEN, s).map(([start, end]) => ({
      start,
      end,
      category: 'phone' as const,
      keywords: phoneKw,
    })),
    ...ranges(OTP_NUMBER, s).map(([start, end]) => ({
      start,
      end,
      category: 'otp' as const,
      keywords: otpKw,
    })),
  ];
}

/**
 * shrink[i]: how much shorter the text before position i gets once `spans` become placeholders,
 * so a gap measured "after redaction" is `(b - a) - (shrink[b] - shrink[a])`.
 */
function shrinkPrefix(length: number, spans: readonly PiiSpan[]): Int32Array {
  const delta = new Int32Array(length + 1);
  for (const sp of mergeSpans(spans)) {
    delta[sp.end] = (delta[sp.end] as number) + size(sp) - PII_PLACEHOLDERS[sp.category].length;
  }
  for (let i = 1; i <= length; i++) delta[i] = (delta[i] as number) + (delta[i - 1] as number);
  return delta;
}

/** The gap between positions a <= b once the spans in it are placeholders (never negative). */
const gapAfter = (a: number, b: number, shrink: Int32Array): number =>
  Math.max(0, b - a - ((shrink[b] as number) - (shrink[a] as number)));

/** Index of the first keyword that starts at or after `pos` (keywords sorted, non-overlapping). */
function firstFrom(keywords: readonly [number, number][], pos: number): number {
  let lo = 0;
  let hi = keywords.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((keywords[mid] as [number, number])[0] < pos) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * True when a keyword is within the window, measured on the text as it will be after redaction.
 * That gap only grows with distance, so the nearest keyword on each side decides it.
 */
function reached(c: Candidate, shrink: Int32Array): boolean {
  const i = firstFrom(c.keywords, c.end);
  const after = c.keywords[i];
  const before = c.keywords[firstFrom(c.keywords, c.start) - 1];
  return (
    (after !== undefined && gapAfter(c.end, after[0], shrink) <= KEYWORD_WINDOW) ||
    (before !== undefined &&
      before[1] <= c.start &&
      gapAfter(before[1], c.start, shrink) <= KEYWORD_WINDOW)
  );
}

/**
 * The keyword-window numbers, decided in one pass over this text. Redacting a span shortens the
 * gaps around it, so a number can come within reach of a keyword only once others are redacted;
 * instead of rescanning the text once per such step (which never settled for long lists), the
 * gaps are measured as they will be after redaction and the set is grown in memory until it
 * stops changing. The result is what a rescan of the redacted text would find, so the outer
 * loop in `scrubPii` settles in two rounds.
 */
function windowed(s: string, fixed: readonly PiiSpan[]): PiiSpan[] {
  const cands = candidates(s);
  const taken: PiiSpan[] = [];
  const done = new Set<Candidate>();
  for (let grew = true; grew;) {
    grew = false;
    const shrink = shrinkPrefix(s.length, [...fixed, ...taken]);
    for (const c of cands) {
      if (!done.has(c) && reached(c, shrink)) {
        done.add(c);
        taken.push(span(c.start, c.end, c.category));
        grew = true;
      }
    }
  }
  return taken;
}

function emails(s: string): PiiSpan[] {
  return ranges(EMAIL, s).map(([a, b]) => span(a, b, 'email'));
}

function localeMatches(s: string, locale: readonly RegExp[]): PiiSpan[] {
  const out: PiiSpan[] = [];
  for (const re of locale) {
    for (const m of all(re, s)) {
      if (m[0].length > 0) out.push(span(m.index, m.index + m[0].length, 'id'));
    }
  }
  return out;
}

/** Up to three name words from `at`; stops at a non-name word, punctuation or a line break. */
function nameWords(s: string, at: number, word: RegExp): [number, number][] {
  const words: [number, number][] = [];
  word.lastIndex = at;
  for (let m = word.exec(s); m !== null && words.length < MAX_NAME_WORDS; m = word.exec(s)) {
    const [a, b] = group1(m);
    const w = s.slice(a, b);
    if (w.length < 2 || NOT_A_NAME.has(w.toLowerCase())) break;
    words.push([a, b]);
  }
  return words;
}

function names(s: string): PiiSpan[] {
  const words: [number, number][] = [];
  for (const [, end] of ranges(NAME_STRONG, s)) words.push(...nameWords(s, end, WORD_ANY));
  for (const [, end] of ranges(NAME_WEAK, s)) words.push(...nameWords(s, end, WORD_TITLE));
  for (const [, end] of ranges(NAME_MAIN, s)) words.push(...nameWords(s, end, WORD_TITLE));
  // Later (and earlier) repeats of a captured word in the same message.
  const tokens = new Set(words.map(([a, b]) => s.slice(a, b)));
  for (const t of tokens) {
    words.push(...ranges(new RegExp(`(?<![\\p{L}\\p{M}])${t}(?![\\p{L}\\p{M}])`, 'giu'), s));
  }
  return words.map(([a, b]) => span(a, b, 'name'));
}

function detect(s: string, locale: readonly RegExp[]): PiiSpan[] {
  const fixed = [
    ...cards(s),
    ...phones(s),
    ...localeMatches(s, locale),
    ...otps(s),
    ...emails(s),
    ...names(s),
  ];
  return [...fixed, ...windowed(s, fixed)];
}

const rank = (c: PiiCategory): number => PII_CATEGORIES.indexOf(c);
const size = (x: PiiSpan): number => x.end - x.start;
/** True when `a` should name a merged span over `b`: longer, then higher priority. */
const better = (a: PiiSpan, b: PiiSpan): boolean =>
  size(a) !== size(b) ? size(a) > size(b) : rank(a.category) < rank(b.category);

/** Sorts and merges overlapping spans; the longest one (then priority) names the merged span. */
export function mergeSpans(spans: readonly PiiSpan[]): PiiSpan[] {
  const sorted = [...spans].sort((x, y) => x.start - y.start || y.end - x.end);
  const out: { start: number; end: number; best: PiiSpan }[] = [];
  for (const sp of sorted) {
    const last = out.at(-1);
    if (last !== undefined && sp.start < last.end) {
      last.end = Math.max(last.end, sp.end);
      if (better(sp, last.best)) last.best = sp;
    } else {
      out.push({ start: sp.start, end: sp.end, best: sp });
    }
  }
  return out.map(({ start, end, best }) => span(start, end, best.category));
}

/** One detection round: every PII span in `text` (original coordinates), sorted and merged. */
export function findPii(text: string, locale: readonly RegExp[]): PiiSpan[] {
  const found: PiiSpan[] = [];
  for (const drop of [false, true]) {
    const v = buildView(text, drop);
    for (const sp of detect(v.s, locale)) {
      found.push(span(v.from[sp.start] as number, v.to[sp.end - 1] as number, sp.category));
    }
  }
  return mergeSpans(found);
}

function redact(text: string, spans: readonly PiiSpan[]): string {
  let out = '';
  let at = 0;
  for (const sp of spans) {
    out += text.slice(at, sp.start) + PII_PLACEHOLDERS[sp.category];
    at = sp.end;
  }
  return out + text.slice(at);
}

/**
 * Redacts every PII span, repeating until nothing is found (a redaction can bring a number
 * into a keyword's window), so the result always passes `findPii` clean. Throws
 * PiiPatternError if it has not settled after a few rounds (fail closed).
 */
export function scrubPii(
  text: string,
  locale: readonly RegExp[],
): { text: string; categories: PiiCategory[] } {
  const seen = new Set<PiiCategory>();
  let out = text;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const spans = findPii(out, locale);
    if (spans.length === 0) {
      return { text: out, categories: PII_CATEGORIES.filter((c) => seen.has(c)) };
    }
    for (const sp of spans) seen.add(sp.category);
    out = redact(out, spans);
  }
  throw new PiiPatternError('PII scrub did not settle');
}
