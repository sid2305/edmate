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
  // Both sets are non-empty (guarded above) and `shared` can be at most the smaller set's size,
  // so `union` is always >= 1: there is no reachable zero-union case to branch on.
  const union = ta.size + tb.size - shared;
  return shared / union;
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
 *
 * Task 5.10b (review follow-up): `text` is tokenised once for the whole call, not once per
 * candidate (`questionSimilarity` and `sharedTermCount` each re-tokenise both of their arguments,
 * so calling both of them per candidate tokenised `text` twice per candidate). The score and
 * shared-term count below are the same formulas those two functions use, computed from one shared
 * `Set` of `text`'s terms.
 */
export function bestGroup(text: string, candidates: GroupCandidate[]): string | null {
  const ta = new Set(queryTerms(text));
  let best: { score: number; createdAt: number; id: string; groupId: string } | null = null;
  for (const c of candidates) {
    const tb = new Set(queryTerms(c.text));
    let shared = 0;
    for (const t of ta) if (tb.has(t)) shared += 1;
    if (shared < MIN_SHARED_TERMS) continue;
    // `shared >= MIN_SHARED_TERMS` (2) already means both `ta` and `tb` are non-empty (`shared`
    // can't exceed either set's size), so there is no reachable zero-set case to branch on here
    // (fix round, task 5.10b review follow-up).
    const score = shared / (ta.size + tb.size - shared);
    if (score < QUESTION_GROUP_MIN) continue;
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

/** One flat question `clusterQuestions` clusters (task 11.2a: the student pre-class feed). */
export interface ClusterableQuestion {
  id: string;
  text: string;
  createdAt: Date | string;
}

/** One cluster `clusterQuestions` returns: a group id and the member ids that joined it. */
export interface QuestionCluster {
  groupId: string;
  ids: string[];
}

/**
 * Greedily clusters a flat list of questions by the same lexical similarity `bestGroup` uses
 * (Jaccard ≥ `QUESTION_GROUP_MIN`, at least two shared terms), without any pre-existing group id —
 * unlike `bestGroup`, which joins a new question to a caller-filtered candidate set one at a time
 * inside a transaction, this clusters a whole list at once, in memory, for a read-only queue
 * (task 11.2a, `class-questions.ts`'s `listQueueForTeacher`). Input order does not matter: items
 * are sorted oldest-first (then by id) before clustering, so the result is deterministic. Each
 * cluster's `groupId` is its oldest member's id. Clusters are returned biggest first, ties to the
 * oldest member; `[]` for an empty input.
 */
export function clusterQuestions(questions: ClusterableQuestion[]): QuestionCluster[] {
  const sorted = [...questions].sort((a, b) => {
    const at = new Date(a.createdAt).getTime();
    const bt = new Date(b.createdAt).getTime();
    // Ids are always unique (no equal-id case), so a plain two-way tie-break is enough.
    return at - bt || (a.id < b.id ? -1 : 1);
  });

  const groups: { groupId: string; members: typeof sorted }[] = [];
  for (const q of sorted) {
    let best: { index: number; score: number } | null = null;
    for (let i = 0; i < groups.length; i++) {
      // Compared against the group's oldest (first) member, the same representative `bestGroup`
      // would see as a caller-filtered candidate.
      const rep = groups[i]!.members[0]!;
      const score = questionSimilarity(q.text, rep.text);
      if (score < QUESTION_GROUP_MIN) continue;
      if (sharedTermCount(q.text, rep.text) < MIN_SHARED_TERMS) continue;
      if (best === null || score > best.score) best = { index: i, score };
    }
    if (best === null) {
      groups.push({ groupId: q.id, members: [q] });
    } else {
      groups[best.index]!.members.push(q);
    }
  }

  return groups
    .map((g) => ({
      groupId: g.groupId,
      ids: g.members.map((m) => m.id),
      oldestAt: new Date(g.members[0]!.createdAt).getTime(),
    }))
    .sort((a, b) => {
      if (b.ids.length !== a.ids.length) return b.ids.length - a.ids.length;
      if (a.oldestAt !== b.oldestAt) return a.oldestAt - b.oldestAt;
      // Group ids are always unique (each is a distinct member's own id).
      return a.groupId < b.groupId ? -1 : 1;
    })
    .map(({ groupId, ids }) => ({ groupId, ids }));
}
