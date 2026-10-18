// Per-session help state beyond `helpRung` (the shape of `sessions.help_state`). `helpRung`
// itself stays in TurnContext so there is one source of truth. 3.4 loads it, 3.8 saves `next`.
import { z } from 'zod';

export const HelpStateSchema = z.strictObject({
  /** Consecutive turns with attempt none or wrong; the second one climbs the ladder. */
  stuckTurns: z.literal([0, 1]),
  /** An attempt was logged on the current problem (opens rung 4 for `after_attempt`). */
  attemptLogged: z.boolean(),
  /** The last move was `solution` or `explain`, so this turn is a `check`. */
  pendingCheck: z.boolean(),
  /** The current problem's answer; goes to `mustNotReveal`. Filled by 5.6. */
  answerKey: z.array(z.string()),
});
export type HelpState = z.infer<typeof HelpStateSchema>;

export const INITIAL_HELP_STATE: Readonly<HelpState> = Object.freeze({
  stuckTurns: 0,
  attemptLogged: false,
  pendingCheck: false,
  answerKey: Object.freeze([]) as unknown as string[],
});

/** A fresh copy, so a result never aliases (possibly frozen) input state. */
export function copyHelp(h: Readonly<HelpState>): HelpState {
  return { ...h, answerKey: [...h.answerKey] };
}
