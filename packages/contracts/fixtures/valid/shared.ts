// Synthetic data only (the repo is public): no real names, contacts or excerpts.
import type { ErrorCode, Lang, Money, Skill, ToolName, Usage } from '../../src/index.js';

export const langEn = 'en' satisfies Lang;
export const langHi = 'hi' satisfies Lang;
export const langFil = 'fil' satisfies Lang;

export const skills = [
  'explain',
  'coach',
  'practice',
  'feedback',
  'mock_interview',
  'revision',
  'study_plan',
] as const satisfies readonly Skill[];

export const moneyFree = { amountMinor: 0, currency: 'INR' } satisfies Money;
export const moneyPaid = { amountMinor: 49900, currency: 'INR' } satisfies Money;

export const errorCodes = [
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
] as const satisfies readonly ErrorCode[];

export const usageSmall = {
  model: 'test-small-model',
  tier: 'small',
  inputTokens: 120,
  outputTokens: 8,
  costMicroUsd: 15,
} satisfies Usage;
export const usageMain = {
  model: 'test-main-model',
  tier: 'main',
  inputTokens: 2400,
  outputTokens: 310,
  costMicroUsd: 0,
} satisfies Usage;

export const toolCalculator = 'calculator' satisfies ToolName;
export const toolNextItem = 'practice.next_item' satisfies ToolName;

export const valid = {
  Lang: [langEn, langHi, langFil],
  Skill: [...skills],
  Money: [moneyFree, moneyPaid],
  ErrorCode: [...errorCodes],
  Usage: [usageSmall, usageMain],
  ToolName: [toolCalculator, toolNextItem],
};
