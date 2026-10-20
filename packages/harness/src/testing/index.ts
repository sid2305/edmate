// Test helpers for the harness and its adapters: the contracts fixtures plus the scripted gateway.
export * from '@edmate/contracts/fixtures';
export { type Clock, type ManualClock, manualClock } from './clock.js';
export { indiaLocalePackWithHelplines } from './distressLocaleFixtures.js';
export { driveEvents, driveTurn, type TimedEvent } from './driveTurn.js';
export {
  type FakeGuard,
  type FakeGuardBehaviour,
  type FakeGuardOptions,
  fakeGuard,
} from './guardFixtures.js';
export { type SequentialIds, sequentialIds } from './ids.js';
export {
  type AccessOptions,
  type AccessWorld,
  type MemoryAgent,
  type MemoryEntitlementStore,
  memoryEntitlementStore,
  type MemorySession,
  type MemorySubscription,
  type MemoryTurnConfigStore,
  memoryTurnConfigStore,
  packMarket,
  S as WORLD_STUDENTS,
  T as WORLD_TEACHERS,
  twoTeacherWorld,
} from './memoryAccess.js';
export {
  type MemoryRetrieval,
  memoryRetrieval,
  OUT_OF_SCOPE_TEXT,
  retrievalWorld,
} from './memoryRetrieval.js';
export {
  CONTRACT,
  CONTRACT_LOCKED_SPAN,
  contractWorld,
  type MakeRetrieval,
  RETRIEVAL_CONTRACT,
  type RetrievalContractCase,
} from './retrievalContract.js';
export { IN_PII_PATTERNS, indiaLocalePackWithPii } from './piiLocaleFixtures.js';
export {
  PII_SCRUB_CASES,
  type PiiScrubCase,
  piiScrubCaseFailures,
} from './piiScrubCases.js';
export { type Prng, prng } from './prng.js';
export {
  type MemoryAlertSink,
  memoryAlertSink,
  type MemorySessionStateStore,
  memorySessionStateStore,
  type MemoryTeacherQuestionStore,
  memoryTeacherQuestionStore,
  type MemoryTurnLog,
  memoryTurnLog,
  type MemoryTraceSink,
  memoryTraceSink,
  type MemoryTranscriptStore,
  memoryTranscriptStore,
  type MemoryUsageMeter,
  memoryUsageMeter,
  UnusedPortError,
  unusedPort,
} from './memoryPorts.js';
export {
  type LoggedStep,
  type StepLogEntry,
  type StepOverrides,
  TEST_CARING_REPLY,
  TEST_DISTRESS_REPLY,
  TEST_SAFE_REPLY,
  stepEnvExtras,
  testAskDecision,
  testDecideResult,
  type TestDeps,
  testDeps,
  type TestSteps,
  testSteps,
} from './testSteps.js';
export {
  FIXTURE_PACK_VERSION,
  FIXTURE_PROMPT_PACK_VERSION,
  FIXTURE_REVIEWER,
  fixturePromptPackLibrary,
  fixturePromptPackRaw,
  fixturePromptPackSet,
} from './promptPackFixtures.js';
export { VIRTUAL_EPOCH_MS, type VirtualClock, virtualClock } from './virtualClock.js';
export { type MemoryToolRegistry, memoryToolRegistry, testTool } from './memoryToolRegistry.js';
export { type SpyGateway, spyGateway } from './spyGateway.js';
export {
  GROUNDED_VERDICT,
  type JudgeGateway,
  judgeGateway,
  type JudgeInput,
  type JudgeVerdict,
  overlapGrounded,
  overlapJudge,
  readJudgeRequest,
  UNGROUNDED_VERDICT,
} from './groundingJudge.js';
export {
  scriptedEmbedPair,
  scriptedObjectIntent,
  scriptedStreamProviderError,
  scriptedStreamText,
  scriptedStreamToolCall,
  scriptedStreamWithDelay,
} from './gatewayFixtures.js';
export {
  type GatewayMethod,
  type GatewayScript,
  type RecordedUsage,
  type RedactedRequest,
  type ScriptedEmbedCall,
  ScriptedGateway,
  ScriptedGatewayError,
  type ScriptedObjectCall,
  ScriptedProviderError,
  type ScriptedStreamCall,
  type StreamStep,
} from './scriptedGateway.js';
