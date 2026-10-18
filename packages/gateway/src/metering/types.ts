// Metering types (task 2.4). They live beside the frozen UsageMeter port, not inside it: the
// contracts' Usage has no "unknown" variant, so a call whose usage is unknown, or whose model has
// no price, goes through recordUnmetered instead of being stored as a zero-cost Usage.
import type { Entitlement, Usage } from '@edmate/contracts';

/** Who a call is billed to. Same fields as UsageMeter.record's ctx. */
export interface MeterContext {
  readonly teacherId: string;
  readonly packageId: string;
  readonly studentId: string;
  readonly turnId: string;
  /** subscription, teacher_preview (billed to the teacher) or eval (billed to Edmate). */
  readonly source: Entitlement['source'];
}

/** A fixed reason code, or the model id that has no price. Never request content. */
export type UnmeteredReason = 'no_usage_reported' | `unpriced_model:${string}`;

export interface UnmeteredUsage extends MeterContext {
  readonly reason: UnmeteredReason;
  /** The tier the call asked for (embed has no tier in the port; the router serves it on main). */
  readonly tier: Usage['tier'];
  /** Known only when the provider reported usage (the unpriced case). */
  readonly model?: string;
  /** Known only when the provider reported usage (the unpriced case). */
  readonly tokens?: { readonly inputTokens: number; readonly outputTokens: number };
}

/**
 * Where metering writes. `record` is exactly the frozen `UsageMeter.record`, so an adapter that
 * implements this sink is also a UsageMeter. Only ids, the model, the tier, counts and a reason
 * code reach a sink: never the request's system prompt or messages.
 */
export interface MeterSink {
  record(u: Usage, ctx: MeterContext): Promise<void>;
  /** Usage unknown, or known but unpriced: never stored as a zero-cost row. */
  recordUnmetered(u: UnmeteredUsage): Promise<void>;
}

/** A loud, structured log line. Names a model or a method, never student data. */
export type MeteringWarning =
  | { readonly event: 'metering.unpriced_model'; readonly model: string }
  | {
      readonly event: 'metering.failed';
      readonly method: 'stream' | 'generateObject' | 'embed';
      /** The error's class name only; its message could quote a driver's parameters. */
      readonly error: string;
    };
