// Per-session help state beyond `helpRung`. `helpRung` itself stays in TurnContext so there is
// one source of truth for a turn. `sessions.help_state` stores both as a SessionHelp blob
// (ADR-0005): buildContext (3.4) parses it on load, commit (3.8) serialises `next` to save it.
// The blob holds `answerKey`, so it never reaches a client-facing type (ADR-0005 Consequences).
import { LIMITS, type TurnContext, TurnContextSchema } from '@edmate/contracts';
import { z } from 'zod';

/** The highest persona question count stored; the count stops there (3.11d). */
export const PERSONA_QUESTIONS_MAX = 1_000;
/** Longest stored persona id (3.11e); above LIMITS.idMaxLength, so a valid persona id always fits. */
export const PERSONA_ID_MAX = 200;
/** Most served practice item ids kept for the exclude list (oldest dropped first). */
export const PRACTICE_SERVED_MAX = 20;
/** Longest stored practice item or module id. */
export const PRACTICE_ID_MAX = 200;
/**
 * Longest JSON of the practice keys a turn may save (the union of its issued items' keys, 5.6
 * review). With the id limits above it keeps a full state under LIMITS.helpStateMaxJsonLength,
 * so a saved key is never dropped by `serializeSessionHelp` throwing.
 */
export const PRACTICE_KEYS_MAX_JSON = 2_048;

/**
 * The role-play phase that lasts into the next turn (5.8, ADR-0013 §1): `paused` after `/pause`,
 * `ended` after a debrief or a `stop`. Every other phase depends only on the turn and the count,
 * so it is never stored. Not the same type as `RolePlayPhase` (`roleplay.ts`), this turn's phase.
 */
export const StoredPersonaPhaseSchema = z.enum(['paused', 'ended']);
export type StoredPersonaPhase = z.infer<typeof StoredPersonaPhaseSchema>;

