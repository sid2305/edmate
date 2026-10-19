// The Guard shape (task 4.1). A guard is built by a factory that closes over whatever it needs
// (locale pack, gateway, persona); the framework only threads `text` and `ctx` through.
import type { GuardResult, Usage } from '@edmate/contracts';
import type { CancelToken } from '../pipeline/clock.js';
import type { GuardPhase } from './order.js';

/** What one guard run returns: its verdict plus the model usage it spent (empty for rule guards). */
export interface GuardRun {
  result: GuardResult;
  usage: Usage[];
}

/**
 * One guard. `Ctx` is phase-specific and owned by the guard tasks (4.2-4.9): scrub and pre guards
 * need locale and entitlement context, post guards the turn context and retrieved chunks.
 * `cancel` fires when the guard's own time slice runs out or the calling step's cancel token
 * (`GuardChainOptions.cancel`) fires; stop work then. The chain stops waiting either way.
 */
export interface Guard<Ctx> {
  readonly name: string;
  readonly phase: GuardPhase;
  run(text: string, ctx: Ctx, cancel: CancelToken): Promise<GuardRun>;
}
