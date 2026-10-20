// Task 1.7: the age rule from a birth year (pure; no I/O). See README.md rule 12.

/** No learner under 13 has an account, whatever a market's pack says (board decision min-age). */
export const PLATFORM_MIN_AGE = 13;

/**
 * Below this age a market that requires consent needs a parent's: ADR-0008 defines the locale
 * pack's `parentalConsentRequired` as applying to "learners under 18". Not a law hard-coded here.
 */
export const CONSENT_AGE = 18;

/** One market's rule, injected into the identity store (Phase B derives it from the pack). */
export interface AgePolicy {
  minAge: number;
  consentRequired: boolean;
}

/** The rule when a market has no signed pack: 13+, and consent needed for 13-17. */
export const DEFAULT_AGE_POLICY: Readonly<AgePolicy> = Object.freeze({
  minAge: PLATFORM_MIN_AGE,
  consentRequired: true,
});

/**
 * A learner's standing: no answer yet, waiting for a parent, free to use the agent, or blocked
 * forever (`under_age`, fix round 1 of 1.7: `age_blocked_at` is set because an under-13 erase was
 * blocked by a row the store does not own; staff resolve it, 12.1).
 */
export type AgeStatus = 'age_needed' | 'parent_needed' | 'clear' | 'under_age';

/**
 * The outcome of an age answer: `under_age` erased the account; `erase_blocked` (fix round 1)
 * means the same under-13 answer but the erase was blocked by a row the store does not own, so
 * the account stays, marked `age_blocked_at` instead.
 */
export type AgeAnswerStatus = 'under_age' | 'parent_needed' | 'clear' | 'erase_blocked';

/**
 * The youngest age someone born in `birthYear` can be at `now` (UTC): the year of birth counts
 * as not yet had a birthday (plan Q3 (a)), so no further data is needed.
 */
export function youngestAge(birthYear: number, now: Date): number {
  return now.getUTCFullYear() - birthYear - 1;
}

/**
 * Fails closed: the minimum is never below 13, and only an explicit `consentRequired: false`
 * waives parental consent. A minimum that is not finite or is above `CONSENT_AGE` is a broken
 * policy: it throws, so the caller fails and the learner stays blocked; it never erases anyone.
 */
function minAgeOf(policy: AgePolicy): number {
  const { minAge } = policy;
  if (!Number.isFinite(minAge) || minAge > CONSENT_AGE) {
    throw new Error('age policy: bad minAge');
  }
  return minAge > PLATFORM_MIN_AGE ? minAge : PLATFORM_MIN_AGE;
}

export interface AgeInput {
  birthYear: number | null;
  policy: AgePolicy;
  /** A live (not withdrawn) parental consent is on record. */
  parentConsent: boolean;
  now: Date;
}

/**
 * With a birth year the answer is never `age_needed` (runtime-guaranteed by the `birthYear === null`
 * check below, not provable from the types alone).
 */
export function ageStatus(input: AgeInput & { birthYear: number }): Exclude<AgeStatus, 'age_needed'>;
export function ageStatus(input: AgeInput): AgeStatus;
export function ageStatus(input: AgeInput): AgeStatus {
  const { birthYear, policy, parentConsent, now } = input;
  if (birthYear === null) return 'age_needed';
  const age = youngestAge(birthYear, now);
  if (age < minAgeOf(policy)) return 'under_age';
  const consentRequired = policy.consentRequired !== false;
  if (age < CONSENT_AGE && consentRequired && !parentConsent) return 'parent_needed';
  return 'clear';
}
