// Mistake tagging from the teacher's list, plus proposed tags the teacher approves (build plan
// line 444): "tags from the teacher's list of common mistakes, plus auto-proposed tags the
// teacher approves; never a tag outside the list." Task 6.3; see docs/tasks/6.3/plan.md.
//
// Pure, synchronous, dependency-free (no ModelGateway, no I/O) -- same shape as topicMap.ts. The
// "teacher's list" this checks against is the style card's versioned `mistakeTags` (the only
// runtime-queryable source today -- see the plan's Q1), supplied by the caller as `allowedTags`.
import type { LearnerProfile } from '@edmate/contracts';

/** A candidate mistake tag observed in a turn, not yet classified. */
export interface MistakeTagCandidate {
  tag: string;
  ts: string;
}

/** A tag not on the teacher's list, aggregated the same way `known` is, pending approval. */
export interface ProposedMistakeTag {
  tag: string;
  count: number;
  lastSeen: string;
}

export interface MistakeTagClassification {
  known: LearnerProfile['mistakes'];
  proposed: ProposedMistakeTag[];
}

/**
 * Dedupes/aggregates `candidates` by exact tag string (count occurrences, latest `ts` as
 * `lastSeen` -- the later one by string comparison, which is correct for ISO 8601 timestamps),
 * then splits strictly on membership in `allowedTags` (exact string match, case-sensitive; no
 * fuzzy matching, no normalisation). `known` entries are shaped exactly as
 * `LearnerProfileSchema.mistakes` elements so they can be merged straight into a profile via
 * `learnerProfilesRepo.applyMistakes`; `proposed` entries are tags seen but not on the teacher's
 * list -- returned for the caller to log/inspect, never written anywhere by this function (it is
 * pure) and never promoted to `known`.
 *
 * Invariant this exists to guarantee: every tag in `known` is a member of `allowedTags`; every
 * candidate tag not in `allowedTags` lands only in `proposed`, never in `known` -- holds for any
 * input, including the empty string, unicode, very long strings and duplicates.
 */
export function classifyMistakeTags(
  candidates: readonly MistakeTagCandidate[],
  allowedTags: readonly string[],
): MistakeTagClassification {
  const allowed = new Set(allowedTags);
  const aggregated = new Map<string, { count: number; lastSeen: string }>();
  for (const { tag, ts } of candidates) {
    const existing = aggregated.get(tag);
    if (existing) {
      existing.count += 1;
      if (ts > existing.lastSeen) existing.lastSeen = ts;
    } else {
      aggregated.set(tag, { count: 1, lastSeen: ts });
    }
  }

  const known: LearnerProfile['mistakes'] = [];
  const proposed: ProposedMistakeTag[] = [];
  for (const [tag, { count, lastSeen }] of aggregated) {
    if (allowed.has(tag)) {
      known.push({ tag, count, lastSeen });
    } else {
      proposed.push({ tag, count, lastSeen });
    }
  }
  return { known, proposed };
}
