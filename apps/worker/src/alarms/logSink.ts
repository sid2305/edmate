// The default CostAlarmSink (task 2.5): one structured JSON log line per alarm. Real delivery to
// staff and the teacher (email or similar) waits for a vendor decision, the same gap as 4.3's
// safety alerts; one decision should wire both.
import type { CostAlarmEvent, CostAlarmSink } from './types.js';

/** Only the event's own fields, so nothing else a caller put on the object reaches the log. */
function fieldsOf(e: CostAlarmEvent): CostAlarmEvent {
  return {
    kind: e.kind,
    recipients: [...e.recipients],
    teacherId: e.teacherId,
    monthStartIso: e.monthStartIso,
    costMicroUsd: e.costMicroUsd,
    thresholdMicroUsd: e.thresholdMicroUsd,
    unknownCalls: e.unknownCalls,
    unpricedCalls: e.unpricedCalls,
    pausedSubscriptionIds: [...e.pausedSubscriptionIds],
    pausedPackageIds: [...e.pausedPackageIds],
    pauseFailed: e.pauseFailed,
  };
}

export function logCostAlarmSink(
  write: (line: string) => void = (line) => {
    console.warn(line);
  },
): CostAlarmSink {
  return {
    notify(e) {
      write(JSON.stringify({ level: 'warn', event: 'cost_alarm', ...fieldsOf(e) }));
      return Promise.resolve();
    },
  };
}
