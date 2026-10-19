// Per-session help state beyond `helpRung`. `helpRung` itself stays in TurnContext so there is
// one source of truth for a turn. `sessions.help_state` stores both as a SessionHelp blob
// (ADR-0005): buildContext (3.4) parses it on load, commit (3.8) serialises `next` to save it.
// The blob holds `answerKey`, so it never reaches a client-facing type (ADR-0005 Consequences).
import { LIMITS, type TurnContext, TurnContextSchema } from '@edmate/contracts';
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
  /**
   * How many times this session the grounding guard sent a question to the teacher (task 4.7);
   * absent until the first. The runner caps it (GROUNDING_ASKS_PER_SESSION) and carries it over.
   */
  groundingAsks: z.int().min(0).max(1_000).exactOptional(),
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

/** The stored `sessions.help_state` (ADR-0005): a version, the rung and the HelpState fields. */
export const SessionHelpSchema = z.strictObject({
  v: z.literal(1),
  rung: TurnContextSchema.shape.helpRung,
  ...HelpStateSchema.shape,
});
export type StoredSessionHelp = z.infer<typeof SessionHelpSchema>;

/** A session's place on the help ladder, as the pipeline uses it. */
export interface SessionHelp {
  rung: TurnContext['helpRung'];
  help: HelpState;
}

/**
 * Parses the raw stored value. Anything that does not parse (missing, `{}`, another version,
 * wrong types, unknown keys) is rung 0 and INITIAL_HELP_STATE: the student restarts the ladder,
 * which never reveals more than before.
 */
export function parseSessionHelp(raw: unknown): SessionHelp {
  let r: ReturnType<typeof SessionHelpSchema.safeParse>;
  try {
    r = SessionHelpSchema.safeParse(raw);
  } catch {
    return { rung: 0, help: copyHelp(INITIAL_HELP_STATE) };
  }
  if (!r.success) return { rung: 0, help: copyHelp(INITIAL_HELP_STATE) };
  const { rung, stuckTurns, attemptLogged, pendingCheck, answerKey, groundingAsks } = r.data;
  const help: HelpState = { stuckTurns, attemptLogged, pendingCheck, answerKey };
  if (groundingAsks !== undefined) help.groundingAsks = groundingAsks;
  return { rung, help: copyHelp(help) };
}

/**
 * The value to save (3.8). Throws on an invalid state or one over
 * `LIMITS.helpStateMaxJsonLength`, so a bad state is never written.
 */
export function serializeSessionHelp(s: SessionHelp): StoredSessionHelp {
  const out = SessionHelpSchema.parse({ v: 1, rung: s.rung, ...copyHelp(s.help) });
  if (JSON.stringify(out).length > LIMITS.helpStateMaxJsonLength) {
    throw new RangeError('help state over LIMITS.helpStateMaxJsonLength');
  }
  return out;
}
