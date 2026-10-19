// Bayesian Knowledge Tracing (BKT), pure (task 3.17, build plan §435 defaults). No DB, no I/O:
// `learnerProfilesRepo.applyMastery` (learner.ts) is the only caller. `packages/db` does not need
// mathjs for this (rule 3 in CLAUDE.md only restricts `packages/harness`'s imports).
import type { LearnerProfile } from '@edmate/contracts';

/** Prior-knowledge, learning, slip and guess probabilities. */
export interface BktParams {
  pInit: number;
  pLearn: number;
  pSlip: number;
  pGuess: number;
}

/** build plan §435's defaults. */
export const BKT_DEFAULTS: BktParams = { pInit: 0.2, pLearn: 0.15, pSlip: 0.1, pGuess: 0.2 };

/** One topic's mastery entry, as stored on `LearnerProfile.mastery[topicId]`. */
export type MasteryEntry = LearnerProfile['mastery'][string];

function clamp01(p: number): number {
  if (!Number.isFinite(p)) return BKT_DEFAULTS.pInit;
  return Math.min(1, Math.max(0, p));
}

/**
 * One BKT update: the posterior given the observation (`correct`), then the learning transition.
 * `prior` is the topic's existing entry, or absent for a topic never scored before (starts at
 * `k.pInit`, `n: 0`). `ts` becomes the new entry's `updatedAt` — the evidence event's own
 * *original* timestamp (never the time it was processed), so replaying the same event through
 * `applyMastery` twice (the one it was actually applied to, and a no-op skip the second time)
 * never changes `updatedAt` out from under a dedup check. Deterministic and side-effect free, so
 * the same (prior, correct, ts) always yields the same entry — the idempotency this task needs.
 */
export function applyBkt(
  prior: MasteryEntry | undefined,
  correct: boolean,
  ts: string,
  k: BktParams = BKT_DEFAULTS,
): MasteryEntry {
  const pBefore = prior?.p ?? k.pInit;
  const n = (prior?.n ?? 0) + 1;
  const pObs = correct
    ? (pBefore * (1 - k.pSlip)) / (pBefore * (1 - k.pSlip) + (1 - pBefore) * k.pGuess)
    : (pBefore * k.pSlip) / (pBefore * k.pSlip + (1 - pBefore) * (1 - k.pGuess));
  const p = pObs + (1 - pObs) * k.pLearn;
  return { p: clamp01(p), n, updatedAt: ts };
}

/**
 * Folds a batch of (already deduplicated, already topic-scoped) evidence events into a mastery
 * map, applying each topic's events in the order given. `weight` is carried on `EvidenceEvent` but
 * not read here: no spec yet says how it should bend the BKT update (decision logged, medium,
 * reversible — see docs/tasks/3.17/handoff.md). Pure: callers merge the result into storage.
 */
export function foldMastery(
  mastery: LearnerProfile['mastery'],
  events: readonly { topicId: string; correct: boolean; ts: string }[],
  k: BktParams = BKT_DEFAULTS,
): LearnerProfile['mastery'] {
  const next: LearnerProfile['mastery'] = { ...mastery };
  for (const e of events) {
    next[e.topicId] = applyBkt(next[e.topicId], e.correct, e.ts, k);
  }
  return next;
}
