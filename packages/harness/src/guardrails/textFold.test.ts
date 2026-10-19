import { describe, expect, it } from 'vitest';
import { digitValue, foldText, isDecimalDigit, isFormatChar } from './textFold.js';

describe('textFold', () => {
  it('reads the value of a digit in any \\p{Nd} script', () => {
    expect(digitValue('७'.codePointAt(0) as number)).toBe(7); // Devanagari
    expect(digitValue('৩'.codePointAt(0) as number)).toBe(3); // Bengali
    expect(digitValue('٥'.codePointAt(0) as number)).toBe(5); // Arabic-Indic
    expect(digitValue('۹'.codePointAt(0) as number)).toBe(9); // extended Arabic-Indic
    expect(digitValue('०'.codePointAt(0) as number)).toBe(0);
    // Cached on the second read.
    expect(digitValue('७'.codePointAt(0) as number)).toBe(7);
  });

  it('classifies digits and format characters', () => {
    expect(isDecimalDigit('६')).toBe(true);
    expect(isDecimalDigit('a')).toBe(false);
    expect(isFormatChar('\u200B')).toBe(true);
    expect(isFormatChar('\u00AD')).toBe(true);
    expect(isFormatChar(' ')).toBe(false);
  });

  it('folds digits, drops \\p{Cf} and applies NFKC per code point, with a map back', () => {
    const f = foldText('a१\u200B६ ２𝟓²');
    expect(f.s).toBe('a16 252');
    expect(f.at).toEqual([0, 1, 3, 4, 5, 6, 8]);
  });

  it('applies an extra per-unit map (and may drop units)', () => {
    expect(foldText('A\\b', (u) => (u === '\\' ? '' : u.toLowerCase())).s).toBe('ab');
  });

  it('expands a code point NFKC turns into several units, each mapped to its source', () => {
    const f = foldText('ﬁ½');
    expect(f.s).toBe('fi1⁄2');
    expect(f.at).toEqual([0, 0, 1, 1, 1]);
  });

  describe('fix round (4.2c x 4.5): the digit-form pre-pass runs first', () => {
    it('folds a keycap digit sequence before its own fold runs', () => {
      expect(foldText('call 9️⃣8️⃣7️⃣ now').s).toBe('call 987 now');
    });

    it('folds a superscript/circled digit', () => {
      const f = foldText('x ⑨ y');
      expect(f.s).toBe('x 9 y');
      expect(f.at).toEqual([0, 1, 2, 3, 4]);
    });

    it('drops a mark that follows a digit, with a correct position map', () => {
      // "9͏8" (CGJ between the digits) folds to "98"; the "8" still maps back to its own
      // original index (2), not the dropped CGJ's.
      const f = foldText('9͏8');
      expect(f.s).toBe('98');
      expect(f.at).toEqual([0, 2]);
    });
  });
});
