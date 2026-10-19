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

/**
 * Why the scrub failed closed (task 4.2): a guard-chain cause, a payload the scrub could not walk,
 * or (set by the runner) the step itself throwing, timing out or returning a bad result.
 */
export type ScrubFailureCause =
  | 'empty'
  | 'undeclared'
  | 'out_of_order'
  | 'error'
  | 'invalid_result'
  | 'timeout'
  | 'cancelled'
  | 'verdict'
  | 'rewrite_unverified'
  | 'escalate'
  | 'payload_shape'
  | 'step_error'
  | 'step_timeout'
  | 'step_invalid_result';

/** Only a cause and an error *name*: never a message, reason or text (messages can echo input). */
export interface ScrubFailureDetail {
  guardCause: ScrubFailureCause;
  errorName?: string;
}

/** The scrub could not give a trusted scrubbed input; the turn fails closed (`guard_blocked`). */
export class ScrubFailedError extends Error {
  override readonly name = 'ScrubFailedError';

  constructor(readonly detail: ScrubFailureDetail) {
    super(`scrub failed closed (${detail.guardCause})`, { cause: { ...detail } });
  }
}

/** A step emitted an event that fails TurnEventSchema, or one only the runner may send. */
export class InvalidEventError extends Error {
  override readonly name = 'InvalidEventError';

  constructor(readonly eventType: string) {
    super(`invalid turn event from a step: ${eventType}`);
  }
}
