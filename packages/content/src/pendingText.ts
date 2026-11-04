// Shared "is this placeholder text, not a real answer yet" check (3.10a review follow-ups,
// item 3). One `isPending` used everywhere a placeholder field is checked: `localePacks.ts`,
// `localeRules.ts`, `privacyNotices.ts`, `rightsDeclaration.ts` all imported their own identical
// copy before this file existed.
//
// A value counts as pending when, after trimming ordinary whitespace and stripping invisible
// characters (a zero-width space left by a copy/paste mistake looks blank to a person but is not
// caught by `.trim() === ''` alone):
//   - it is empty ("blank-ish"), or
//   - it is the literal word "pending" or "tbd" (case-insensitive), or
//   - it is a one-edit typo of "pending" (a single insertion, deletion, substitution or
//     adjacent-letter swap -- "Pendingg", "Pendng", "Pedning").
// A real name, handle or longer sentence that merely contains "pending" as a substring (e.g.
// "pending review requested") is never within one edit of the whole word "pending" and is left
// alone: edit distance is at least the difference in length, so anything more than one character
// longer or shorter than "pending" is rejected before the (cheap, non-regex) edit-distance check
// even runs.
const INVISIBLE = /[​-‍﻿]/g;

const PENDING_WORD = 'pending';
const TBD_WORD = 'tbd';

function normalise(s: string): string {
  return s.replace(INVISIBLE, '').trim().toLowerCase();
}

/**
 * Damerau-Levenshtein edit distance (insertion, deletion, substitution, adjacent transposition)
 * between two short strings. Plain dynamic programming, not a regex: inputs here are at most a
 * handful of characters (placeholder words), so there is no catastrophic-backtracking concern and
 * no need to run this through the safe-regex guard.
 */
function damerauLevenshtein(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  // Flat (la + 1) x (lb + 1) matrix, row-major: every index used below is within
  // [0, (la + 1) * (lb + 1)), so `noUncheckedIndexedAccess`'s "possibly undefined" is a false
  // positive here -- `at()` with a fallback (never actually hit) keeps the code honest about that
  // without a non-null assertion.
  const width = lb + 1;
  const d = new Array<number>((la + 1) * width).fill(0);
  const at = (i: number, j: number): number => d.at(i * width + j) ?? 0;
  const set = (i: number, j: number, v: number): void => {
    d[i * width + j] = v;
  };
  for (let i = 0; i <= la; i++) set(i, 0, i);
  for (let j = 0; j <= lb; j++) set(0, j, j);
  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, at(i - 2, j - 2) + 1);
      }
      set(i, j, best);
    }
  }
  return at(la, lb);
}

/** True when `s` is placeholder text, not a real answer: see the header for exactly what counts. */
export function isPending(s: string): boolean {
  const n = normalise(s);
  if (n === '') return true;
  if (n === TBD_WORD || n === PENDING_WORD) return true;
  if (Math.abs(n.length - PENDING_WORD.length) > 1) return false;
  return damerauLevenshtein(n, PENDING_WORD) <= 1;
}
