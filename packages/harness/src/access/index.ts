// Access: server-side entitlement checks and the access filter (build plan § Repo layout,
// `src/access`; § Access filter; ADR-0003).
//
// The cache rule (ADR-0003 point 6, task 5.4): a cache that holds anything derived from teacher
// material or from an entitlement is keyed by everything that decides access: the package id and
// version, or the exact owned allowed-module set, plus the material revision for material. The
// inventory is two caches: (1) `promptCacheKey` (pedagogy), keyed by package id and version;
// (2) the db `leakCache`, keyed by teacher, material revision and the sorted owned allowed ids.
// Add no other cache without extending this list and its tests.
export {
  checkEntitlement,
  checkTurnConfig,
  type Checked,
  type EntitlementReason,
  type EntitlementRequest,
  type TurnConfig,
  type TurnConfigReason,
} from './entitlement.js';
export {
  checkScope,
  type LockedProbe,
  RetrievalScopeError,
  type ScopedRetrieval,
  scopedRetrieval,
} from './scopedRetrieval.js';
export { DuplicateToolError, entitledTools, offeredTools, policyTools } from './tools.js';
