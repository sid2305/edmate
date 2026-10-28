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

/**
 * Pilot policy (18 Oct 2026 decision, docs/decisions/log.md): decide reports this to the
 * background log, by name only, whenever the composer had to clamp a pinned agent's reply
 * language to English because `agent.languages` was not exactly English-only. Fixed text, no
 * agent or student content.
 */
export class PilotLanguageClamped extends HarnessError {
  override readonly name = 'PilotLanguageClamped';

  constructor() {
    super('agent languages were not English-only; the composer clamped the reply to English');
  }
}

/** A step a later task builds. Stubs throw this, so each hits its failure policy (fail closed). */
export class StepNotImplementedError extends HarnessError {
  override readonly name = 'StepNotImplementedError';

  constructor(readonly step: StepName | 'scrub') {
    super(`pipeline step "${step}" is not implemented yet`);
  }
}

/**
 * Why the scrub failed closed (task 4.2): a guard-chain cause, a payload the scrub could not walk,
 * (set by the runner) the step itself throwing, timing out or returning a bad result, or (task
 * 4.2b) an attachment present on the turn.
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
  | 'step_invalid_result'
  | 'attachment';

/** Only a cause and an error *name*: never a message, reason or text (messages can echo input). */
export interface ScrubFailureDetail {
  guardCause: ScrubFailureCause;
  errorName?: string;
}

/**
 * The scrub could not give a trusted scrubbed input; the turn fails closed (`guard_blocked`).
 * A HarnessError: its message is fixed text plus the cause code, so the background log may keep it.
 * Most causes are a framework bug; `'attachment'` is the one deliberate, by-design refusal (task
 * 4.2b, no OCR/vision pipeline exists yet) — the turn still fails closed the same way, but it is
 * not reported as a bug.
 */
export class ScrubFailedError extends HarnessError {
  override readonly name = 'ScrubFailedError';

  constructor(readonly detail: ScrubFailureDetail) {
    super(`scrub failed closed (${detail.guardCause})`, { cause: { ...detail } });
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

/**
 * The postGuard step failed (threw, timed out or returned a malformed result) and the runner sent
 * the safe reply (4.5). Carries only the kind and the underlying error's name.
 */
export class PostGuardStepFailed extends HarnessError {
  override readonly name = 'PostGuardStepFailed';

  constructor(
    readonly kind: 'error' | 'timeout' | 'invalid_result',
    readonly causeName?: string,
  ) {
    super(`postGuard failed: ${kind}` + (causeName === undefined ? '' : ` (${causeName})`));
  }
}

/**
 * grounding's judge gave no answer (missing, failed, timed out, at the cost ceiling), so the turn
 * got the safe reply (task 4.7 fix round 1). A metric, not a failure: fixed text, no turn text.
 */
export class GroundingJudgeUnavailable extends HarnessError {
  override readonly name = 'GroundingJudgeUnavailable';

  constructor() {
    super('grounding judge unavailable: sent the safe reply');
  }
}

/**
 * adviceGuard's judge gave no answer (outage, timeout, cost ceiling) and the turn got its fixed
 * fallback or an unverified rewrite's fixed fallback (task 4.8). `cause` tells apart a PII-scrub
 * failure, the pre-check judge call itself failing, and the rewrite's own verify call giving no
 * answer (4.8b item 8, 4.8d item a; mirrors `GroundingEscalationLost`'s `causeName`). A metric,
 * not a failure: fixed text, no turn text.
 */
export class AdviceJudgeUnavailable extends HarnessError {
  override readonly name = 'AdviceJudgeUnavailable';

  constructor(override readonly cause: 'scrub' | 'judge' | 'verify' = 'judge') {
    super(`advice judge unavailable: sent the fixed advice fallback (${cause})`);
  }
}

/**
 * adviceGuard's rewrite call itself threw (not just came back unusable): the turn got the fixed
 * fallback (4.8b item 8). A metric, not a failure: fixed text, no turn text.
 */
export class AdviceRewriteFailed extends HarnessError {
  override readonly name = 'AdviceRewriteFailed';

  constructor() {
    super('advice rewrite failed: sent the fixed advice fallback');
  }
}

/**
 * A regulated-subject agent's locale pack has no disclaimer for its subject, so the turn used the
 * generic one (task 4.8 fix round 1). A metric, not a failure: the subject code only, no turn text.
 */
export class DisclaimerLocaleGap extends HarnessError {
  override readonly name = 'DisclaimerLocaleGap';

  constructor(readonly subject: 'investing' | 'health' | 'law') {
    super(`no locale disclaimer for regulated subject ${subject}: used the generic one`);
  }
}

/**
 * A grounding escalation could open no TeacherQuestion: the live open and commit's fallback both
 * failed (task 4.7 fix round 1). The cause's error name only, never text.
 */
export class GroundingEscalationLost extends HarnessError {
  override readonly name = 'GroundingEscalationLost';

  constructor(readonly causeName: string) {
    super(`grounding escalation lost: no TeacherQuestion opened (${causeName})`);
  }
}

/** Usage for a model with no valid price: traced and reported, never metered as free. */
export class UnpricedUsage extends HarnessError {
  override readonly name = 'UnpricedUsage';

  constructor(readonly model: string) {
    super(`usage for an unpriced model: ${model.slice(0, 100)}`);
  }
}

/**
 * The session's stored help-state blob could not be parsed (it may hold `lockedStopped: true`
 * from an earlier turn, 4.6b amendment); the turn runs with the whole reply held back and its
 * commit carries no `next`, so the stored state is left untouched (4.6b fix round 1 LEAD
 * DECISION). Reported once per turn, by kind only, never the stored blob (4.6c).
 */
export class HelpStateUnreadable extends HarnessError {
  override readonly name = 'HelpStateUnreadable';

  constructor() {
    super('session help state could not be read; holding this turn closed');
  }
}
