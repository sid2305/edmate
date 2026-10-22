// What the browser may send to the turn routes (task 9.4, widened in 9.5a for skill inputs).
// Strict objects: the student id comes from the signed-in session and the session id from the
// path, so a body naming either is refused (400), never merged.
import { TurnInputSchema, type TurnInput } from '@edmate/contracts';
import { z } from 'zod';

const shape = TurnInputSchema.shape;

/** `POST /api/sessions`: start a session with one agent. */
export const StartSessionSchema = z.strictObject({ agentId: shape.agentId });

/** `POST /api/sessions/:id/turns`: one student turn, English only in the pilot. */
export const ClientTurnSchema = z
  .strictObject({
    agentId: shape.agentId,
    kind: z.enum(['message', 'hint_request', 'check_answer', 'skill_action']),
    text: shape.text.unwrap().refine((t) => t.trim() !== '', 'must not be blank').exactOptional(),
    skill: shape.skill,
    skillPayload: shape.skillPayload,
    lang: z.literal('en'),
    clientTs: shape.clientTs,
  })
  .refine((t) => t.kind !== 'message' || t.text !== undefined, {
    path: ['text'],
    message: 'required when kind is "message"',
  })
  .refine((t) => t.kind !== 'skill_action' || t.skill !== undefined, {
    path: ['skill'],
    message: 'required when kind is "skill_action"',
  });
export type ClientTurn = z.infer<typeof ClientTurnSchema>;

/**
 * The full contracts `TurnInput`: the client's fields plus the server's ids, parsed again with the
 * contracts schema. Null when that parse fails.
 */
export function toTurnInput(
  body: ClientTurn,
  server: { studentId: string; sessionId: string },
): TurnInput | null {
  const parsed = TurnInputSchema.safeParse({ ...body, ...server });
  return parsed.success ? parsed.data : null;
}
