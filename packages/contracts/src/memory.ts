import { z } from 'zod';
import { count, id, timestamp } from './formats.js';
import { countWords, LIMITS } from './limits.js';
import { LangSchema } from './shared.js';

/** One per (student, teacher). */
export const LearnerProfileSchema = z.strictObject({
  studentId: id(),
  teacherId: id(),
  lang: LangSchema,
  /** Topic id -> P(known). */
  mastery: z.record(
    id(),
    z.strictObject({ p: z.number().min(0).max(1), n: count(), updatedAt: timestamp() }),
  ),
  mistakes: z.array(z.strictObject({ tag: z.string(), count: count(), lastSeen: timestamp() })),
  /** From the previous session. */
  lastSummary: z
    .string()
    .refine(
      (t) => countWords(t) <= LIMITS.lastSummaryMaxWords,
      `at most ${LIMITS.lastSummaryMaxWords} words`,
    )
    .exactOptional(),
});
export type LearnerProfile = z.infer<typeof LearnerProfileSchema>;

export const EvidenceEventSchema = z.strictObject({
  studentId: id(),
  teacherId: id(),
  topicId: id(),
  correct: z.boolean(),
  source: z.enum(['check', 'practice', 'rubric']),
  weight: z.number(),
  ts: timestamp(),
});
export type EvidenceEvent = z.infer<typeof EvidenceEventSchema>;
