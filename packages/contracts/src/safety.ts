import { z } from 'zod';
import { id, timestamp } from './formats.js';
import { LIMITS } from './limits.js';

// Model-produced strings are capped so a runaway output can't bloat alerts, traces or the UI.
const reason = () => z.string().max(LIMITS.guardReasonMaxLength);
const modelText = () => z.string().max(LIMITS.modelTextMaxLength);

export const SafetyAlertSchema = z.strictObject({
  id: id(),
  level: z.enum(['info', 'alert', 'critical']),
  kind: z.enum(['distress', 'abuse', 'misuse', 'other']),
  studentId: id(),
  teacherId: id(),
  sessionId: id(),
  excerptRedacted: modelText(),
  createdAt: timestamp(),
});
export type SafetyAlert = z.infer<typeof SafetyAlertSchema>;

// A plain union: the three `ok: false` variants share `ok`, so `ok` can't discriminate them.
export const GuardResultSchema = z.union([
  z.strictObject({ ok: z.literal(true) }),
  z.strictObject({ ok: z.literal(false), action: z.literal('block'), reason: reason() }),
  /** text = the replacement input or reply. */
  z.strictObject({
    ok: z.literal(false),
    action: z.literal('rewrite'),
    text: modelText(),
    reason: reason(),
  }),
  z.strictObject({ ok: z.literal(false), action: z.literal('escalate'), alert: SafetyAlertSchema }),
]);
export type GuardResult = z.infer<typeof GuardResultSchema>;
