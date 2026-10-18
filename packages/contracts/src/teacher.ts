import { z } from 'zod';
import { count, id } from './formats.js';
import { countWords, LIMITS } from './limits.js';
import { ModelPolicySchema } from './model.js';
import { LangSchema, MoneySchema, SkillSchema } from './shared.js';

/** Semantic version, for example `1.4.0` or `2.0.0-rc.1`. */
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export const AgentConfigSchema = z.strictObject({
  id: id(),
  version: count(),
  teacherId: id(),
  courseId: id(),
  styleCardId: id(),
  /** One semver pins the whole platform prompt-pack set. */
  promptPackVersion: z.string().regex(SEMVER, 'semver'),
  languages: z.array(LangSchema),
  regulatedSubject: z.enum(['investing', 'health', 'law']).exactOptional(),
  modelPolicy: ModelPolicySchema,
});
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export const StyleCardSchema = z.strictObject({
  id: id(),
  teacherId: id(),
  version: count(),
  text: z
    .string()
    .refine(
      (t) => countWords(t) <= LIMITS.styleCardMaxWords,
      `at most ${LIMITS.styleCardMaxWords} words`,
    ),
  mistakeTags: z.array(z.string()),
});
export type StyleCard = z.infer<typeof StyleCardSchema>;

export const PackageConfigSchema = z.strictObject({
  id: id(),
  version: count(),
  teacherId: id(),
  agentId: id(),
  name: z.string(),
  /** Knowledge the agent may use. */
  moduleIds: z.array(id()),
  /** What the agent may do. */
  skills: z.array(SkillSchema),
  /** Effective ceiling = finalAnswers === 'never' ? min(helpCeiling, 3) : helpCeiling. */
  helpCeiling: z.literal([1, 2, 3, 4]),
  finalAnswers: z.enum(['never', 'after_attempt', 'allowed']),
  /** Rolling 24-hour window. Required here; the studio and the seed apply the default of 20. */
  dailyMessageLimit: count(),
  liveClassesPerMonth: count(),
  /** amountMinor 0 = free package. */
  pricePerMonth: MoneySchema,
  trialDays: count().exactOptional(),
  lockedReply: z.enum(['name_package', 'generic']),
});
export type PackageConfig = z.infer<typeof PackageConfigSchema>;
