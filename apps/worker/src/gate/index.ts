// The quality gate's agent and input (task 8.7 Phase B). Phase C adds the queue and processor.
export {
  collectReply,
  createGateAgent,
  gateAgentFactory,
  gateFallbackReplies,
  isGuardDetection,
  type GateAgentDeps,
} from './agent.js';
export { gateTurnConfigStore, type GateTurnConfigOptions } from './configStore.js';
export {
  buildGateInput,
  GateUnavailableError,
  packageForLabel,
  type BuildGateInputOptions,
  type GateBasis,
  type GateUnavailableReason,
} from './input.js';
export {
  gateGatewayFor,
  gateJudgeGateway,
  gateModelsFromEnv,
  gatePriceUsage,
  type Env,
  type GateModels,
  type GateModelsResult,
} from './models.js';
export {
  gateCasePorts,
  gateSideEffects,
  gateUsageMeter,
  systemClock,
  systemIds,
  type GateCasePorts,
  type GateSideEffects,
  type GateUsageMeter,
  type GateUsageTotals,
} from './ports.js';
export {
  basisOf,
  caseResults,
  errorCodeOf,
  GateResultMismatchError,
  gateProcessor,
  passRateOf,
  runSummary,
  type GateJobLike,
  type GateOutcome,
  type GatePreparation,
  type GateProcessorDeps,
  type PrepareGate,
} from './processor.js';
export {
  createGateWorker,
  gateConcurrencyFromEnv,
  gateContentDir,
  gateSuitesDir,
  livePrepareGate,
  type GateWorkerOptions,
  type LiveGateOptions,
} from './workers.js';
