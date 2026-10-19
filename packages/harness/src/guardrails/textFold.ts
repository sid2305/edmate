// The shared digit and format helper (task 4.5, lifted from 4.2's piiPatterns). Every guard that
// reads numbers or hunts for hidden text folds it the same way: each \p{Nd} decimal digit, in any
// script (Devanagari, Bengali, Arabic-Indic, fullwidth, mathematical, ...), becomes ASCII 0-9, and
// invisible format characters (\p{Cf}: zero-width space and joiners, BOM, soft hyphen, bidi marks)
// are recognised so a caller can drop them or treat them as a separator.
//
// Fix round (4.2c x 4.5, 19 Oct 2026): `foldText` (the shared entry point) runs the digit-form
// pre-pass (`digitForms.ts`, task 4.2c: keycap sequences, superscript/circled digits, and a mark
// dropped right after a digit) FIRST, before its own per-code-point NFKC/\p{Cf} fold, so every
// caller of `foldText` — `answerKey.ts` (and so `answerLeak`), `numbers.ts` — gets the same digit
// folding `piiScrub` already had. `piiPatterns.ts` keeps its own explicit
// `foldDigitForms(text)` → `buildView(...)` chain (it needs per-span `from`/`to` pairs, not this
// module's single-index `at`), so it is already first and is unaffected by this change.
import { foldDigitForms } from './digitForms.js';

const ND = /^\p{Nd}$/u;
const CF = /^\p{Cf}$/u;
const digitCache = new Map<number, number>();

/** True for a \p{Nd} decimal digit in any script. */
export function isDecimalDigit(ch: string): boolean {
  return ND.test(ch);
}

/** True for an invisible format character (\p{Cf}). */
export function isFormatChar(ch: string): boolean {
  return CF.test(ch);
}

const isNd = (cp: number): boolean => ND.test(String.fromCodePoint(cp));

/** The value of a \p{Nd} code point: Unicode keeps each digit set contiguous, 0 first. */
export function digitValue(cp: number): number {
  const cached = digitCache.get(cp);
  if (cached !== undefined) return cached;
  let start = cp;
  while (isNd(start - 1)) start--;
  const v = (cp - start) % 10;
  digitCache.set(cp, v);
  return v;
}

/** A folded copy of a text plus, per folded UTF-16 unit, the original index it came from. */
export interface FoldedText {
  s: string;
  /** `at[k]` is the index in the original text of the code point folded unit `k` came from. */
  at: number[];
}

const nfkcCache = new Map<number, string>();

/** NFKC of one code point, cached (ASCII is returned as is). */
function nfkc(ch: string, cp: number): string {
  if (cp < 0x80) return ch;
  let out = nfkcCache.get(cp);
  if (out === undefined) {
    out = ch.normalize('NFKC');
    nfkcCache.set(cp, out);
  }
  return out;
}

/**
 * Folds `text` code point by code point: \p{Cf} dropped, NFKC applied, every \p{Nd} digit (also
 * one NFKC produced, e.g. a superscript) made ASCII. `extra` may map a folded unit further (or
 * drop it by returning ''). The fold is context-free, so fold(a + b) is fold(a) + fold(b).
 */
export function foldText(text: string, extra?: (unit: string) => string): FoldedText {
  const pre = foldDigitForms(text);
  const src = pre.text;
  const parts: string[] = [];
  const at: number[] = [];
  for (let i = 0; i < src.length;) {
    const cp = src.codePointAt(i) as number;
    const len = cp > 0xffff ? 2 : 1;
    const ch = src.slice(i, i + len);
    if (!CF.test(ch)) {
      for (const u of nfkc(ch, cp)) {
        const ucp = u.codePointAt(0) as number;
        let f = ucp >= 0x30 && ucp <= 0x39 ? u : ND.test(u) ? String(digitValue(ucp)) : u;
        if (extra !== undefined) f = extra(f);
        for (let k = 0; k < f.length; k++) at.push(pre.from[i] as number);
        parts.push(f);
      }
    }
    i += len;
  }
  return { s: parts.join(''), at };
}
