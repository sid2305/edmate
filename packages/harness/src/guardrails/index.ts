// Guard framework and registry (task 4.1). Concrete guards land in 4.2-4.9.
export {
  type GuardBlockCause,
  type GuardChainOptions,
  type GuardChainResult,
  type GuardFailure,
  type GuardFailureCause,
  type GuardOutcomeEvent,
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
export { GuardRegistry, GuardRegistryError } from './registry.js';
