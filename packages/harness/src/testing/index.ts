// Test helpers for the harness and its adapters: the contracts fixtures plus the scripted gateway.
export * from '@edmate/contracts/fixtures';
export { type Clock, type ManualClock, manualClock } from './clock.js';
export { driveEvents, driveTurn, type TimedEvent } from './driveTurn.js';
export { type SequentialIds, sequentialIds } from './ids.js';
export {
  type MemoryAlertSink,
  memoryAlertSink,
  type MemoryTraceSink,
  memoryTraceSink,
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
  testAskDecision,
  type TestDeps,
  testDeps,
  type TestSteps,
  testSteps,
} from './testSteps.js';
export { VIRTUAL_EPOCH_MS, type VirtualClock, virtualClock } from './virtualClock.js';
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
