// The safety-alert worker's own types (task 4.3). Local to the worker, not contracts (like
// alarms/types.ts): the frozen AlertSink is the producer side; who gets told, and how an alert is
// acknowledged, is the worker's business.
import type { SafetyAlert } from '@edmate/contracts';

/** `trust_team` on every alert; `on_call` when nobody acknowledged it in time. */
export type AlertAudience = 'trust_team' | 'on_call';

/** Delivers an alert. The default is a log line (`logSink.ts`); real delivery waits for a vendor. */
export interface AlertNotifier {
  notify(alert: SafetyAlert, audience: AlertAudience): Promise<void>;
}

/** Acknowledgements. Nothing calls `acknowledge` yet: a later trust-console task will. */
export interface AckStore {
  acknowledge(alertId: string): Promise<void>;
  isAcknowledged(alertId: string): Promise<boolean>;
}
