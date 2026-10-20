// Test-only builders for the pedagogy tests (not exported from the package). Built from the
// contracts fixtures: the paid demo package (helpCeiling 4, finalAnswers after_attempt), its
// subscription entitlement and one scored teacher_note chunk, so the default turn is covered.
import type { Entitlement, PackageConfig, TurnContext, TurnInput } from '@edmate/contracts';
import { demoChunkScored, turnContextFull } from '@edmate/contracts/fixtures';
import type { HelpState } from './helpState.js';

export interface CtxOverrides extends Partial<Omit<TurnContext, 'pkg' | 'entitlement'>> {
  pkg?: Partial<PackageConfig>;
  entitlement?: Partial<Entitlement>;
}

/** A schema-valid turn context: covered, not locked, rung 0, on_task, no attempt, no persona. */
export function ctxWith(o: CtxOverrides = {}): TurnContext {
  const { pkg, entitlement, ...rest } = o;
  const base: TurnContext = { ...turnContextFull };
  delete base.persona;
  return {
    ...base,
    history: [],
    retrieved: [demoChunkScored],
    lockedHit: false,
    helpRung: 0,
    intent: 'on_task',
    attempt: 'none',
    ...rest,
    pkg: { ...turnContextFull.pkg, ...pkg },
    entitlement: { ...turnContextFull.entitlement, ...entitlement },
  };
}

export function helpWith(o: Partial<HelpState> = {}): HelpState {
  return {
    stuckTurns: 0,
    attemptLogged: false,
    pendingCheck: false,
    answerKey: [],
    lockedStopped: false,
    ...o,
  };
}

export function turnOf(
  kind: TurnInput['kind'] = 'message',
  skill?: TurnInput['skill'],
): Pick<TurnInput, 'kind' | 'skill'> {
  return skill === undefined ? { kind } : { kind, skill };
}

/** Freezes a value and everything reachable from it, so any mutation throws in strict mode. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}
