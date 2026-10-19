// Shared helpers for the moderationIn and jailbreak rule tables (task 4.4). The text is
// normalised by 4.3's normaliser (`normaliseForDistress`, lead answer 10: reused, not copied),
// which gives lower-case, single-spaced forms with punctuation read as spaces, apostrophes
// dropped ("i'm" → "im"), leetspeak folded and nukta removed (Devanagari "ज़" → "ज").
import { normaliseForDistress } from './distressKeywords.js';
import { textVariants } from './decodeAttempts.js';

/** A phrase that is not part of a longer word (letters, marks and digits on either side). */
export const phrase = (src: string): RegExp =>
  new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])(?:${src})(?![\\p{L}\\p{M}\\p{N}])`, 'u');

/** Up to `n` whole words between two parts of a phrase (normalised text is single-spaced). */
export const gap = (n: number): string => `(?: \\S+){0,${n}}`;

/** Aimed at the self (lead answer 1): "myself", "khud ko", "apne aap ko", "खुद को". */
export const SELF = '(?:my ?self|me ?self)';

/** The normalised forms of one text. */
export const formsOf = (text: string): string[] => normaliseForDistress(text);

/** Whether any rule-relevant text (one of `forms`) matches `re`. */
export const anyForm = (forms: readonly string[], re: RegExp): boolean =>
  forms.some((f) => re.test(f));

export interface ScanTexts {
  /** The message as written, and its normalised forms. */
  raw: string;
  forms: string[];
  /** Decoded payloads and the ROT13 and backwards readings: each raw, with its forms. */
  hidden: { raw: string; forms: string[] }[];
}

/** The message and everything an encoding may hide in it, ready for the rule tables. */
export function scanTexts(text: string): ScanTexts {
  const v = textVariants(text);
  const hidden = [...v.decoded, v.rot13, v.reversed]
    .filter((h) => h !== text)
    .map((raw) => ({ raw, forms: formsOf(raw) }));
  return { raw: text, forms: formsOf(text), hidden };
}
