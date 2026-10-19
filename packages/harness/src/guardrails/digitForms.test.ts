// Fixture digits here are fake. Test names carry plain labels only.
import { describe, expect, it } from 'vitest';
import { foldDigitForms } from './digitForms.js';

const fold = (t: string) => foldDigitForms(t).text;

describe('foldDigitForms', () => {
  it('folds superscript digits to ASCII', () => {
    expect(fold('⁹⁸⁷')).toBe('987');
  });

  it('folds circled digits to ASCII (0 and 1-9)', () => {
    expect(fold('⑨')).toBe('9');
    expect(fold('①②③')).toBe('123');
  });

  it('folds a keycap digit sequence (digit + VS16 + combining enclosing keycap) to the digit', () => {
    expect(fold('9️⃣')).toBe('9');
    expect(fold('9️⃣8️⃣7️⃣6️⃣5️⃣4️⃣3️⃣2️⃣1️⃣0️⃣')).toBe('9876543210');
  });

  it('drops a default-ignorable or combining mark that follows a digit', () => {
    expect(fold('9͏8')).toBe('98'); // CGJ
    expect(fold('9ㅤ8')).toBe('98'); // Hangul filler
    expect(fold('9⠀8')).toBe('98'); // braille blank
    expect(fold('9́ 8')).toBe('9 8'); // combining acute accent
  });

  it('keeps a mark that does not follow a digit (not dropped out of context)', () => {
    expect(fold('áb')).toBe('áb');
  });

  it('keeps ordinary ASCII digits and text byte for byte', () => {
    expect(fold('call 1234567890 now')).toBe('call 1234567890 now');
  });

  it('keeps non-digit characters around a folded span, with a correct position map', () => {
    const f = foldDigitForms('x ⑨ y');
    expect(f.text).toBe('x 9 y');
    expect(f.from[2]).toBe(2);
    expect(f.to[2]).toBe(3);
  });

  it('handles an empty string', () => {
    expect(foldDigitForms('')).toEqual({ text: '', from: [], to: [] });
  });

  it('a superscript/circled digit that is not isolated still folds in context', () => {
    expect(fold('step ② of ③')).toBe('step 2 of 3');
  });

  it('handles an astral-plane code point (a mathematical bold digit) as a single unit', () => {
    // U+1D7CE MATHEMATICAL BOLD DIGIT ZERO: a surrogate pair, already an ASCII-equivalent digit
    // under NFKC, so this also exercises the two-UTF-16-unit code point path.
    expect(fold('\u{1D7CF}')).toBe('1');
  });
});
