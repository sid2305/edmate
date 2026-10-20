import { z } from 'zod';
import { count, currencyCode, date, market, signer } from './formats.js';
import { LIMITS } from './limits.js';
import { LangSchema } from './shared.js';

/** True when `source` is a valid JavaScript regular expression. */
function compiles(source: string): boolean {
  try {
    new RegExp(source);
    return true;
  } catch {
    return false;
  }
}

export const LocalePackSchema = z
  .strictObject({
    market: market(),
    languages: z.array(LangSchema),
    /** IANA time zone, for example `Asia/Kolkata`. */
    timezone: z.string(),
    currency: z.strictObject({ code: currencyCode(), format: z.string() }),
    payments: z.strictObject({ methods: z.array(z.string()), provider: z.string() }),
    helplines: z.array(
      z.strictObject({
        name: z.string(),
        number: z.string(),
        kind: z.string(),
        /** Who checked the line; the literal `pending` until a person has (ADR-0008). */
        verifiedBy: signer(),
        verifiedOn: date(),
      }),
    ),
    compliance: z.strictObject({
      privacyLaw: z.string(),
      minAge: count(),
      dataRegion: z.string(),
      grievance: z.string(),
      /** Learners under 18 need verifiable parental consent in this market (ADR-0008). */
      parentalConsentRequired: z.boolean(),
    }),
    /** Sign-off for the compliance block, both or neither (ADR-0008). */
    reviewedBy: signer().exactOptional(),
    reviewedOn: date().exactOptional(),
    regulatedDisclaimers: z.partialRecord(z.enum(['investing', 'health', 'law']), z.string()),
    piiPatterns: z.array(
      z
        .string()
        .max(LIMITS.piiPatternMaxLength)
        .refine(compiles, 'must be a valid regular expression'),
    ),
  })
  .superRefine((p, ctx) => {
    if (p.reviewedBy !== undefined && p.reviewedOn === undefined) {
      ctx.addIssue({ code: 'custom', path: ['reviewedOn'], message: 'required with reviewedBy' });
    }
    if (p.reviewedOn !== undefined && p.reviewedBy === undefined) {
      ctx.addIssue({ code: 'custom', path: ['reviewedBy'], message: 'required with reviewedOn' });
    }
  });
export type LocalePack = z.infer<typeof LocalePackSchema>;
