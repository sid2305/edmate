// Task 5.10 (build plan § Ask the teacher 2, Q1): lexical grouping of open questions inside
// `teacherQuestions.open`'s own transaction. Pure, so it is covered by a plain unit test and
// never touches the database itself.
import { queryTerms } from './retrieval.js';

/** A question grouped at or above this Jaccard index, and sharing at least two terms, joins it. */
export const QUESTION_GROUP_MIN = 0.5;
/** The fewest shared terms two questions must have, even at a high Jaccard index. */
const MIN_SHARED_TERMS = 2;

/** The Jaccard index of `a` and `b`'s distinct full-text terms (0 when either has none). */
export function questionSimilarity(a: string, b: string): number {
  const ta = new Set(queryTerms(a));
  const tb = new Set(queryTerms(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  const union = ta.size + tb.size - shared;
  return union === 0 ? 0 : shared / union;
}

/** The two questions' shared distinct full-text term count. */
function sharedTermCount(a: string, b: string): number {
  const ta = new Set(queryTerms(a));
  const tb = new Set(queryTerms(b));
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared;
}

/** One open question `open`'s transaction reads as a grouping candidate. */
export interface GroupCandidate {
  id: string;
  text: string;
  groupId: string | null;
  createdAt: Date | string;
}

/**
 * The group id `text` should join among `candidates`, or `null` when none matches (the caller
 * then uses the new question's own id as its group). A candidate's effective group is its own
 * `groupId`, or its own `id` when that is still null (a pre-migration-0018 row, or one from a
 * fixture that never goes through `open`). Ties on the Jaccard index go to the oldest candidate
 * (earliest `createdAt`, then the lowest id).
 */
export function bestGroup(text: string, candidates: GroupCandidate[]): string | null {
  let best: { score: number; createdAt: number; id: string; groupId: string } | null = null;
  for (const c of candidates) {
    const score = questionSimilarity(text, c.text);
    if (score < QUESTION_GROUP_MIN) continue;
    if (sharedTermCount(text, c.text) < MIN_SHARED_TERMS) continue;
    const createdAt = new Date(c.createdAt).getTime();
    const groupId = c.groupId ?? c.id;
    if (
      best === null ||
      score > best.score ||
      (score === best.score &&
        (createdAt < best.createdAt || (createdAt === best.createdAt && c.id < best.id)))
    ) {
      best = { score, createdAt, id: c.id, groupId };
    }
  }
  return best === null ? null : best.groupId;
}
