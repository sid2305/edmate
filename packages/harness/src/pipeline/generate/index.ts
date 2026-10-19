// generate's building blocks (task 3.7); the step itself is `steps/generate.ts`.
export {
  type AnswerKeyMatcher,
  type AnswerKeyOptions,
  compileAnswerKeys,
  normaliseForMatch,
  revealsAnswerKey,
} from './answerKey.js';
export { arithmeticSpans, evaluateArithmetic, MAX_EXPRESSION_LENGTH } from './arithmetic.js';
export {
  decodeBase64Text,
  decodedBase64Spans,
  MAX_CANDIDATE_LENGTH,
  MAX_CANDIDATES,
  wordLike,
} from './base64Leak.js';
export { foldWord, type NumberWord, numberWord, scaleSuffix } from './numberWords.js';
export {
  canonicalNumber,
  foldForNumbers,
  type MentionKind,
  type NumberMention,
  numberMentions,
  numbersMentioned,
  numericKeyValue,
} from './numbers.js';
export { citedSources } from './citations.js';
export {
  ceilingOf,
  DEFAULT_MAX_TURN_COST_MICRO_USD,
  type PriceUsage,
  TurnCost,
} from './costCeiling.js';
export { type SkillDropReason, SkillEventDropped, skillEvent } from './skillEvent.js';
export {
  answerLeakStreamGate,
  passThroughGate,
  SENTENCE_GATE_CAP,
  sentenceGate,
  type StreamGate,
  type StreamGateFactory,
  type StreamGateInput,
} from './streamGate.js';
export { type LockedStream, lockedStream } from './lockedStream.js';
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
  type ToolLoopResult,
} from './toolLoop.js';
export {
  jsonSafe,
  type ToolCallRecord,
  type ToolErrorCode,
  toolCallsMessage,
  type ToolResultRecord,
  toolResultsMessage,
} from './toolMessages.js';