export const HelpStateSchema = z.strictObject({
  /** Consecutive turns with attempt none or wrong; the second one climbs the ladder. */
  stuckTurns: z.literal([0, 1]),
  /** An attempt was logged on the current problem (opens rung 4 for `after_attempt`). */
  attemptLogged: z.boolean(),
  /** The last move was `solution` or `explain`, so this turn is a `check`. */
  pendingCheck: z.boolean(),
  /**
   * The current problem's answer; goes to `mustNotReveal`. Filled by the runner (5.6, ADR-0010)
   * when a `practice.next_item` item went out: looked up server-side by item id, never read from
   * the model or the tool's model-visible output.
   */
  answerKey: z.array(z.string()),
  /**
   * Set once a turn has a locked hit or failed locked check anywhere (ADR-0007 §8, 4.6b). Stays
   * true for the rest of the session: every later turn's reply is held whole and checked once,
   * instead of streaming sentence by sentence (`generate.ts` reads it). The runner owns it: it
   * forces `loaded || tripped this turn` into every help state it saves, whatever decide or a
   * skill returned (fix round 1). Optional, absent = false, so a blob saved before 4.6b still
   * parses and keeps its rung. Harness-internal only: never a contracts change.
   */
  lockedStopped: z.boolean().exactOptional(),
  /**
   * How many times this session the grounding guard sent a question to the teacher (task 4.7);
   * absent until the first. The runner caps it (GROUNDING_ASKS_PER_SESSION) and carries it over.
   */
  groundingAsks: z.int().min(0).max(1_000).exactOptional(),
  /**
   * How many role-play questions the persona has asked this session (task 3.11d, ADR-0009). The
   * server counts it (`skillStep`, once per `mock_interview` turn with a persona), never the
   * model, and the composer shows it in the persona section. Absent until the first persona turn
   * and read as 0 (`personaQuestionsAsked`), so a blob saved before 3.11d still parses and keeps
   * its rung. Capped at PERSONA_QUESTIONS_MAX so a long session never makes the state unsavable.
   */
  personaQuestionsAsked: z.int().min(0).max(PERSONA_QUESTIONS_MAX).exactOptional(),
  /**
   * The persona the count belongs to (3.11e). A persona turn whose persona differs (or a blob
   * saved before 3.11e, which has none) starts the role-play again at question 1 (`skillStep`).
   */
  personaId: z.string().min(1).max(PERSONA_ID_MAX).exactOptional(),
  /**
   * The stored role-play phase (5.8, ADR-0013 §1). Set and cleared only by `rolePlayStep`, through
   * `skillStep`; carried with the count by `personaFields` and `withPersonaCount`, so a turn the
   * student never saw never pauses, resumes or ends a role-play. Optional, so a blob saved before
   * 5.8 still parses (absent = neither paused nor ended).
   */
  personaPhase: StoredPersonaPhaseSchema.exactOptional(),
  /**
   * The practice item whose key `answerKey` holds (5.6, ADR-0010). While it is set and
   * `answerKey` is not empty, the ladder uses the practice cap whatever skill the turn chose
   * (`holdsPracticeKey`). Optional, so a blob saved before 5.6 still parses.
   */
  practiceItemId: z.string().min(1).max(PRACTICE_ID_MAX).exactOptional(),
  /** The active practice item's module: the tool's second module tier (5.6). */
  practiceModuleId: z.string().min(1).max(PRACTICE_ID_MAX).exactOptional(),
  /** Practice item ids already served this session, oldest first (the tool's exclude list). */
  practiceServed: z
    .array(z.string().min(1).max(PRACTICE_ID_MAX))
    .max(PRACTICE_SERVED_MAX)
    .exactOptional(),
  /**
   * A skipped practice item's key (5.6c, ADR-0011 §2-3): when a turn issues a new item while the
   * loaded state held an unsolved one, the runner saves the old key here for exactly one turn.
   * Guarded (policy puts it in `mustNotReveal` on every move, never released) but never in the
   * prompt, never graded (`classifyAttempt` reads only `answerKey`) and never read by
   * `holdsPracticeKey`. buildContext drops chunks that hold it. The runner alone sets it and
   * removes it from every other saved state; `copyHelp` keeps it and `practiceFields` leaves it
   * out. The JSON of `answerKey` plus this stays within PRACTICE_KEYS_MAX_JSON (the practice
   * tool's cap counts held keys). Optional, so a blob saved before 5.6c still parses. No entry cap
   * of its own (5.6c fix round): the carried key is a subset of a loaded `answerKey`, which has
   * none, so a cap here could make `serializeSessionHelp` throw on a state the tool let through.
   * The JSON caps above and LIMITS.helpStateMaxJsonLength bound it.
   */
  practiceCarriedKey: z.array(z.string()).exactOptional(),
});
export type HelpState = z.infer<typeof HelpStateSchema>;

/** The server's persona question count for this session: absent reads as 0 (3.11d). */
export function personaQuestionsAsked(h: Readonly<HelpState>): number {
  return h.personaQuestionsAsked ?? 0;
}

export const INITIAL_HELP_STATE: Readonly<HelpState> = Object.freeze({
  stuckTurns: 0,
  attemptLogged: false,
  pendingCheck: false,
  answerKey: Object.freeze([]) as unknown as string[],
  lockedStopped: false,
});

/** A fresh copy, so a result never aliases (possibly frozen) input state. */
export function copyHelp(h: Readonly<HelpState>): HelpState {
  return {
    ...h,
    answerKey: [...h.answerKey],
    ...(h.practiceServed === undefined ? {} : { practiceServed: [...h.practiceServed] }),
    ...(h.practiceCarriedKey === undefined
      ? {}
      : { practiceCarriedKey: [...h.practiceCarriedKey] }),
  };
}

/** The help state holds a practice item's key (5.6): the practice cap applies (ADR-0010 §5). */
export function holdsPracticeKey(h: Readonly<HelpState>): boolean {
  return h.practiceItemId !== undefined && h.answerKey.length > 0;
}

/**
 * The practice fields of `h` (5.6), for carrying them over a state decide rebuilt without them.
 * Never `practiceCarriedKey`: it lasts one turn (5.6c, ADR-0011).
 */
