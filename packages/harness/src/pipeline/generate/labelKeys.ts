// Label keys (task 5.6b, design 1): a key that is one letter, optionally bracketed ("B", "b",
// "(B)", "B)"), whatever the item kind. A mention of the letter leaks by default, unless it sits
// in an exempt shape:
//   - a list or question naming two or more distinct labels (the item's labels, else A-F) with
//     only separators between them (",", "/", "or", "and", "nor", whitespace), and no emphasis or
//     mark anywhere in the sentence ("A, **B**, C" and "A ✗ B ✓ C ✗" leak);
//   - the item's exact option listing (the caller blanks those spans before calling here).
// An answer or confirm word in the same sentence overrides the list exemption ("The answer is A
// or B"), except for a list naming every label of an item ("Is it A, B or C?", lead answer 1).
// A lowercase "a" or "i" before an ordinary word is the article or pronoun, not a mention ("the
// answer is a fraction"); after an answer word "a because", "a since", "a so", "a as" are
// mentions, and separators and the letters A-F are never ordinary words ("the answer is a or b").
// Look-alikes fold to their letter in place, one unit for one unit (`foldLabels`), so positions
// computed on the folded text point into the original. Inside decoded base64 a label counts only
// in an answer context or as a sentence on its own.
import { foldConfusables } from '../../guardrails/lockedMatch.js';

/** The zero-width pad a multi-unit look-alike is padded with, as lockedMatch's `prepared()`. */
const PAD = '​';

/** The label (an upper-case letter) of a label key, else undefined. */
export function labelOf(key: string): string | undefined {
  const m = /^\s*(?:\(\s*([A-Za-z])\s*\)|([A-Za-z])\s*\)?)\s*$/u.exec(key);
  const letter = m?.[1] ?? m?.[2];
  return letter?.toUpperCase();
}

/** Letter blocks that fold to A-Z: negative circled, squared, negative squared, regional. */
const LETTER_BLOCKS: readonly number[] = [0x1f130, 0x1f150, 0x1f170, 0x1f1e6];

function blockLetter(cp: number): string | undefined {
  for (const base of LETTER_BLOCKS) {
    if (cp >= base && cp < base + 26) return String.fromCharCode(0x41 + cp - base);
  }
  return undefined;
}

/**
 * `text` with every look-alike letter folded to its ASCII letter, exactly as long as `text`: a
 * multi-unit look-alike becomes its letter plus zero-width padding (lead answer 2).
 */
export function foldLabels(text: string): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    if (cp < 0x80) {
      out += ch;
      continue;
    }
    const conf = foldConfusables(ch);
    let letter = blockLetter(cp) ?? (conf !== ch ? conf : undefined);
    if (letter === undefined) {
      const n = ch.normalize('NFKC');
      if (/^[A-Za-z]$/u.test(n)) letter = n;
    }
    out += letter === undefined ? ch : letter + PAD.repeat(ch.length - 1);
  }
  return out;
}

