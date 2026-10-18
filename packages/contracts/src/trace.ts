import { z } from 'zod';
import { count, id } from './formats.js';
import { UsageSchema } from './shared.js';
import { IntentSchema, PedagogyDecisionSchema } from './turn.js';

export const TurnTraceSchema = z.strictObject({
  turnId: id(),
  sessionId: id(),
  agentVersion: count(),
  packageVersion: count(),
  steps: z.array(
    z.strictObject({
      name: z.string(),
      ms: z.number().min(0),
      outcome: z.enum(['ok', 'fallback', 'failed']),
    }),
  ),
  intent: IntentSchema,
  move: PedagogyDecisionSchema.shape.move,
  // The spec types `action` as a plain string, not the GuardResult action enum (lead answer Q2).
  guards: z.array(
    z.strictObject({ name: z.string(), ok: z.boolean(), action: z.string().exactOptional() }),
  ),
  usage: z.array(UsageSchema),
});
export type TurnTrace = z.infer<typeof TurnTraceSchema>;
