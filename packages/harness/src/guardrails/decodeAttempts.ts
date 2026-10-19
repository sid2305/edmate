// Encoded payloads (task 4.4, lead answer 5). moderationIn and jailbreak match their rule tables
// against the message as written and against what an encoding hides in it:
//
// - runs of 16 or more base64 characters (standard or URL-safe, padding optional), runs of hex
//   (plain, `\x41` escapes, or bytes split by spaces or colons) and URL encoding (`%20`), decoded
//   at most DECODE_MAX_LEVELS levels deep (base64 of base64 is read; a third level is not);
// - the whole message read as ROT13 and read backwards (cheap and always tried).
//
// A decode counts only when it is valid UTF-8 and reads as text (letters, no control characters),
// so an identifier or a long number never turns into a false payload. Input and output are capped
// (DECODE_INPUT_MAX, DECODE_OUTPUT_MAX, DECODE_MAX_PAYLOADS), so a huge payload costs little.
// Pure: no Buffer, no atob (the harness has no Node or DOM types).

/** Characters of the message looked at for payloads (TurnInput text is at most 4,000). */
export const DECODE_INPUT_MAX = 8_000;
/** A decoded payload is cut to this many code points. */
export const DECODE_OUTPUT_MAX = 2_000;
/** Payloads kept per level. */
export const DECODE_MAX_PAYLOADS = 8;
/** Levels of decoding (lead answer 5: at most 2). */
export const DECODE_MAX_LEVELS = 2;
/** The shortest base64 or hex run that is decoded (lead answer 5). */
const MIN_RUN = 16;

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_VALUE: ReadonlyMap<string, number> = new Map(
  [...B64_ALPHABET].map((c, i) => [c, i] as const),
);

const B64_RUN = new RegExp(`[A-Za-z0-9+/_-]{${MIN_RUN},}={0,2}`, 'g');
const HEX_RUN = new RegExp(`(?<![0-9A-Fa-f])(?:[0-9A-Fa-f]{2}){${MIN_RUN / 2},}(?![0-9A-Fa-f])`, 'g');
const HEX_ESCAPES = /(?:\\x[0-9A-Fa-f]{2}){4,}/g;
const HEX_SPACED = /(?<![0-9A-Fa-f])(?:[0-9A-Fa-f]{2}[ :]){7,}[0-9A-Fa-f]{2}(?![0-9A-Fa-f])/g;
const URL_ESCAPE = /%[0-9A-Fa-f]{2}/g;
const URL_RUN = /(?:%[0-9A-Fa-f]{2})+/g;

/** Base64 (standard or URL-safe, padding optional) to bytes, or null when it can't be base64. */
function base64Bytes(run: string): number[] | null {
  const s = run.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
  if (s.length % 4 === 1) return null;
  const bytes: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const c of s) {
    // B64_RUN only matches alphabet characters ('-' and '_' are mapped above, '=' stripped).
    const v = B64_VALUE.get(c) as number;
    acc = ((acc << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 0xff);
    }
  }
  return bytes;
}

function hexBytes(hex: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i + 1 < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
  return bytes;
}

/** Strict UTF-8 decoding: null on any malformed, overlong or surrogate sequence. */
export function utf8(bytes: readonly number[]): string | null {
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i] as number;
    let need: number;
    let cp: number;
    let min: number;
    if (b < 0x80) {
      out += String.fromCodePoint(b);
      i++;
      continue;
    } else if (b >= 0xc2 && b <= 0xdf) {
      need = 1;
      cp = b & 0x1f;
      min = 0x80;
    } else if (b >= 0xe0 && b <= 0xef) {
      need = 2;
      cp = b & 0x0f;
      min = 0x800;
    } else if (b >= 0xf0 && b <= 0xf4) {
      need = 3;
      cp = b & 0x07;
      min = 0x10000;
    } else {
      return null;
    }
    for (let k = 1; k <= need; k++) {
      const c = bytes[i + k];
      if (c === undefined || (c & 0xc0) !== 0x80) return null;
      cp = (cp << 6) | (c & 0x3f);
    }
    if (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return null;
    out += String.fromCodePoint(cp);
    i += need + 1;
  }
  return out;
}

