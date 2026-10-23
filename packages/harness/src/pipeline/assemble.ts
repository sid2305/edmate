// The TurnContext the runner hands to decide (step 6 → 7). Built from an allow-list of
// TurnContextSchema's own keys (5.6c, 5.6a typescript-review MEDIUM): a runner-only field added to
// BuiltContext or Entitled later can never fail the strict parse and push the turn to the fallback
// context, and the help state (it holds `answerKey`) never enters TurnContext, which goes to the
// model, events and traces (ADR-0005).
import { type Attempt, type Intent, type TurnContext, TurnContextSchema } from '@edmate/contracts';
import type { BuiltContext, Entitled } from './types.js';

/** TurnContextSchema's keys: the only fields `assemble` copies. */
export const TURN_CONTEXT_KEYS: readonly (keyof TurnContext)[] = Object.freeze(
  Object.keys(TurnContextSchema.shape) as (keyof TurnContext)[],
);

// Compile-time guard: every TurnContext field has a source here, with a compatible value type. A
// new contracts field that neither Entitled nor BuiltContext supplies fails the typecheck instead
// of being dropped, and a value type that drifts between the source and TurnContext fails too
// (type-only; no runtime check — zod already catches it at runtime via TurnContextSchema).
type Supplied = keyof Entitled | keyof BuiltContext | 'intent' | 'attempt';
type Unsupplied = Exclude<keyof TurnContext, Supplied>;
const allSupplied: [Unsupplied] extends [never] ? true : never = true;
void allSupplied;

type SourceAll = Entitled & BuiltContext & { intent: Intent; attempt: Attempt };
type Mismatched = {
  [K in keyof TurnContext]-?: K extends keyof SourceAll
    ? SourceAll[K] extends TurnContext[K]
      ? never
      : K
    : never;
}[keyof TurnContext];
const allTypesMatch: [Mismatched] extends [never] ? true : never = true;
void allTypesMatch;

/**
 * The checked TurnContext, or null when TurnContextSchema refuses it (its refine: retrieved ⊆
 * allowed, same teacher, ids match). A help state that could not be read gives no material
 * (fail closed, as buildContext already does).
 */
export function assemble(
  e: Entitled,
  b: BuiltContext,
  intent: Intent,
  attempt: Attempt,
): TurnContext | null {
  const all: Record<string, unknown> = {
    ...e,
    ...b,
    ...(b.helpStateUnreadable === true ? { retrieved: [] } : {}),
    intent,
    attempt,
  };
  const raw: Record<string, unknown> = {};
  for (const k of TURN_CONTEXT_KEYS) {
    if (Object.hasOwn(all, k) && all[k] !== undefined) raw[k] = all[k];
  }
  const parsed = TurnContextSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
