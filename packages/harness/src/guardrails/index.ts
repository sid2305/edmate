// Guard framework and registry (task 4.1). Concrete guards land in 4.2-4.9 (4.2: piiScrub).
export {
  type GuardBlockCause,
  type GuardChainOptions,
  type GuardChainResult,
  type GuardFailure,
  type GuardFailureCause,
  type GuardOutcomeEvent,
  runGuardChain,
} from './chain.js';
export {
  buildDistressClassifierRequest,
  createDistressDetectGuard,
  DISTRESS_CLASSIFIER_TIMEOUT_MS,
  DISTRESS_CONTEXT_TURNS,
  DISTRESS_EXCERPT_MAX,
  DistressClassifierTimeoutError,
  type DistressDetectOptions,
  DistressVerdictSchema,
} from './distressDetect.js';
export {
  distressKeywordLevel,
  type DistressKeywordKind,
  type DistressKeywordLevel,
  type DistressKeywordMatch,
  distressKeywordMatch,
  hasDistressKeyword,
  normaliseForDistress,
} from './distressKeywords.js';
export type { Guard, GuardRun } from './guard.js';
export type { PreGuardCtx } from './preGuardCtx.js';
export {
  declaredIndex,
  GUARD_ORDER,
  GUARD_PHASES,
  type GuardPhase,
  isGuardPhase,
} from './order.js';
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
export { GuardRegistry, GuardRegistryError } from './registry.js';