export function practiceFields(
  h: Readonly<HelpState>,
): Pick<HelpState, 'practiceItemId' | 'practiceModuleId' | 'practiceServed'> {
  return {
    ...(h.practiceItemId === undefined ? {} : { practiceItemId: h.practiceItemId }),
    ...(h.practiceModuleId === undefined ? {} : { practiceModuleId: h.practiceModuleId }),
    ...(h.practiceServed === undefined ? {} : { practiceServed: [...h.practiceServed] }),
  };
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
  const {
    rung,
    stuckTurns,
    attemptLogged,
    pendingCheck,
    answerKey,
    lockedStopped,
    groundingAsks,
    personaQuestionsAsked: asked,
    personaId,
    personaPhase,
  } = r.data;
  return {
    rung,
    help: copyHelp({
      stuckTurns,
      attemptLogged,
      pendingCheck,
      answerKey,
      ...(lockedStopped === undefined ? {} : { lockedStopped }),
      ...(groundingAsks === undefined ? {} : { groundingAsks }),
      ...(asked === undefined ? {} : { personaQuestionsAsked: asked }),
      ...(personaId === undefined ? {} : { personaId }),
      ...(personaPhase === undefined ? {} : { personaPhase }),
      ...practiceFields(r.data),
      ...(r.data.practiceCarriedKey === undefined
        ? {}
        : { practiceCarriedKey: r.data.practiceCarriedKey }),
    }),
  };
}

/**
 * `next` with the session's grounding escalation count set to `asks` (task 4.7): decide's ladder
 * may rebuild the help state without it. Unchanged when `asks` is 0.
 */
export function withGroundingAsks(next: SessionHelp, asks: number): SessionHelp {
  if (asks === 0) return next;
  return { ...next, help: { ...next.help, groundingAsks: asks } };
}

/**
 * The role-play fields of `h`: the count and the persona it belongs to (3.11e), and the stored
 * role-play phase (5.8, ADR-0013).
 */
export function personaFields(
  h: Readonly<HelpState>,
): Pick<HelpState, 'personaQuestionsAsked' | 'personaId' | 'personaPhase'> {
  return {
    ...(h.personaQuestionsAsked === undefined
      ? {}
      : { personaQuestionsAsked: h.personaQuestionsAsked }),
    ...(h.personaId === undefined ? {} : { personaId: h.personaId }),
    ...(h.personaPhase === undefined ? {} : { personaPhase: h.personaPhase }),
  };
}

/**
 * `next` with the persona count, persona id and role-play phase taken from `from` (3.11e, 5.8),
 * each removed when `from` has none. The runner uses it to keep the loaded count on a turn whose
 * reply the student never saw; `skillStep` uses it to carry the count over a rebuilt state.
 */
export function withPersonaCount<T extends { help: HelpState }>(
  next: T,
  from: Readonly<HelpState>,
): T {
  const help: HelpState = { ...next.help, ...personaFields(from) };
  if (from.personaQuestionsAsked === undefined) delete help.personaQuestionsAsked;
  if (from.personaId === undefined) delete help.personaId;
  if (from.personaPhase === undefined) delete help.personaPhase;
  return { ...next, help };
}

/** Nothing stored yet: no value, or the column's default `{}`. */
function nothingStored(raw: unknown): boolean {
  if (raw === undefined || raw === null) return true;
  try {
    return typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length === 0;
  } catch {
    return false;
  }
}

/**
 * `parseSessionHelp`, plus whether a stored blob was there but could not be read (4.6b fix round
 * 1). An unreadable blob may hold `lockedStopped: true`, so the runner then holds the whole reply
 * and does not save over it (never false over a stored true). Nothing stored yet (no value, or the
 * column default `{}`) is readable: a fresh session.
 */
export function loadSessionHelp(raw: unknown): SessionHelp & { unreadable: boolean } {
  let ok: boolean;
  try {
    ok = SessionHelpSchema.safeParse(raw).success;
  } catch {
    ok = false;
  }
  return { ...parseSessionHelp(raw), unreadable: !ok && !nothingStored(raw) };
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
