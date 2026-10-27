// A narrow, top-level re-export of the locked-span matcher, outside `guardrails/**` on purpose
// (5.3a item 9): `@edmate/db`'s `retrieval.ts` only needs `lockedIndex`/`LockedIndex`, not the
// whole `@edmate/harness` barrel, and this file sits outside the `guardrails/**` risk-paths.txt
// glob so importing it does not pull in that risk group's reviewers.
export { lockedIndex, type LockedIndex } from './guardrails/lockedMatch.js';
