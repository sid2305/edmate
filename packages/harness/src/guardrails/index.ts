// Guard framework and registry (task 4.1). Concrete guards land in 4.2-4.9 (4.2: piiScrub;
// 4.3: distressDetect; 4.4: moderationIn, jailbreak).
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
  DistressGuardCancelledError,
  type DistressDetectOptions,
  DistressVerdictSchema,
} from './distressDetect.js';
export {
  distressKeywordLevel,
  type DistressKeywordKind,
  type DistressKeywordLevel,
  type DistressKeywordMatch,
  distressKeywordMatch,
  hasAnyDistressKeyword,
  hasDistressKeyword,
  normaliseForDistress,
} from './distressKeywords.js';
export { BLOCK_REPLIES, type BlockCode, blockReplyFor } from './blockReplies.js';
export {
  DECODE_INPUT_MAX,
  DECODE_MAX_LEVELS,
  DECODE_MAX_PAYLOADS,
  DECODE_OUTPUT_MAX,
  decodeEncodedPayloads,
  reverseText,
  rot13,
  textVariants,
  type TextVariants,
} from './decodeAttempts.js';
export type { Guard, GuardRun } from './guard.js';
export { createJailbreakGuard } from './jailbreak.js';
export {
  JAILBREAK_CODES,
  type JailbreakCode,
  matchJailbreak,
  type MatchJailbreakOptions,
} from './jailbreakPatterns.js';
export { createModerationInGuard, preGuardAlert } from './moderationIn.js';
export { matchModeration, MODERATION_CODES, type ModerationCode } from './moderationPatterns.js';
export type { PreGuardBlock, PreGuardCtx } from './preGuardCtx.js';
export {
  buildJailbreakClassifierRequest,
  buildModerationClassifierRequest,
  JailbreakVerdictSchema,
  ModerationVerdictSchema,
  SAFETY_CLASSIFIER_TIMEOUT_MS,
  SAFETY_CONTEXT_TURNS,
  SafetyClassifierInvalidError,
  SafetyClassifierTimeoutError,
  SafetyGuardCancelledError,
} from './safetyClassifier.js';
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
