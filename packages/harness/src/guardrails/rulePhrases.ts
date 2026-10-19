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

/**
 * A rule hit (4.4 fix round, safety HIGH 1). `decisive`: specific enough to block on its own,
 * with no model call, and to record a safety event. Ambiguous: the message is only flagged and
 * the classifier decides; if the classifier fails the turn still fails closed, but no event is
 * written.
 */
export interface RuleHit<C extends string> {
  code: C;
  decisive: boolean;
}

/** One table row. `also`: another phrase the same text must hold. `unless`: an exemption. */
export interface Rule<C extends string> {
  code: C;
  re: RegExp;
  decisive: boolean;
  also?: RegExp;
  unless?: RegExp;
}

export const ruleFor =
  <C extends string>(decisive: boolean) =>
  (code: C, src: string, more: { also?: string; unless?: string } = {}): Rule<C> => ({
    code,
    re: phrase(src),
    decisive,
    ...(more.also === undefined ? {} : { also: phrase(more.also) }),
    ...(more.unless === undefined ? {} : { unless: phrase(more.unless) }),
  });

export const ruleMatches = <C extends string>(r: Rule<C>, form: string): boolean =>
  r.re.test(form) &&
  (r.also === undefined || r.also.test(form)) &&
  (r.unless === undefined || !r.unless.test(form));

/** The first rule (table order) that hits any of `forms`, decisive rules first. */
export function firstRuleHit<C extends string>(
  rules: readonly Rule<C>[],
  forms: readonly string[],
): RuleHit<C> | null {
  for (const decisive of [true, false]) {
    for (const r of rules) {
      if (r.decisive === decisive && forms.some((f) => ruleMatches(r, f))) {
        return { code: r.code, decisive };
      }
    }
  }
  return null;
}

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
