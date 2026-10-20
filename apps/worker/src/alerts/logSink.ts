// The default AlertNotifier (task 4.3): one structured JSON log line per notification. Real
// delivery to the trust team and on-call (email, SMS, chat) waits for a vendor decision, the same
// gap as the cost alarm (alarms/logSink.ts); one decision should wire both.
//
// The line holds the alert's ids, kind, level and time and the audience. Never the excerpt, even
// redacted (lead answer 6): log storage is wider than the alert itself.
import type { AlertNotifier } from './types.js';

export function logAlertNotifier(
  write: (line: string) => void = (line) => {
    console.warn(line);
  },
): AlertNotifier {
  return {
    notify(a, audience) {
      write(
        JSON.stringify({
          level: 'warn',
          event: 'safety_alert',
          audience,
          alertId: a.id,
          kind: a.kind,
          alertLevel: a.level,
          studentId: a.studentId,
          teacherId: a.teacherId,
          sessionId: a.sessionId,
          createdAt: a.createdAt,
        }),
      );
      return Promise.resolve();
    },
  };
}