/** Control characters other than tab and newlines, and the replacement character. */
const CONTROL = /(?![\t\n\r])[\p{Cc}\u{FFFD}]/u;
const READABLE = /[\p{L}\p{M}\p{N}\p{Zs}\p{P}\p{S}\n\r\t]/u;

/** A decode is kept only when it reads as text: no control characters, mostly readable, a letter. */
function asText(bytes: readonly number[] | null): string | null {
  if (bytes === null || bytes.length < 4) return null;
  const s = utf8(bytes);
  if (s === null || CONTROL.test(s) || !/\p{L}/u.test(s)) return null;
  const chars = Array.from(s);
  const readable = chars.filter((c) => READABLE.test(c)).length;
  if (readable / chars.length < 0.9) return null;
  // Mostly letters and spaces: binary noise that happens to be valid UTF-8 is full of symbols.
  const wordy = chars.filter((c) => /[\p{L}\p{M}\p{N}\s]/u.test(c)).length;
  if (wordy / chars.length < 0.6) return null;
  return chars.slice(0, DECODE_OUTPUT_MAX).join('');
}

/** URL escapes decoded run by run; a malformed run is left as it is. Null when nothing changed. */
function urlDecoded(text: string): string | null {
  if ((text.match(URL_ESCAPE)?.length ?? 0) < 3) return null;
  const out = text.replace(URL_RUN, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
  if (out === text || CONTROL.test(out)) return null;
  return Array.from(out).slice(0, DECODE_OUTPUT_MAX).join('');
}

/** One level: every payload `text` holds, decoded, deduplicated, at most DECODE_MAX_PAYLOADS. */
function decodeOnce(text: string): string[] {
  const t = text.slice(0, DECODE_INPUT_MAX);
  const found = new Set<string>();
  const add = (s: string | null) => {
    if (s !== null && s !== t && found.size < DECODE_MAX_PAYLOADS) found.add(s);
  };
  for (const m of t.matchAll(HEX_ESCAPES)) add(asText(hexBytes(m[0].replace(/\\x/g, ''))));
  for (const m of t.matchAll(HEX_SPACED)) add(asText(hexBytes(m[0].replace(/[ :]/g, ''))));
  for (const m of t.matchAll(HEX_RUN)) add(asText(hexBytes(m[0])));
  for (const m of t.matchAll(B64_RUN)) add(asText(base64Bytes(m[0])));
  add(urlDecoded(t));
  return [...found];
}

/** Every payload hidden in `text`, decoded up to DECODE_MAX_LEVELS levels deep. */
export function decodeEncodedPayloads(text: string): string[] {
  const all: string[] = [];
  let level = [text];
  for (let depth = 0; depth < DECODE_MAX_LEVELS; depth++) {
    const next: string[] = [];
    for (const t of level) {
      for (const d of decodeOnce(t)) {
        if (next.length < DECODE_MAX_PAYLOADS && !all.includes(d) && !next.includes(d)) {
          next.push(d);
        }
      }
    }
    all.push(...next);
    level = next;
  }
  return all;
}

/** ROT13 on Latin letters; everything else stays. */
export function rot13(text: string): string {
  return text.replace(/[A-Za-z]/g, (c) => {
    const base = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
}

/** The text backwards, by code point. */
export function reverseText(text: string): string {
  return Array.from(text).reverse().join('');
}

export interface TextVariants {
  /** Decoded payloads (base64, hex, URL encoding), at most two levels deep. */
  decoded: string[];
  rot13: string;
  reversed: string;
}

/** What the rule tables read besides the message itself. */
export function textVariants(text: string): TextVariants {
  const t = text.slice(0, DECODE_INPUT_MAX);
  return { decoded: decodeEncodedPayloads(t), rot13: rot13(t), reversed: reverseText(t) };
}
