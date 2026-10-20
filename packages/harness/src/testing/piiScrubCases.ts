// 4.2's piiScrub cases, shared (task 3.10): `guardrails/piiScrub.test.ts` runs them against the
// India test pack, and @edmate/content runs them against the real `content/locales/IN.yaml`
// through its loader, so the committed pack passes the same test. Fixture PII is fake (from the
// eval cases). Test names carry labels only, never the values.
import { cancelSource } from '../pipeline/clock.js';
import { PII_PLACEHOLDERS as P } from '../guardrails/piiPatterns.js';
import { createPiiScrubGuard, type PiiScrubCtx } from '../guardrails/piiScrub.js';

export interface PiiScrubCase {
  label: string;
  input: string;
  /** The matched literal: it must never appear in the guard's reason. */
  pii: string;
  /** The expected rewrite. */
  text: string;
  reason: string;
}

/** Each category with its matched literal (fake, from the eval cases) and expected rewrite. */
export const PII_SCRUB_CASES: readonly PiiScrubCase[] = Object.freeze([
  {
    label: 'phone',
    input: 'save my number 90000 11111 please',
    pii: '90000 11111',
    text: `save my number ${P.phone} please`,
    reason: 'redacted: phone',
  },
  {
    label: 'phone in Devanagari digits',
    input: 'मेरा नंबर ९०००० १२३४५ है',
    pii: '९०००० १२३४५',
    text: `मेरा नंबर ${P.phone} है`,
    reason: 'redacted: phone',
  },
  {
    label: 'email',
    input: 'mail aarav.student@example.com now',
    pii: 'aarav.student@example.com',
    text: `mail ${P.email} now`,
    reason: 'redacted: email',
  },
  {
    label: 'card',
    input: 'card 4111 1111 1111 1111 cvv 123',
    pii: '4111 1111 1111 1111',
    text: `card ${P.card} cvv ${P.card}`,
    reason: 'redacted: card',
  },
  {
    label: 'OTP-like',
    input: 'OTP aaya hai 615204',
    pii: '615204',
    text: `OTP aaya hai ${P.otp}`,
    reason: 'redacted: otp',
  },
  {
    label: 'own name',
    input: "Hi, I'm Aarav Mehta.",
    pii: 'Aarav',
    text: `Hi, I'm ${P.name} ${P.name}.`,
    reason: 'redacted: name',
  },
  {
    label: 'Aadhaar-like (locale)',
    input: 'aadhaar 1234 5678 9012 hai',
    pii: '1234 5678 9012',
    text: `aadhaar ${P.id} hai`,
    reason: 'redacted: id',
  },
  {
    label: 'PAN (locale)',
    input: 'my PAN is ABCDE1234F',
    pii: 'ABCDE1234F',
    text: `my PAN is ${P.id}`,
    reason: 'redacted: id',
  },
  {
    label: 'UPI id (locale)',
    input: 'UPI kabir.fake@exampleupi today',
    pii: 'kabir.fake',
    text: `UPI ${P.id} today`,
    reason: 'redacted: id',
  },
]);

/**
 * Runs every case through a fresh piiScrub guard with `ctx`, and the rewrite through it again.
 * Returns the label of each case that did not give exactly its expected rewrite and reason, or
 * whose rewrite was not clean on the second pass; empty when all pass. Labels only, never PII.
 */
export async function piiScrubCaseFailures(ctx: PiiScrubCtx): Promise<string[]> {
  const guard = createPiiScrubGuard();
  const token = cancelSource().token;
  const failed: string[] = [];
  for (const c of PII_SCRUB_CASES) {
    const { result } = await guard.run(c.input, ctx, token);
    const ok =
      !result.ok &&
      result.action === 'rewrite' &&
      result.text === c.text &&
      result.reason === c.reason;
    const again = ok ? (await guard.run(c.text, ctx, token)).result.ok : false;
    if (!again) failed.push(c.label);
  }
  return failed;
}
