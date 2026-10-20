// The age rule for a market, read from its locale pack (task 1.7, plan Design 3). It fails closed:
//   - the minimum age is never below the platform floor of 13 (board decision `min-age`,
//     18 Oct 2026); a malformed minimum reads as the floor;
//   - consent is required unless the pack says `parentalConsentRequired: false` AND its compliance
//     block is signed by a person (`reviewedBy` set and not `pending`). An unsigned pack can never
//     relax consent.
// "Consent" here is ADR-0008's meaning of `parentalConsentRequired`: learners under 18 need
// verifiable parental consent. The 18 itself lives with the age rules in @edmate/db
// (`CONSENT_AGE`). The returned shape matches @edmate/db's `AgePolicy`, which a composition root
// injects into the identity store; this package does not depend on @edmate/db.
import type { LocalePack } from '@edmate/contracts';
import { DEFAULT_LOCALE_MARKET, type LocalePacks } from './localeRules.js';

/** The youngest age anyone may hold an account at, in any market (same value as @edmate/db's). */
export const PLATFORM_MIN_AGE = 13;

export interface PackAgePolicy {
  /** The youngest age allowed an account in this market; never below `PLATFORM_MIN_AGE`. */
  minAge: number;
  /** Learners under 18 need verifiable parental consent before using the agent (ADR-0008). */
  consentRequired: boolean;
}

/** The safe default: the floor, and consent required. */
export const DEFAULT_AGE_POLICY: Readonly<PackAgePolicy> = Object.freeze({
  minAge: PLATFORM_MIN_AGE,
  consentRequired: true,
});

/** True when a person has signed the pack's compliance block (`reviewedBy` set, not `pending`). */
export function complianceSigned(pack: LocalePack): boolean {
  return pack.reviewedBy !== undefined && pack.reviewedBy.trim().toLowerCase() !== 'pending';
}

function floored(minAge: number): number {
  return Number.isSafeInteger(minAge) && minAge > PLATFORM_MIN_AGE ? minAge : PLATFORM_MIN_AGE;
}

/** The age rule `pack` sets, failing closed (see the header). */
export function agePolicyFor(pack: LocalePack): PackAgePolicy {
  const waived = pack.compliance.parentalConsentRequired === false && complianceSigned(pack);
  return { minAge: floored(pack.compliance.minAge), consentRequired: !waived };
}

/**
 * `(market) => policy` over `packs` (as served by `loadLocalePacks`): a market's own pack, else
 * the default pack, else (no packs at all) `DEFAULT_AGE_POLICY`. Never throws.
 */
export function agePolicyResolver(packs: LocalePacks): (market: string) => PackAgePolicy {
  return (market) => {
    const pack = packs.get(market) ?? packs.get(DEFAULT_LOCALE_MARKET);
    return pack === undefined ? { ...DEFAULT_AGE_POLICY } : agePolicyFor(pack);
  };
}
