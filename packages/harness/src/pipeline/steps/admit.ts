// Step 1, admit (build plan § Turn pipeline spec): input limits, then the rate limit. No model call.
// Authentication is the caller's: the web route or CLI authenticates and merges `studentId` into
// the input before `runTurn` (contracts comment on TurnInputSchema); `unauthorized` stays there.
// admit does not full-parse TurnInput: fields the pipeline does not read (for example a smuggled
// package id) are ignored here and rejected by the boundary's strict parse.
import { countChars, LIMITS, type TurnInput } from '@edmate/contracts';
import { TurnRejection } from '../errors.js';
import { RATE_LIMIT_TURNS } from '../spec.js';
import type { Steps } from '../types.js';

/** JSON length of a skill payload, or Infinity when it cannot be serialised (cycles, BigInt). */
function jsonLength(value: unknown): number {
  try {
    return (JSON.stringify(value) ?? '').length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Throws `input_too_large` for input over the contracts' limits, `validation` for a field of the
 * wrong type (callers such as the CLI and eval runner may pass an unparsed object).
 */
export function checkInputLimits(input: TurnInput): void {
  const { text, attachments, skillPayload } = input as {
    text?: unknown;
    attachments?: unknown;
    skillPayload?: unknown;
  };
  if (text !== undefined) {
    if (typeof text !== 'string') throw new TurnRejection('validation', false);
    // The cheap UTF-16 cap first, so a huge string is never spread into code points.
    if (text.length > LIMITS.turnTextMaxLength || countChars(text) > LIMITS.turnTextMaxChars) {
      throw new TurnRejection('input_too_large', false);
    }
  }
  if (attachments !== undefined) {
    if (!Array.isArray(attachments)) throw new TurnRejection('validation', false);
    if (attachments.length > LIMITS.turnAttachmentsMax) {
      throw new TurnRejection('input_too_large', false);
    }
  }
  if (skillPayload !== undefined && jsonLength(skillPayload) > LIMITS.skillPayloadMaxJsonLength) {
    throw new TurnRejection('input_too_large', false);
  }
}

export const admit: Steps['admit'] = async ({ input, deps }) => {
  checkInputLimits(input);
  // Lead answer Q3: the rate limit applies to every source except eval. Only admitted turns count.
  if (deps.entitlementSource === 'eval') return;
  if (!(await deps.limits.rate.tryTake(input.studentId, RATE_LIMIT_TURNS))) {
    throw new TurnRejection('rate_limited', true);
  }
};
