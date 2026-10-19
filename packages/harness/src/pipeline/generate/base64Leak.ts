// Base64 the answer-leak checks look through (task 4.5): "MTY=" is "16". Candidates are runs of
// 4 or more base64 or base64url characters, padded or not, whose length (padding included) is
// valid base64 (length % 4 is not 1). Each is decoded once, never recursively, and kept only when
// the bytes are valid UTF-8 and printable text, so ordinary words that happen to be base64-shaped
// give nothing; a run that reads as a plain word ("together", "Look", "well-known") is
// not a candidate at all, since its decode would be noise (all-caps runs are still decoded:
// "MTY=" is all caps). Work is bounded: a run longer than MAX_CANDIDATE_LENGTH (twice the longest reply)
// is cut, and at most MAX_CANDIDATES runs are decoded per text. Pure code: the harness has no
// atob or TextDecoder (build plan rule 3).

/** The longest run decoded, in characters (longer runs are decoded up to this length). */
export const MAX_CANDIDATE_LENGTH = 16_384;
/** Runs decoded per text; the rest are ignored (a reply is capped at 8000 characters anyway). */
export const MAX_CANDIDATES = 256;
const MIN_CANDIDATE_LENGTH = 4;

const CANDIDATE = /[A-Za-z0-9+/_-]{2,}={0,2}/g;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const SIXBIT = new Map<string, number>([...ALPHABET].map((c, i) => [c, i]));
SIXBIT.set('-', 62);
SIXBIT.set('_', 63);
const MIN_CODE_POINT = [0, 0x80, 0x800, 0x10000];
/** A lower-case or Capitalised word: never decoded. */
const WORD_PART = /^[A-Z]?[a-z]*$/;

/** True when every hyphen- or underscore-separated part of the run is a plain word. */
export function wordLike(run: string): boolean {
  return run
    .replace(/=+$/, '')
    .split(/[-_]/)
    .every((p) => WORD_PART.test(p));
}

/** Printable: no control characters other than tab and newlines, no replacement character. */
function printable(text: string): boolean {
  for (const ch of text) {
    const c = ch.codePointAt(0) as number;
    if ((c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) || (c >= 0x7f && c <= 0x9f)) {
      return false;
    }
    if (c === 0xfffd) return false;
  }
  return true;
}

/** Base64 or base64url without padding, to bytes. */
function base64Bytes(body: string): number[] | undefined {
  const bytes: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const c of body) {
    const v = SIXBIT.get(c);
    if (v === undefined) return undefined;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 0xff);
    }
    acc &= (1 << bits) - 1;
  }
  return bytes;
}

/** Strict UTF-8 (no overlong forms, surrogates or values past U+10FFFF), else undefined. */
function utf8Text(bytes: readonly number[]): string | undefined {
  let out = '';
  for (let i = 0; i < bytes.length;) {
    const x = bytes[i] as number;
    let n: number;
    let cp: number;
    if (x < 0x80) [n, cp] = [0, x];
    else if (x >= 0xc2 && x <= 0xdf) [n, cp] = [1, x & 0x1f];
    else if (x >= 0xe0 && x <= 0xef) [n, cp] = [2, x & 0x0f];
    else if (x >= 0xf0 && x <= 0xf4) [n, cp] = [3, x & 0x07];
    else return undefined;
    for (let k = 1; k <= n; k++) {
      const y = bytes[i + k];
      if (y === undefined || (y & 0xc0) !== 0x80) return undefined;
      cp = (cp << 6) | (y & 0x3f);
    }
    if (cp < (MIN_CODE_POINT[n] as number) || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
      return undefined;
    }
    out += String.fromCodePoint(cp);
    i += n + 1;
  }
  return out;
}

/** One candidate's decoded text, or undefined when it is not base64 of printable UTF-8. */
export function decodeBase64Text(candidate: string): string | undefined {
  const body = candidate.replace(/=+$/, '');
  if (body.length < 2 || body.length % 4 === 1) return undefined;
  const bytes = base64Bytes(body);
  const text = bytes === undefined ? undefined : utf8Text(bytes);
  return text === undefined || text.trim() === '' || !printable(text) ? undefined : text;
}

/** The decoded text of every base64-looking run in `text` that decodes to printable UTF-8. */
export function decodedBase64Spans(text: string): string[] {
  const out: string[] = [];
  let tried = 0;
  for (const m of text.matchAll(CANDIDATE)) {
    if (tried >= MAX_CANDIDATES) break;
    const run = m[0].slice(0, MAX_CANDIDATE_LENGTH);
    if (run.length < MIN_CANDIDATE_LENGTH || wordLike(run)) continue;
    tried++;
    const decoded = decodeBase64Text(run);
    if (decoded !== undefined) out.push(decoded);
  }
  return out;
}
