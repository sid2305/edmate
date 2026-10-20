// Guard framework and registry (task 4.1). Concrete guards land in 4.2-4.9 (4.2: piiScrub,
// 4.5: answerLeak, 4.6: lockedLeak).
export {
  ANSWER_LEAK_SAFE_HINT,
  createAnswerLeakGuard,
  type GroundingJudge,
  type JudgeReply,
  type JudgeRequest,
  type LeakRewrite,
  type LockedCheck,
  type PostGuardCtx,
} from './answerLeak.js';
export {
  ADVICE_FALLBACK_REPLY,
  ADVICE_JUDGE_SYSTEM,
  ADVICE_REASONS,
  ADVICE_REWRITE_SYSTEM,
  adviceFallbackText,
  type AdviceGuardOptions,
  adviceJudgeRequest,
  adviceRedirectReplyText,
  adviceRewriteRequest,
  adviceSignal,
  adviceVerdictClean,
  createAdviceGuard,
  decisionRequest,
  regulatedTopic,
  strongAdviceSignal,
  weakAdviceSignal,
  DEFAULT_GENERIC_DISCLAIMER,
  disclaimerFor,
  personalDirective,
} from './adviceGuard.js';
export {
  askTeacherReplyText,
  createGroundingGuard,
  GROUNDING_JUDGE_SYSTEM,
  GROUNDING_REASONS,
  type GroundingOptions,
  groundingJudgeRequest,
  parseGroundingVerdict,
  PREMISE_CORRECTION_REPLY,
} from './grounding.js';
export {
  type GuardBlockCause,
  type GuardChainOptions,
  type GuardChainResult,
  type GuardFailure,
  type GuardFailureCause,
  type GuardOutcomeEvent,
  type GuardSliceRequest,
  runGuardChain,
} from './chain.js';
export type { Guard, GuardRun } from './guard.js';
export {
  declaredIndex,
  GUARD_ORDER,
  GUARD_PHASES,
  type GuardPhase,
  isGuardPhase,
} from './order.js';
export { type FoldedDigitForms, foldDigitForms } from './digitForms.js';
export {
  compileLocalePatterns,
  findPii,
  PII_CATEGORIES,
  PII_PLACEHOLDERS,
  type PiiCategory,
  PiiPatternError,
  type PiiSpan,
  scrubPii,
} from './piiPatterns.js';
export { createPiiScrubGuard, type PiiScrubCtx } from './piiScrub.js';
export {
  createLockedCheck,
  createLockedLeakGuard,
  LOCKED_CHECK_TIMEOUT_MS,
  LockedCheckFailed,
  type LockedCheckFailure,
  type LockedCheckOptions,
  LockedLeakDetected,
  lockedReplyText,
  type LockedSite,
} from './lockedLeak.js';
export {
  carryStart,
  type InvisibleReading,
  LOCKED_LEAK_MIN_TOKENS,
  LOCKED_STREAM_CARRY_TOKENS,
  lockedCandidates,
  type LockedIndex,
  lockedIndex,
  type LockedToken,
  lockedTokens,
  type MarkupReading,
  shingles,
  stringLeaves,
} from './lockedMatch.js';
export { postGuards } from './postGuards.js';
export {
  GuardRegistry,
  GuardRegistryError,
  MAX_GUARD_WEIGHT,
  type RegisterOptions,
} from './registry.js';
export { digitValue, type FoldedText, foldText, isDecimalDigit, isFormatChar } from './textFold.js';
