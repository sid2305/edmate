// Test helpers for the harness and its adapters: the contracts fixtures plus the scripted gateway.
export * from '@edmate/contracts/fixtures';
export { type Clock, type ManualClock, manualClock } from './clock.js';
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
