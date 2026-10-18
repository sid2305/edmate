import { z } from 'zod';
import { count, currencyCode, tier } from './formats.js';

/** BCP 47 primary language subtag only, for example `en`; the allowed set comes from locale packs. */
export const LangSchema = z.string().regex(/^[a-z]{2,3}$/, 'BCP 47 primary language subtag');
export type Lang = z.infer<typeof LangSchema>;

export const SkillSchema = z.enum([
  'explain',
  'coach',
  'practice',
  'feedback',
  'mock_interview',
  'revision',
  'study_plan',
]);
export type Skill = z.infer<typeof SkillSchema>;

export const MoneySchema = z.strictObject({
  amountMinor: count(),
  currency: currencyCode(),
});
export type Money = z.infer<typeof MoneySchema>;

export const ErrorCodeSchema = z.enum([
  'unauthorized',
  'forbidden',
  'not_found',
  'validation',
  'no_access',
  'limit_reached',
  'rate_limited',
  'input_too_large',
  'turn_cost_exceeded',
  'provider_error',
  'guard_blocked',
  'payment_required',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const UsageSchema = z.strictObject({
  model: z.string(),
  tier: tier(),
  inputTokens: count(),
  outputTokens: count(),
  costMicroUsd: count(),
});
export type Usage = z.infer<typeof UsageSchema>;

/** A registered tool id, for example `calculator` or `practice.next_item`. */
export const ToolNameSchema = z.string().min(1);
export type ToolName = z.infer<typeof ToolNameSchema>;
