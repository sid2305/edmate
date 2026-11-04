// Shared "this looks like an email address" check (3.10a review follow-ups, item 5). Used
// wherever a reviewer / reviewedBy sign-off field must reject one: the repo is public, so a
// person's email address must never land in a committed file where it could be scraped.
//
// The plain `/\S@\S+\.\S/` regex each call site used before this file existed missed two
// bypasses:
//   - a fullwidth full stop (U+FF0E, "．") or an ideographic full stop (U+3002, "。") standing in
//     for the ASCII "." in the domain -- visually indistinguishable to a reviewer skimming a diff;
//   - the whole address spelled out in words ("jane at example dot com") with no literal "@" at
//     all.
// A name that merely contains the letters "at" mid-word (e.g. "Natasha") is not a false positive:
// the spelled-out check requires "at" as its own word (flanked by non-word characters), with a
// "dot" appearing later as its own word too.
const DOT_CLASS = '[.。．]';
const LITERAL_EMAIL = new RegExp(`\\S@\\S+${DOT_CLASS}\\S`, 'u');
const SPELLED_OUT_EMAIL = /\bat\b.*\bdot\b/iu;

/** True when `s` looks like an email address, literally or spelled out in words. */
export function looksLikeEmail(s: string): boolean {
  return LITERAL_EMAIL.test(s) || SPELLED_OUT_EMAIL.test(s);
}
