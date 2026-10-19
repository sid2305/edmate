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

export interface FoldedDigitForms {
  /** The folded copy: keycap marks dropped, superscript/circled digits as ASCII. */
  readonly text: string;
  /** Per UTF-16 unit of `text`, the start of the original span it came from. */
  readonly from: readonly number[];
  /** Per UTF-16 unit of `text`, the (exclusive) end of the original span it came from. */
  readonly to: readonly number[];
}

/** NFKC-folds one code point: a superscript or circled digit decomposes to a plain ASCII digit. */
function foldOne(ch: string): string {
  const nf = ch.normalize('NFKC');
  return nf.length === 1 && ND.test(nf) ? nf : ch;
}

/** Folds keycap/superscript/circled digit presentations; drops marks that follow a digit. */
export function foldDigitForms(text: string): FoldedDigitForms {
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
    const folded = foldOne(ch);
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
