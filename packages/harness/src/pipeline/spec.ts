// The eleven steps of build plan § Turn pipeline spec: order, timeouts and failure policies.

export const STEP_NAMES = [
  'admit',
  'entitle',
  'preGuard',
  'route',
  'escalate',
  'buildContext',
  'decide',
  'generate',
  'postGuard',
  'meter',
  'commit',
] as const;
export type StepName = (typeof STEP_NAMES)[number];

export interface StepSpec {
  /** Position in the spec table (1-11). */
  n: number;
  /** Per-step budget on the injected clock; `null` = async (background, never blocks the reply). */
  timeoutMs: number | null;
  /** The spec table's "On failure" column, verbatim. */
  onFailure: string;
}

export const STEP_SPEC: Readonly<Record<StepName, StepSpec>> = {
  admit: { n: 1, timeoutMs: 50, onFailure: '`error` event; no model call' },
  entitle: { n: 2, timeoutMs: 50, onFailure: 'Fail closed: `no_access` or `limit_reached`' },
  // One budget shared by the regex PII scrub and the checks that follow it.
  preGuard: { n: 3, timeoutMs: 400, onFailure: 'Fail closed: safe message' },
  route: {
    n: 4,
    timeoutMs: 400,
    onFailure: 'Default `on_task` / `none`; distress keywords still escalate',
  },
  escalate: { n: 5, timeoutMs: 200, onFailure: 'Alert retried until delivered' },
  buildContext: {
    n: 6,
    timeoutMs: 300,
    onFailure: 'Proceed without retrieval → `ask_teacher` path',
  },
  decide: { n: 7, timeoutMs: 50, onFailure: 'Fall back to `ask`' },
  // Per attempt: the retry gets its own 15 s.
  generate: {
    n: 8,
    timeoutMs: 15_000,
    onFailure: 'One retry on the fallback model; then apologetic error',
  },
  postGuard: { n: 9, timeoutMs: 2_000, onFailure: '`rewrite` once; else safe reply' },
  meter: { n: 10, timeoutMs: null, onFailure: 'Queue; never blocks' },
  commit: { n: 11, timeoutMs: null, onFailure: 'Queue; never blocks' },
};

/** admit: "rate limit (10 turns/min/student)"; every source except `eval` (lead answer Q3). */
export const RATE_LIMIT_TURNS = 10;
export const RATE_LIMIT_WINDOW_MS = 60_000;
/** entitle: `PackageConfig.dailyMessageLimit` is a rolling 24-hour window (subscriptions only). */
export const MESSAGE_WINDOW_MS = 86_400_000;

/** "Alert retried until delivered": backoff starts here and doubles each failed attempt. */
export const ALERT_RETRY_START_MS = 250;
/** Backoff ceiling; there is no attempt limit (durable delivery is the 4.3 alert worker). */
export const ALERT_RETRY_MAX_MS = 30_000;
/** One `AlertSink.raise` attempt that hangs this long counts as failed and is retried. */
export const ALERT_ATTEMPT_TIMEOUT_MS = 5_000;
