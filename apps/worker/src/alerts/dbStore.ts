// The DB-backed alert store (task 12.5b): the ack source of truth is `safety_alerts` (12.5a's
// repository), not Redis. `record` and `markEscalated` persist the row the processor already
// computed; `isAcknowledged` reads it back. The worker never acknowledges an alert (only the
// staff console does, task 12.5c): `acknowledge` always throws.
import type { SafetyAlert } from '@edmate/contracts';
import type { AckStore, AlertStore } from './types.js';

/** What the store needs from `safetyAlertsRepo(db)` (the full repo also has `listForStaff` etc). */
export interface SafetyAlertsRepo {
  record(alert: SafetyAlert): Promise<unknown>;
  markEscalated(alert: SafetyAlert, round: number): Promise<unknown>;
  isAcknowledged(alertId: string): Promise<boolean>;
}

export function dbAlertStore(repo: SafetyAlertsRepo): AlertStore & AckStore {
  return {
    async record(alert) {
      return repo.record(alert);
    },
    async markEscalated(alert, round) {
      return repo.markEscalated(alert, round);
    },
    async isAcknowledged(alertId) {
      return repo.isAcknowledged(alertId);
    },
    acknowledge() {
      return Promise.reject(new Error('use the staff console'));
    },
  };
}
