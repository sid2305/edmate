// The eval case format (task 3.12). Owned by packages/evals, not a frozen contract: nothing
// outside the eval runner reads it. Suite content rules live with the eval-author agent; this
// file only decides what parses.
import { z } from 'zod';

/** A regex source that `new RegExp(source, 'i')` accepts; checked at load time, not mid-run. */
const RegexSource = z
  .string()
  .min(1)
  .refine((source) => {
    try {
      new RegExp(source, 'i');
      return true;
    } catch {
      return false;
    }
  }, 'not a valid regular expression');

export const CheckSchema = z
  .strictObject({
    /** Every phrase must appear (case-insensitive substring). */
    must_contain: z.array(z.string().min(1)).min(1).exactOptional(),
    /** No phrase may appear (case-insensitive substring). */
    must_not_contain: z.array(z.string().min(1)).min(1).exactOptional(),
    /** Every pattern must match (compiled with the `i` flag). */
    matches: z.array(RegexSource).min(1).exactOptional(),
    max_words: z.int().min(1).exactOptional(),
    max_chars: z.int().min(1).exactOptional(),
    /** true: the reply cites at least one source; false: it cites none; absent: don't care. */
    must_cite_source: z.boolean().exactOptional(),
    /**
     * true: the turn escalates (caring reply, SafetyAlert); false: it does not (task 4.3). The
     * agent must report it (`EvalAgentReply.escalated`), or the check fails.
     */
    must_escalate: z.boolean().exactOptional(),
    /** Observable yes/no statements, each scored by the judge model; all must pass. */
    judge: z.array(z.string().min(1)).min(1).exactOptional(),
  })
  .refine((c) => Object.keys(c).length > 0, 'at least one check');
export type Checks = z.infer<typeof CheckSchema>;

export const TurnSchema = z.strictObject({
  student: z.string().min(1),
  /** A turn with no `expect` just advances the conversation (pressure build-up). */
  expect: CheckSchema.exactOptional(),
});
export type EvalTurn = z.infer<typeof TurnSchema>;

export const EvalCaseSchema = z
  .strictObject({
    /** Also the fixture and report key, so it is kept path-safe. */
    id: z.string().regex(/^[a-z0-9-]+$/, 'lowercase letters, digits, -'),
    suite: z.string().min(1),
    package: z.string().min(1),
    reviewed_by: z.string().min(1),
    source: z.string().min(1),
    turns: z.array(TurnSchema).min(1),
  })
  // A case with no checks at all would pass vacuously.
  .superRefine((c, ctx) => {
    if (!c.turns.some((t) => t.expect !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['turns'],
        message: `case "${c.id}" has no turn with an expect block, so it checks nothing`,
      });
    }
  });
export type EvalCase = z.infer<typeof EvalCaseSchema>;
