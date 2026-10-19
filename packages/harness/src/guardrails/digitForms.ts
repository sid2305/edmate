// Digit-form pre-pass for the PII patterns (task 4.2c). Runs *before* `piiPatterns.ts`'s own
// digit-folding view, as a separate module and function: 4.5 is moving that existing
// `digitValue`/`fold`/`\p{Cf}` block to a shared helper on its own branch, so this file leaves it
// untouched to avoid a merge conflict (lead instruction, 19 Oct 2026; whichever PR merges second
// rebases).
//
// Folds three digit *presentations* that NFKC on the whole string would not collapse on its own:
// - superscript and circled digits (⁹, ⑨): each one decomposes to a single ASCII digit under
//   per-code-point NFKC, so folding one code point at a time is enough;
// - keycap sequences (9️⃣ = DIGIT NINE + U+FE0F VARIATION SELECTOR-16 + U+20E3 COMBINING ENCLOSING
//   KEYCAP): the marks have no decomposition, so they are dropped, not folded;
// - any `\p{Default_Ignorable_Code_Point}` or `\p{M}` (combining mark) immediately *following a
//   digit* is dropped too, so a CGJ (U+034F), Hangul filler (U+3164), braille blank (U+2800), a
//   stray variation selector or combining mark can never split or disguise a digit run.
//
// The result keeps every non-digit, non-mark character byte for byte and carries a map back to
// the original text, so a caller can redact spans found in the folded copy against the original.
const ND = /^\p{Nd}$/u;
// U+2800 (braille pattern blank) is not itself Default_Ignorable or a mark, but it renders as
// nothing and is used the same way as one, so it is named explicitly.
const DROP_AFTER_DIGIT = /^[\p{Default_Ignorable_Code_Point}\p{M}⠀]$/u;
/**
 * Performance fix round (19 Oct 2026): a whole-string pre-test, run once, for every character this
 * module can possibly change. Almost no text has any of these, so the common case — the stream
 * gate calling this (via `textFold.foldText`) on every sentence, over its whole check window —
 * skips the per-code-point loop below entirely (no `normalize()` calls, no per-char regex test, no
 * string-part concatenation), instead of paying that cost on text this module never touches.
 * Matches: a keycap sequence's own marks (U+FE0F, U+20E3); a superscript or subscript digit
 * (U+00B2/U+00B3/U+00B9, U+2070, U+2074-2079, U+2080-2089); a circled or enclosed digit (U+2460-
 * U+2473, U+24EA, U+24F5-U+24FE, U+2776-U+277F); any OTHER \p{Nd} digit that isn't plain ASCII
 * 0-9 (covers both a digit that stays byte for byte, e.g. Devanagari, and one NFKC does decompose
 * to ASCII, e.g. a Mathematical Alphanumeric digit — both are \p{Nd} themselves, so this is the
 * only way to catch the second without missing it); or an ASCII digit immediately followed by a
 * default-ignorable/combining/braille-blank character (the "mark dropped after a digit" case).
 * Over-matching (running the slow path when nothing would actually change) only costs a little
 * speed, never correctness, so this stays a conservative, not exact, pre-test.
 */
const NEEDS_FOLD = new RegExp(
  // The keycap marks are each their own alternative (never inside a character class together
  // with another character): a lint rule flags two combining-prone code points sitting next to
  // each other in one `[...]` as visually misleading, even written as `\u` escapes.
  '\\uFE0F|\\u20E3' +
    '|[\\u00B2\\u00B3\\u00B9\\u2070\\u2074-\\u2079\\u2080-\\u2089' +
    '\\u2460-\\u2473\\u24EA\\u24F5-\\u24FE\\u2776-\\u277F]' +
    '|(?=\\p{Nd})[^0-9]' +
    '|[0-9][\\p{Default_Ignorable_Code_Point}\\p{M}\\u2800]',
  'u',
);

export interface FoldedDigitForms {
  /** The folded copy: keycap marks dropped, superscript/circled digits as ASCII. */
  readonly text: string;
  /** Per UTF-16 unit of `text`, the start of the original span it came from. */
  readonly from: readonly number[];
  /** Per UTF-16 unit of `text`, the (exclusive) end of the original span it came from. */
  readonly to: readonly number[];
}

/** The identity map: every unit stands for its own one-unit span (the fast, common path). */
function identityFold(text: string): FoldedDigitForms {
  const from = new Array<number>(text.length);
  const to = new Array<number>(text.length);
  for (let i = 0; i < text.length; i++) {
    from[i] = i;
    to[i] = i + 1;
  }
  return { text, from, to };
}

/** NFKC-folds one code point: a superscript or circled digit decomposes to a plain ASCII digit.
 * Plain ASCII (by far the common case) skips `normalize()` entirely: NFKC never changes it. */
function foldOne(ch: string, cp: number): string {
  if (cp < 0x80) return ch;
  const nf = ch.normalize('NFKC');
  return nf.length === 1 && ND.test(nf) ? nf : ch;
}

/** Folds keycap/superscript/circled digit presentations; drops marks that follow a digit. */
export function foldDigitForms(text: string): FoldedDigitForms {
  if (!NEEDS_FOLD.test(text)) return identityFold(text);
  const parts: string[] = [];
  const from: number[] = [];
  const to: number[] = [];
  let lastWasDigit = false;
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i) as number;
    const len = cp > 0xffff ? 2 : 1;
    const ch = text.slice(i, i + len);
    if (lastWasDigit && DROP_AFTER_DIGIT.test(ch)) {
      // Extend the preceding retained unit's original span so a run of dropped marks trailing
      // the very last digit of a match is still covered when a caller maps a span back.
      // `lastWasDigit` can only be true once a unit has already been pushed, so `to` is never
      // empty here.
      to[to.length - 1] = i + len;
      i += len;
      continue;
    }
    const folded = foldOne(ch, cp);
    lastWasDigit = ND.test(folded);
    for (let k = 0; k < folded.length; k++) {
      from.push(i);
      to.push(i + len);
    }
    parts.push(folded);
    i += len;
  }
  return { text: parts.join(''), from, to };
}
