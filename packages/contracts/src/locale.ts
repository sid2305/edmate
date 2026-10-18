import { z } from 'zod';
import { count, currencyCode, market } from './formats.js';
import { LIMITS } from './limits.js';

/** True when `source` is a valid JavaScript regular expression. */
function compiles(source: string): boolean {
  try {
    new RegExp(source);
    return true;
  } catch {
    return false;
  }
}
import { LangSchema } from './shared.js';

export const LocalePackSchema = z.strictObject({
  market: market(),
  languages: z.array(LangSchema),
  /** IANA time zone, for example `Asia/Kolkata`. */
  timezone: z.string(),
  currency: z.strictObject({ code: currencyCode(), format: z.string() }),
  payments: z.strictObject({ methods: z.array(z.string()), provider: z.string() }),
  helplines: z.array(z.strictObject({ name: z.string(), number: z.string(), kind: z.string() })),
  compliance: z.strictObject({
    privacyLaw: z.string(),
    minAge: count(),
    dataRegion: z.string(),
    grievance: z.string(),
  }),
  regulatedDisclaimers: z.partialRecord(z.enum(['investing', 'health', 'law']), z.string()),
  piiPatterns: z.array(
    z
      .string()
      .max(LIMITS.piiPatternMaxLength)
      .refine(compiles, 'must be a valid regular expression'),
  ),
});
export type LocalePack = z.infer<typeof LocalePackSchema>;
