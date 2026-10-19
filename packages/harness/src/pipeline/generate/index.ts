// generate's building blocks (task 3.7); the step itself is `steps/generate.ts`.
export { normaliseForMatch, revealsAnswerKey } from './answerKey.js';
export { citedSources } from './citations.js';
export {
  ceilingOf,
  DEFAULT_MAX_TURN_COST_MICRO_USD,
  type PriceUsage,
  TurnCost,
} from './costCeiling.js';
export { type SkillDropReason, SkillEventDropped, skillEvent } from './skillEvent.js';
export { passThroughGate, type StreamGate, type StreamGateFactory } from './streamGate.js';
export { InvalidChunkError, raceCancel, StreamCloseFailed, StreamReader } from './streamReader.js';
export {
  MAX_TOOL_CALLS_PER_ROUND,
  MAX_TOOL_ROUNDS,
  runToolLoop,
  TOOL_RESULT_MAX_JSON_LENGTH,
  TOOL_TIMEOUT_MS,
  ToolCallNotOfferedError,
  type ToolFailReason,
  ToolFailed,
  type ToolLoopInput,
} from './toolLoop.js';
export {
  jsonSafe,
  type ToolCallRecord,
  type ToolErrorCode,
  toolCallsMessage,
  type ToolResultRecord,
  toolResultsMessage,
} from './toolMessages.js';
