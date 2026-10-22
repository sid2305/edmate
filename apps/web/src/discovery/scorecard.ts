// Task 9.2 Phase C: the public projection of a stored 7.8 teaching scorecard
// (`packages/evals/src/scorecard.ts`'s `Scorecard`, which apps/web does not import). Nothing
// stores a scorecard yet (plan Q1: 8.7 does), so the teacher page passes `null` for now; when 8.7
// lands, its stored value goes through `toPublicScorecard` here.
//
// Fails closed: anything that is not a complete, well-formed card (all three categories, each
// once, percent 0-100 or null) is `null`, shown as "no published scorecard yet" -- never a partial
// card and never a fabricated number. The per-origin split, totals and change kinds stay private.
import { z } from 'zod';

export const SCORECARD_KEYS = ['hints_before_answers', 'locked_content', 'accuracy'] as const;
export type PublicScorecardKey = (typeof SCORECARD_KEYS)[number];

export interface PublicScorecardCategory {
  key: PublicScorecardKey;
  measured: boolean;
  /** Whole percent, floored (99.6 -> 99); null when nothing was measured. */
  percent: number | null;
  pass: boolean;
}

export interface PublicScorecard {
  /** Exactly one per `SCORECARD_KEYS` entry, in that order. */
  categories: PublicScorecardCategory[];
}

const StoredCategory = z
  .object({
    key: z.enum(SCORECARD_KEYS),
    measured: z.boolean(),
    percent: z.number().min(0).max(100).nullable(),
    pass: z.boolean(),
  })
  // 7.8 never stores a percent or a pass for a question the run didn't ask.
  .refine((c) => c.measured || (c.percent === null && !c.pass));

const StoredScorecard = z.object({
  categories: z
    .array(StoredCategory)
    .length(SCORECARD_KEYS.length)
    .refine((cs) => new Set(cs.map((c) => c.key)).size === SCORECARD_KEYS.length),
});

export function toPublicScorecard(raw: unknown): PublicScorecard | null {
  const r = StoredScorecard.safeParse(raw);
  if (!r.success) return null;
  const byKey = new Map(r.data.categories.map((c) => [c.key, c]));
  return {
    categories: SCORECARD_KEYS.map((key) => {
      // Present: the length and uniqueness checks above guarantee every key once.
      const c = byKey.get(key) as z.infer<typeof StoredCategory>;
      return {
        key,
        measured: c.measured,
        percent: c.percent === null ? null : Math.floor(c.percent),
        pass: c.pass,
      };
    }),
  };
}
