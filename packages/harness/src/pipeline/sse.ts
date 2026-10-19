// Server-sent events for the turn stream (task 3.7, plan Q6). A pure encoder only: the web route
// that uses it (auth, sessions) is 9.4/M8. JSON.stringify escapes CR and LF, so an event's text
// can never break out of its one `data:` line.
//
// Client rule (9.4): `replace` sets the reply text, and `replace ''` (sent before a retry or an
// error) also drops every `skill` event shown so far in the turn.
import { type TurnEvent, TurnEventSchema } from '@edmate/contracts';

/** `event: <type>\ndata: <json>\n\n`. Throws for an event that fails TurnEventSchema. */
export function formatSseEvent(e: TurnEvent): string {
  const checked = TurnEventSchema.parse(e);
  return `event: ${checked.type}\ndata: ${JSON.stringify(checked)}\n\n`;
}