/** Answer and confirm words: one in a sentence binds to every label in it. */
const ANSWER_WORDS = new RegExp(
  "(?<![\\p{L}\\p{N}])(?:answers?|correct|right|wrong|it's|its|it is|is it|go with|pick|choose|" +
    'try|definitely|lean|leaning|hint|for sure|should be|must be)(?![\\p{L}\\p{N}])',
  'iu',
);
/** Emphasis or a mark next to a label breaks a list. */
const MARKS = /\*\*|__|[✓✔✅☑✗✘❌←→⬅➡👈👉]|\(correct\)/u;
const SENTENCE_END = /[!?\n।]|\.(?=\s|$)/gu;
const TOKEN = /[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu;
const NOT_ORDINARY = new Set(['or', 'and', 'nor', 'a', 'b', 'c', 'd', 'e', 'f']);
const AFTER_ANSWER = new Set(['because', 'since', 'so', 'as']);
const SEPARATORS = /^(?:[\s\p{Cf},/]|(?<![\p{L}\p{N}])(?:or|and|nor)(?![\p{L}\p{N}]))*$/iu;

export const hasAnswerWord = (s: string): boolean => ANSWER_WORDS.test(s.replace(/’/gu, "'"));
export const hasMark = (s: string): boolean => MARKS.test(s);

interface Token {
  t: string;
  start: number;
  end: number;
}

/** Each sentence of `text`, as its text. */
export function sentences(text: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (const m of text.matchAll(SENTENCE_END)) {
    const end = m.index + m[0].length;
    out.push(text.slice(from, end));
    from = end;
  }
  if (from < text.length) out.push(text.slice(from));
  return out;
}

const tokensOf = (s: string): Token[] =>
  [...s.matchAll(TOKEN)].map((m) => ({ t: m[0], start: m.index, end: m.index + m[0].length }));

/** The labels (upper case) a sentence's tokens name, each with its token index. */
function labelTokens(s: string, toks: readonly Token[]): { letter: string; k: number }[] {
  const answered = hasAnswerWord(s);
  const out: { letter: string; k: number }[] = [];
  toks.forEach((tok, k) => {
    if (!/^[A-Za-z]$/u.test(tok.t)) return;
    if (tok.t === 'a' || tok.t === 'i') {
      const next = toks[k + 1];
      const gap = next === undefined ? '' : s.slice(tok.end, next.start);
      const word = next?.t.toLowerCase();
      const ordinary =
        word !== undefined &&
        /^[ \t]+$/u.test(gap) &&
        !NOT_ORDINARY.has(word) &&
        !(answered && AFTER_ANSWER.has(word));
      if (ordinary) return;
    }
    out.push({ letter: tok.t.toUpperCase(), k });
  });
  return out;
}

/** What a label check knows about the items: their labels, and each item's full label set. */
export interface LabelScope {
  /** Labels a list may name; A-F with no item context. */
  labels: ReadonlySet<string>;
  /** Each item's labels in full: a list naming all of them is not overridden. */
  full: readonly (readonly string[])[];
}

export const NO_ITEM_SCOPE: LabelScope = { labels: new Set('ABCDEF'), full: [] };

/** The distinct label letters a list run holds, by run, for one sentence's label tokens. */
function runs(
  s: string,
  toks: readonly Token[],
  named: readonly { letter: string; k: number }[],
  scope: LabelScope,
): Map<number, Set<string>> {
  const runOf = new Map<number, Set<string>>();
  let current: Set<string> | undefined;
  let prev: number | undefined;
  for (const { letter, k } of named) {
    if (!scope.labels.has(letter)) {
      current = undefined;
      prev = undefined;
      continue;
    }
    const prevTok = prev === undefined ? undefined : toks[prev];
    const joined =
      current !== undefined &&
      prevTok !== undefined &&
      SEPARATORS.test(s.slice(prevTok.end, (toks[k] as Token).start));
    if (!joined) current = new Set();
    (current as Set<string>).add(letter);
    runOf.set(k, current as Set<string>);
    prev = k;
  }
  return runOf;
}

/**
 * True when `folded` (look-alikes folded, exempt spans blanked) mentions `letter` outside an
 * exempt shape. `decoded`: the text came out of base64, so only an answer context or a sentence
 * that is just the label counts.
 */
export function labelLeaks(
  folded: string,
  letter: string,
  scope: LabelScope,
  decoded = false,
): boolean {
  for (const s of sentences(folded)) {
    const toks = tokensOf(s);
    const named = labelTokens(s, toks);
    const mine = named.filter((n) => n.letter === letter);
    if (mine.length === 0) continue;
    const answered = hasAnswerWord(s);
    if (decoded) {
      if (answered || toks.every((t) => t.t.toUpperCase() === letter)) return true;
      continue;
    }
    const marked = hasMark(s);
    const runOf = runs(s, toks, named, scope);
    for (const { k } of mine) {
      const run = runOf.get(k);
      const list = !marked && run !== undefined && run.size >= 2;
      if (!list) return true;
      const full = scope.full.some((f) => f.includes(letter) && f.every((l) => run.has(l)));
      if (answered && !full) return true;
    }
  }
  return false;
}

/** Every label letter `folded` names anywhere (for ruling options out). */
export function labelsNamedIn(folded: string): Set<string> {
  const out = new Set<string>();
  for (const s of sentences(folded)) {
    for (const n of labelTokens(s, tokensOf(s))) out.add(n.letter);
  }
  return out;
}

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];
const NUMBER_WORDS = ['one', 'two', 'three', 'four', 'five', 'six'];
const SUFFIX = ['st', 'nd', 'rd', 'th', 'th', 'th'];
/** Words a position may stand with and still be "a sentence on its own". */
const FILLER = new Set(['the', 'option', 'choice', 'number', 'no', 'one', 'answer']);

/**
 * True when `text` names the 0-based option `index` by position ("the second option", "option 2",
 * "2nd", "number two") in an answer context or as a sentence on its own (design 3).
 */
export function positionLeaks(text: string, index: number): boolean {
  const n = index + 1;
  const forms = new Set([
    String(n),
    ORDINALS[index] as string,
    NUMBER_WORDS[index] as string,
    `${n}${SUFFIX[index] as string}`,
  ]);
  for (const s of sentences(text)) {
    const toks = tokensOf(s).map((t) => t.t.toLowerCase());
    const at = toks.findIndex((t) => forms.has(t));
    if (at < 0) continue;
    if (hasAnswerWord(s)) return true;
    if (toks.every((t, k) => k === at || FILLER.has(t))) return true;
  }
  return false;
}
