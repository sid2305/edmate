// Access: server-side entitlement checks (build plan § Repo layout, `src/access`).
export {
  checkEntitlement,
  checkTurnConfig,
  type Checked,
  type EntitlementReason,
  type EntitlementRequest,
  type TurnConfig,
  type TurnConfigReason,
} from './entitlement.js';
