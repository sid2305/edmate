import { describe, expect, it } from 'vitest';
import {
  decodeBase64Text,
  decodedBase64Spans,
  MAX_CANDIDATE_LENGTH,
  MAX_CANDIDATES,
  wordLike,
} from './base64Leak.js';

describe('decodedBase64Spans', () => {
  it('decodes MTY= to 16', () => {
    expect(decodedBase64Spans('Here you go: MTY=')).toEqual(['16']);
  });

  it('decodes padded, unpadded, base64url and non-ASCII text', () => {
    expect(decodedBase64Spans('MTY')).toEqual([]); // under 4 characters
    expect(decodedBase64Spans('V2FybQ==')).toEqual(['Warm']);
    expect(decodedBase64Spans('V2FybQ')).toEqual(['Warm']);
    expect(decodedBase64Spans('4KSJ4KSk4KWN4KSk4KSwIOCkuOCli+CksuCkuQ')).toEqual(['उत्तर सोलह']);
    expect(decodedBase64Spans('YT9iPmN-')).toEqual(['a?b>c~']);
    expect(decodeBase64Text('8J+YgA==')).toBe('😀'); // four-byte UTF-8
  });

  it('keeps only printable UTF-8: ordinary words give nothing', () => {
    expect(decodedBase64Spans('Trace each line and tell me what the value is')).toEqual([]);
    expect(decodeBase64Text('AAEC')).toBeUndefined(); // control bytes
    expect(decodeBase64Text('YX8=')).toBeUndefined(); // DEL
    expect(decodeBase64Text('77+9')).toBeUndefined(); // the replacement character
    expect(decodeBase64Text('YQkK')).toBe('a\t\n'); // tab and newline are fine
    expect(wordLike('together')).toBe(true);
    expect(wordLike('Look')).toBe(true);
    expect(wordLike('well-known')).toBe(true);
    expect(wordLike('MTY=')).toBe(false);
    expect(wordLike('V2FybQ')).toBe(false);
    expect(decodeBase64Text('/w==')).toBeUndefined(); // 0xFF is never UTF-8
    expect(decodeBase64Text('wIA=')).toBeUndefined(); // overlong
    expect(decodeBase64Text('7aCA')).toBeUndefined(); // a surrogate
    expect(decodeBase64Text('9JCAgA==')).toBeUndefined(); // past U+10FFFF
    expect(decodeBase64Text('4oI=')).toBeUndefined(); // truncated sequence
    expect(decodeBase64Text('4oJB')).toBeUndefined(); // bad continuation byte
    expect(decodeBase64Text('ICAg')).toBeUndefined(); // only spaces
    expect(decodeBase64Text('MTY2M')).toBeUndefined(); // length % 4 == 1
    expect(decodeBase64Text('M===')).toBeUndefined();
    expect(decodeBase64Text('M+/=Q')).toBeUndefined(); // '=' inside
  });

  it('is bounded on long adversarial input', () => {
    const long = 'QUFB'.repeat(10_000); // "AAA...", 30000 bytes
    const t0 = Date.now();
    const out = decodedBase64Spans(long);
    expect(Date.now() - t0).toBeLessThan(1_000);
    expect(out).toHaveLength(1);
    expect(out[0]?.length).toBe((MAX_CANDIDATE_LENGTH / 4) * 3);

    const many = Array.from({ length: MAX_CANDIDATES + 10 }, () => 'MTY=').join(' ');
    expect(decodedBase64Spans(many)).toHaveLength(MAX_CANDIDATES);
  });
});
