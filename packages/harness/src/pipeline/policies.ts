// Failure policies: what the "On failure" column of the Turn pipeline spec turns into.
import {
  type Attempt,
  type ErrorCode,
  type Intent,
  type SafetyAlert,
  SafetyAlertSchema,
  type TurnInput,
} from '@edmate/contracts';
import { copyHelp, INITIAL_HELP_STATE } from '../pedagogy/helpState.js';
import { type Clock, type IdSource, isoAt } from './clock.js';
import { TurnAbort, TurnCancelled, TurnRejection } from './errors.js';
import type { TimedResult } from './timeout.js';
import type { BuiltContext, Entitled } from './types.js';

export interface TurnError {
  code: ErrorCode;
  retryable: boolean;
}

/** Step 1: a rejection keeps its code; any other failure (throw, timeout) is `rate_limited`. */
export function admitFailure(r: TimedResult<unknown>): TurnError {
  if (r.status === 'error' && r.error instanceof TurnRejection) {
    return { code: r.error.code, retryable: r.error.retryable };
  }
  return { code: 'rate_limited', retryable: true };
}

/**
 * Step 2, fail closed: a rejection keeps its code (`no_access`, `limit_reached`); a throw or
 * timeout is `no_access` (retryable: the store may be briefly down).
 */
export function entitleFailure(r: TimedResult<unknown>): TurnError {
  if (r.status === 'error' && r.error instanceof TurnRejection) {
    return { code: r.error.code, retryable: r.error.retryable };
  }
  return { code: 'no_access', retryable: true };
}

/** Step 2, fail closed: a schema-valid entitlement that doesn't fit this turn. */
export function entitledMismatch(e: Entitled, input: TurnInput): boolean {
  return (
    e.entitlement.studentId !== input.studentId ||
    e.entitlement.agentId !== input.agentId ||
    e.entitlement.status === 'paused' ||
    e.entitlement.status === 'ended'
  );
}

/** Step 3: a failed scrub or check blocks with a retryable `guard_blocked` (the safe message). */
export const PRE_GUARD_FAILED: TurnError = { code: 'guard_blocked', retryable: true };
/**
 * What commit saves in place of a student message a pre guard blocked (moderationIn, jailbreak;
 * 4.4 fix round). buildContext and preGuard drop it, so blocked text never reaches a later turn.
 */
export const WITHHELD_MESSAGE = '[message withheld]';

/** The placeholder for a withheld input: with the block's code when there is one (fix round 2). */
export const withheldMessage = (code?: string): string =>
  code === undefined ? WITHHELD_MESSAGE : `[message withheld: ${code}]`;

const WITHHELD = /^\[message withheld(?:: ([a-z_]+))?\]$/;

/** Whether `m` is a withheld student message (see withheldMessage). */
export const isWithheld = (m: { role: string; text: string }): boolean =>
  m.role === 'student' && WITHHELD.test(m.text);

/**
 * The code inside a withheld placeholder (task 4.4e, same WITHHELD regex as blockedTurnNote),
 * or undefined when there is none (a codeless placeholder or any other text).
 */
export function withheldCode(text: string): string | undefined {
  return WITHHELD.exec(text)?.[1];
}

/**
 * What the classifiers' earlier-turns window shows for a withheld message (fix round 2, LOW 5):
 * that one was blocked, and why, never its text.
 */
export function blockedTurnNote(text: string): string {
  const code = WITHHELD.exec(text)?.[1];
  return code === undefined ? '[earlier message blocked]' : `[earlier message blocked: ${code}]`;
}

/** Step 3: a guard decided to block. */
export const PRE_GUARD_BLOCKED: TurnError = { code: 'guard_blocked', retryable: false };

/** Step 4's default when `route.onFailure` itself fails. */
export const ROUTE_DEFAULT: { intent: Intent; attempt: Attempt } = {
  intent: 'on_task',
  attempt: 'none',
};

/** Step 5: the alert raised when neither preGuard nor escalate supplied one. No excerpt text. */
export function fallbackAlert(
  input: TurnInput,
  e: Entitled,
  deps: { clock: Clock; ids: IdSource },
): SafetyAlert {
  return SafetyAlertSchema.parse({
    id: deps.ids.next('alert'),
    level: 'alert',
    kind: 'distress',
    studentId: input.studentId,
    teacherId: e.entitlement.teacherId,
    sessionId: input.sessionId,
    excerptRedacted: '',
    createdAt: isoAt(deps.clock.now()),
  });
}

/** Step 6: proceed without retrieval, history or memory, so `decide` takes the `ask_teacher` path. */
export function fallbackContext(input: TurnInput, e: Entitled): BuiltContext {
  return {
    profile: {
      studentId: input.studentId,
      teacherId: e.entitlement.teacherId,
      lang: input.lang,
      mastery: {},
      mistakes: [],
    },
    history: [],
    retrieved: [],
    lockedHit: false,
    helpRung: 0,
    helpState: copyHelp(INITIAL_HELP_STATE),
  };
}

/**
 * Step 8: a `TurnAbort` ends the turn with its own code and is not retried; nor is a
 * `TurnCancelled` (the runner normally sees the cancel first).
 */
export function generateFailure(r: TimedResult<unknown>): TurnError | 'retry' {
  if (r.status === 'error' && r.error instanceof TurnAbort) {
    return { code: r.error.code, retryable: false };
  }
  if (r.status === 'error' && r.error instanceof TurnCancelled) return PROVIDER_ERROR;
  return 'retry';
}

/** Step 8 after the retry also failed: the apologetic error. Also used for runner bugs. */
export const PROVIDER_ERROR: TurnError = { code: 'provider_error', retryable: true };
