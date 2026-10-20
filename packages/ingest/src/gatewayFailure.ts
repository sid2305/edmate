// Task 5.11a: classifies a thrown gateway failure the same way whether it came from the real
// `@edmate/gateway` package or from `ScriptedGateway` (packages/harness/src/testing). Ingest does
// not depend on the gateway package (rule: harness/ingest import only contracts + their own
// modules), so the real gateway's `GatewayError` is duck-typed here rather than imported: any
// thrown value with a `code` that parses under `ErrorCodeSchema` and a boolean `retryable` is
// treated the same as a `GatewayError` would be.
import { ErrorCodeSchema } from '@edmate/contracts';
import { ZodError } from 'zod';

export type DraftFailureCode = 'validation' | 'provider_error';

export interface DraftFailureClassification {
  readonly code: DraftFailureCode;
  readonly retryable: boolean;
}

/** A deterministic schema failure: not retryable, names neither model output nor teacher text. */
const SCHEMA_FAILED: DraftFailureClassification = { code: 'validation', retryable: false };

/** Today's default for anything we cannot classify: treat it as a transient provider failure. */
const UNKNOWN_FAILURE: DraftFailureClassification = { code: 'provider_error', retryable: true };

function hasGatewayErrorShape(
  e: unknown,
): e is { code: unknown; retryable: boolean } {
  return (
    e instanceof Error &&
    'code' in e &&
    'retryable' in e &&
    typeof (e as { retryable: unknown }).retryable === 'boolean'
  );
}

/**
 * Classifies a value thrown by a `ModelGateway` call (either the real gateway or
 * `ScriptedGateway`) into the drafter's own validation/provider_error split.
 *
 * - A `ZodError` (ScriptedGateway's generateObject throws this on a schema mismatch) is a
 *   deterministic schema failure: validation, not retryable.
 * - An `Error` whose `code` parses under the contracts `ErrorCodeSchema` and whose `retryable` is
 *   a boolean (the real gateway's `GatewayError` shape) maps `code === 'validation'` to the same
 *   schema failure, and any other code to `provider_error`, keeping that error's own `retryable`.
 * - Anything else (an unrecognised shape, or a non-Error throw) stays `provider_error`, retryable,
 *   same as before this task.
 */
export function classifyGatewayFailure(e: unknown): DraftFailureClassification {
  if (e instanceof ZodError) return SCHEMA_FAILED;
  if (hasGatewayErrorShape(e)) {
    const parsedCode = ErrorCodeSchema.safeParse(e.code);
    if (parsedCode.success) {
      if (parsedCode.data === 'validation') return SCHEMA_FAILED;
      return { code: 'provider_error', retryable: e.retryable };
    }
  }
  return UNKNOWN_FAILURE;
}
