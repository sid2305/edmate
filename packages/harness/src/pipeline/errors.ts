import type { ErrorCode } from '@edmate/contracts';
import type { StepName } from './spec.js';

/**
 * The base of every error the harness itself writes. Its message is built from fixed text, codes
 * and ids only, so the background log may record it. Any other error (provider, port, store,
 * tool) is foreign: its message can quote prompt or student text, so only its name is logged.
 * The base keeps the name `Error`; subclasses set their own.
 */
export class HarnessError extends Error {}

/** The name of any thrown value, for reports that must not carry a foreign message. */
export function errorName(e: unknown): string {
  return e instanceof Error ? e.name : typeof e;
}

/** admit or entitle refused the turn on purpose (rate limit, no access, limit reached, ...). */
export class TurnRejection extends HarnessError {
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
export class TurnAbort extends HarnessError {
  override readonly name = 'TurnAbort';

  constructor(
    readonly code: ErrorCode,
    message?: string,
  ) {
    super(message ?? `turn aborted: ${code}`);
  }
}

/** A step a later task builds. Stubs throw this, so each hits its failure policy (fail closed). */
export class StepNotImplementedError extends HarnessError {
  override readonly name = 'StepNotImplementedError';

  constructor(readonly step: StepName | 'scrub') {
    super(`pipeline step "${step}" is not implemented yet`);
  }
}

/** A step emitted an event that fails TurnEventSchema, or one only the runner may send. */
export class InvalidEventError extends HarnessError {
  override readonly name = 'InvalidEventError';

  constructor(readonly eventType: string) {
    super(`invalid turn event from a step: ${eventType}`);
  }
}

/**
 * The turn was cancelled (the client went away, or the caller's `RunTurnOptions.cancel` fired).
 * Internal to generate and the runner: never retried, never sent as its own error code.
 */
export class TurnCancelled extends HarnessError {
  override readonly name = 'TurnCancelled';

  constructor() {
    super('turn cancelled');
  }
}

/**
 * A generate attempt failed (reported to `finished.background`). Carries only the failure kind
 * and the underlying error's name, never its message.
 */
export class GenerateAttemptFailed extends HarnessError {
  override readonly name = 'GenerateAttemptFailed';

  constructor(
    readonly attempt: 'primary' | 'fallback',
    readonly kind: 'error' | 'timeout' | 'invalid_result' | 'invalid_event',
    readonly causeName?: string,
  ) {
    super(
      `generate ${attempt} attempt failed: ${kind}` +
        (causeName === undefined ? '' : ` (${causeName})`),
    );
  }
}

/** Usage for a model with no valid price: traced and reported, never metered as free. */
export class UnpricedUsage extends HarnessError {
  override readonly name = 'UnpricedUsage';

  constructor(readonly model: string) {
    super(`usage for an unpriced model: ${model.slice(0, 100)}`);
  }
}
