import { z } from 'zod';
import { id, timestamp } from './formats.js';

export const SafetyAlertSchema = z.strictObject({
  id: id(),
  level: z.enum(['info', 'alert', 'critical']),
  kind: z.enum(['distress', 'abuse', 'misuse', 'other']),
  studentId: id(),
  teacherId: id(),
  sessionId: id(),
  excerptRedacted: z.string(),
  createdAt: timestamp(),
});
export type SafetyAlert = z.infer<typeof SafetyAlertSchema>;

// A plain union: the three `ok: false` variants share `ok`, so `ok` can't discriminate them.
export const GuardResultSchema = z.union([
  z.strictObject({ ok: z.literal(true) }),
  z.strictObject({ ok: z.literal(false), action: z.literal('block'), reason: z.string() }),
  /** text = the replacement input or reply. */
  z.strictObject({
    ok: z.literal(false),
    action: z.literal('rewrite'),
    text: z.string(),
    reason: z.string(),
  }),
  z.strictObject({ ok: z.literal(false), action: z.literal('escalate'), alert: SafetyAlertSchema }),
]);
export type GuardResult = z.infer<typeof GuardResultSchema>;
