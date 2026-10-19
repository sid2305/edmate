import type { ErrorCode } from '@edmate/contracts';
import type { StepName } from './spec.js';

/** admit or entitle refused the turn on purpose (rate limit, no access, limit reached, ...). */
export class TurnRejection extends Error {
  override readonly name = 'TurnRejection';

  constructor(
    readonly code: ErrorCode,
    readonly retryable = false,
    message?: string,
  ) {
    super(message ?? `turn rejected: ${code}`);
  }
}

/** generate stopped the turn on purpose (e.g. `turn_cost_exceeded`); not retried. */
export class TurnAbort extends Error {
  override readonly name = 'TurnAbort';

  constructor(
    readonly code: ErrorCode,
    message?: string,
  ) {
    super(message ?? `turn aborted: ${code}`);
  }
}

/** A step a later task builds. Stubs throw this, so each hits its failure policy (fail closed). */
export class StepNotImplementedError extends Error {
  override readonly name = 'StepNotImplementedError';

  constructor(readonly step: StepName | 'scrub') {
    super(`pipeline step "${step}" is not implemented yet`);
  }
}

/** A step emitted an event that fails TurnEventSchema, or one only the runner may send. */
export class InvalidEventError extends Error {
  override readonly name = 'InvalidEventError';

  constructor(readonly eventType: string) {
    super(`invalid turn event from a step: ${eventType}`);
  }
}

/**
 * The turn was cancelled (the client went away, or the caller's `RunTurnOptions.cancel` fired).
 * Internal to generate and the runner: never retried, never sent as its own error code.
 */
export class TurnCancelled extends Error {
  override readonly name = 'TurnCancelled';

  constructor() {
    super('turn cancelled');
  }
}
