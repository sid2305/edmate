import { z } from 'zod';
import { count, currencyCode, market } from './formats.js';
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
  piiPatterns: z.array(z.string()),
});
export type LocalePack = z.infer<typeof LocalePackSchema>;
