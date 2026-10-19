// The turn pipeline runner (build plan § Turn pipeline spec):
//   admit → entitle → scrub → [ preGuard ‖ route ‖ buildContext ] → escalate | decide → generate
//   → teacher_question (ask_teacher) → postGuard → done, then meter ‖ commit in the background,
//   then the trace.
//
// Task 3.7 adds: the per-turn gateways billed to the entitlement (turnGateway.ts), usage priced
// as it streams with the per-turn cost ceiling, `replace ''` before an error whenever text was
// shown, cancellation (the consumer detaching, or `RunTurnOptions.cancel`), the TeacherQuestion
// opened before `done`, and every `finished.background` failure logged (ids and error only).
import {
  type Intent,
  type PedagogyDecision,
  type SafetyAlert,
  type SourceRef,
  type TurnContext,
  TurnContextSchema,
  type TurnEvent,
  TurnEventSchema,
  type TurnInput,
  type TurnTrace,
  type Usage,
  UsageSchema,
} from '@edmate/contracts';
import type { z } from 'zod';
import type { HelpState } from '../pedagogy/helpState.js';
import { logBackground } from './backgroundLog.js';
import { type Cancel, cancelSource, type CancelToken, isoAt, linkCancel } from './clock.js';
import {
  errorName,
  GenerateAttemptFailed,
  HarnessError,
  InvalidEventError,
  PostGuardStepFailed,
  ScrubFailedError,
  UnpricedUsage,
} from './errors.js';
import { EventQueue } from './events.js';
import { ceilingOf, TurnCost } from './generate/costCeiling.js';
import {
  admitFailure,
  entitledMismatch,
  entitleFailure,
  fallbackAlert,
  fallbackContext,
  generateFailure,
  PRE_GUARD_BLOCKED,
  PRE_GUARD_FAILED,
  PROVIDER_ERROR,
  ROUTE_DEFAULT,
  type TurnError,
} from './policies.js';
import {
  BuiltContextSchema,
  DecideResultSchema,
  EntitledSchema,
  EscalateResultSchema,
  GenerateResultSchema,
  PostGuardResultSchema,
  PreGuardResultSchema,
  RouteFallbackSchema,
  RouteResultSchema,
  ScrubbedSchema,
} from './results.js';
import {
  ALERT_ATTEMPT_TIMEOUT_MS,
  ALERT_RETRY_MAX_MS,
  ALERT_RETRY_START_MS,
  STEP_SPEC,
  type StepName,
  STREAM_CLOSE_SETTLE_MS,
  TEACHER_QUESTION_TIMEOUT_MS,
} from './spec.js';
import { openTeacherQuestion } from './teacherQuestion.js';
import { runWithTimeout, type TimedResult } from './timeout.js';
import { TraceBuilder } from './trace.js';
import { billingFor, buildTurnGateway, refusingGateway, turnPolicies } from './turnGateway.js';
import type {
  BackgroundTask,
  BuiltContext,
  CommitRecord,
  DecideResult,
  Emit,
  Entitled,
  GenerateResult,
  PipelineDeps,
  Scrubbed,
  StepEnv,
  Steps,
  TurnBilling,
  TurnGateway,
  TurnRun,
  TurnRunResult,
  UsageRecorder,
} from './types.js';

/**
 * Sent only when the escalate step and `fallbackReplies.distress` both give no text. Built in (not
 * injected) so a distressed student always gets a caring reply. Country-neutral: no numbers or
 * country names; the locale pack's helplines come through the normal paths.
 */
export const LAST_RESORT_DISTRESS_REPLY =
  "I'm really glad you told me, and I'm sorry it's this hard right now. You matter. " +
  "I'm an AI, so please reach out to someone you trust right now, like a friend, " +
  'family member, teacher or counsellor. If you are in danger or might hurt yourself, ' +
  'contact your local emergency services now.';

export interface RunTurnOptions {
  deps: PipelineDeps;
  steps: Steps;
  /**
   * Cancels the turn (the CLI's Ctrl-C), the same as the consumer calling `return()` on
   * `events`: generate stops at once and is not retried; postGuard and teacher_question are
   * skipped; meter, commit (outcome `error`) and the trace still run.
   */
  cancel?: Cancel;
}

/** Runs one student turn. The stream ends with exactly one `done` or `error`; `finished` never rejects. */
export function runTurn(input: TurnInput, opts: RunTurnOptions): TurnRun {
  const queue = new EventQueue<TurnEvent>();
  const background: TurnRunResult['background'] = [];
  const cancel = cancelSource();
  queue.onDetach(() => cancel.cancel());
  opts.cancel?.onCancel(() => cancel.cancel());
  const turn = new Turn(input, opts.deps, opts.steps, queue, background, cancel.token);
  const finished = turn
    .run()
    .catch((error: unknown): TurnRunResult => {
      // A runner bug: never leave the stream hanging.
      background.push({ task: 'runner', error });
      turn.endWithErrorIfOpen(PROVIDER_ERROR);
      return { trace: null, background };
    })
    .then((result) => {
      logBackground(opts.deps.log, { ...turn.ids, ...ids(input) }, result.background);
      return result;
    });
  return { events: queue, finished };
}

/** The input's ids as given (backgroundLog checks each before logging it). */
function ids(input: TurnInput): { sessionId: unknown; agentId: unknown; studentId: unknown } {
  return { sessionId: input.sessionId, agentId: input.agentId, studentId: input.studentId };
}

/** generate's outcome when the turn was cancelled during or before it. */
const CANCELLED = 'cancelled';

/** A step result that passed its schema, or why it didn't. */
type Checked<T> = { ok: true; value: T; ms: number } | { ok: false; ms: number; error?: unknown };

function check<T>(r: TimedResult<unknown>, schema: z.ZodType<T>): Checked<T> {
  if (r.status !== 'ok') {
    return r.status === 'error' ? { ok: false, ms: r.ms, error: r.error } : { ok: false, ms: r.ms };
  }
  const parsed = schema.safeParse(r.value);
  return parsed.success
    ? { ok: true, value: parsed.data, ms: r.ms }
    : { ok: false, ms: r.ms, error: parsed.error };
}

function timeoutOf(name: StepName): number {
  const ms = STEP_SPEC[name].timeoutMs;
  if (ms === null) throw new HarnessError(`step ${name} has no timeout`);
  return ms;
}

class Turn {
  private readonly trace = new TraceBuilder();
  // Drawn at the start of run(), so a failing IdSource ends the stream instead of throwing here.
  private turnId = '';
  private messageId = '';
  private receivedAt = '';
  private terminated = false;
  /** What meter and commit see: the scrubbed input once the scrub passed; never unscrubbed text. */
  private safeInput: TurnInput;
  /** Every usage the turn saw, against the per-turn ceiling. Set after entitle. */
  private cost: TurnCost;
  /** Usage for the `meter` step: step-reported usage plus usage from unmetered gateways. */
  private readonly meterable: Usage[] = [];
  /** Background work steps handed over (stream closes); settled, bounded, before `finished`. */
  private readonly pending: Promise<void>[] = [];
  /** Who the turn's model calls are billed to; set after entitle, from the entitlement only. */
  private billing: TurnBilling | null = null;
  /** The gateway for preGuard, route and postGuard (the agent's full policy). */
  private guardGateway: TurnGateway | null = null;
  /** Streamed text is on the student's screen and no `replace` cleared it yet. */
  private shown = false;
  /** A post guard's escalate text (4.5): saved with the turn, never shown. */
  private escalatedText: string | undefined;

  constructor(
    private readonly input: TurnInput,
    private readonly deps: PipelineDeps,
    private readonly steps: Steps,
    private readonly queue: EventQueue<TurnEvent>,
    private readonly background: TurnRunResult['background'],
    private readonly cancelled: CancelToken,
  ) {
    this.safeInput = withoutText(input);
    this.cost = new TurnCost(deps.priceUsage, 0);
  }

  get ids(): { turnId: string } {
    return { turnId: this.turnId };
  }

  // ---- events -------------------------------------------------------------------------------

  private send(e: TurnEvent): void {
    if (this.terminated) throw new HarnessError(`event after the end of the turn: ${e.type}`);
    this.queue.push(TurnEventSchema.parse(e));
  }

  private end(e: Extract<TurnEvent, { type: 'done' | 'error' }>): void {
    this.send(e);
    this.terminated = true;
    this.queue.close();
  }

  private endWithError(err: TurnError): void {
    this.end({ type: 'error', code: err.code, retryable: err.retryable });
  }

  endWithErrorIfOpen(err: TurnError): void {
    if (this.terminated) return;
    this.terminated = true;
    // Unguarded shown text never stays on screen, even when the runner itself failed.
    if (this.shown) this.queue.push({ type: 'replace', text: '' });
    this.queue.push({ type: 'error', code: err.code, retryable: err.retryable });
    this.queue.close();
  }

  private done(): void {
    this.end({ type: 'done', messageId: this.messageId, usage: this.trace.usage });
  }

  /** An emitter for one step attempt: validates, drops late events, reports invalid ones. */
  private emitter(cancel: CancelToken, state: { invalid: boolean }): Emit {
    return (e) => {
      if (cancel.cancelled || this.terminated) return;
      const parsed = TurnEventSchema.safeParse(e);
      if (!parsed.success || parsed.data.type === 'done' || parsed.data.type === 'error') {
        state.invalid = true;
        throw new InvalidEventError(parsed.success ? parsed.data.type : 'unparseable');
      }
      // A `replace ''` also tells the client to drop skill events shown so far (sse.ts).
      if (parsed.data.type === 'token' || parsed.data.type === 'skill') this.shown = true;
      this.queue.push(parsed.data);
    };
  }

  /**
   * Before postGuard replaces the reply (4.5): `replace ''` always, so skill events and sources
   * shown with the rejected draft clear too, not only streamed text.
   */
  private clearAll(): void {
    this.shown = false;
    this.send({ type: 'replace', text: '' });
  }

  /** Clears unguarded streamed text off the student's screen (before a retry or an error). */
  private clearShown(): void {
    if (!this.shown) return;
    this.shown = false;
    this.send({ type: 'replace', text: '' });
  }

  // ---- step helpers -------------------------------------------------------------------------

  /**
   * A step's environment. Without a turn gateway (admit, entitle) every model call is refused
   * and recording usage throws: those steps make no model call.
   */
  private env(
    input: TurnInput,
    cancel: CancelToken,
    tg: TurnGateway | null = this.guardGateway,
    task: BackgroundTask = 'runner',
  ): StepEnv {
    return {
      input,
      deps: this.deps,
      cancel,
      turnId: this.turnId,
      gateway: tg === null ? refusingGateway('before entitle') : tg.gateway,
      usage: this.recorder(tg, task),
      report: (error) => this.background.push({ task, error }),
      track: (settled) => {
        this.pending.push(
          settled.then(
            () => undefined,
            () => undefined,
          ),
        );
      },
    };
  }

  /**
   * Prices each usage as it arrives, keeps it (trace, `done`, meter if unmetered), checks the
   * ceiling. Unpriced usage stays in the trace (its tokens are real) but is never metered as
   * free: it is reported as UnpricedUsage instead (2.4's meter records it as unpriced).
   */
  private recorder(tg: TurnGateway | null, task: BackgroundTask): UsageRecorder {
    return {
      record: (u) => {
        if (tg === null) throw new HarnessError('no model usage before entitle');
        const { usage, priced } = this.cost.priceOne(UsageSchema.parse(u));
        this.trace.addUsage([usage]);
        if (!priced) this.background.push({ task, error: new UnpricedUsage(usage.model) });
        else if (!tg.metered) this.meterable.push(usage);
        this.cost.assertWithin();
      },
      checkBeforeCall: () => this.cost.assertRoomForCall(),
    };
  }

  /** Usage a step reported in its result: traced, counted against the ceiling, and metered. */
  private addReported(usage: readonly Usage[]): void {
    this.trace.addUsage(usage);
    for (const u of usage) {
      this.cost.addReported(u);
      this.meterable.push({ ...u });
    }
  }

  private timed<T>(
    input: TurnInput,
    ms: number,
    fn: (env: StepEnv) => Promise<T>,
  ): Promise<TimedResult<T>> {
    return runWithTimeout((cancel) => fn(this.env(input, cancel)), ms, this.deps.clock);
  }

  /**
   * Billing, the cost ceiling and the guards' gateway, once entitle passed. A gateway that
   * can't be built is reported and replaced by one that refuses every call, so each step meets
   * its own failure policy (and distress keywords still escalate).
   */
  private startBilling(e: Entitled): void {
    this.billing = billingFor(e.entitlement, this.turnId);
    const ceiling = ceilingOf(this.deps.maxTurnCostMicroUsd);
    if (!ceiling.valid) {
      this.background.push({
        task: 'runner',
        error: new HarnessError('maxTurnCostMicroUsd is invalid; every model call is refused'),
      });
    }
    this.cost = new TurnCost(this.deps.priceUsage, ceiling.value);
    try {
      this.guardGateway = buildTurnGateway(
        this.deps,
        turnPolicies(e.agent.modelPolicy).guards,
        this.billing,
      );
    } catch (error) {
      this.background.push({ task: 'runner', error });
      this.guardGateway = { gateway: refusingGateway('no turn gateway'), metered: true };
    }
  }

  // ---- the turn -----------------------------------------------------------------------------

  async run(): Promise<TurnRunResult> {
    const { input, steps } = this;
    this.turnId = this.deps.ids.next('turn');
    this.messageId = this.deps.ids.next('message');
    this.receivedAt = isoAt(this.deps.clock.now());

    // 1. admit: no model call, no later step, no trace.
    const admitted = await this.timed(input, timeoutOf('admit'), (env) => steps.admit(env));
    if (admitted.status !== 'ok') {
      this.endWithError(admitFailure(admitted));
      return { trace: null, background: this.background };
    }

    // 2. entitle: fail closed.
    const ent = await this.timed(input, timeoutOf('entitle'), (env) => steps.entitle(env));
    const entitled = check(ent, EntitledSchema);
    if (!entitled.ok) {
      this.endWithError(
        ent.status === 'ok' ? { code: 'no_access', retryable: false } : entitleFailure(ent),
      );
      return { trace: null, background: this.background };
    }
    if (entitledMismatch(entitled.value, input)) {
      this.endWithError({ code: 'no_access', retryable: false });
      return { trace: null, background: this.background };
    }
    const e = entitled.value;
    this.trace.step('admit', admitted.ms, 'ok');
    this.trace.step('entitle', ent.ms, 'ok');
    this.startBilling(e);

    // In-process keyword check on the raw text, before the scrub can redact any word it needs
    // (no model call). Only the boolean is kept: the raw text is never stored, traced or reported.
    // A hit escalates at step 5 (or right away if the scrub fails).
    const rawDistress = this.distressHit(input, 'raw');

    // 3a. Regex PII scrub, first; its time counts against step 3's one budget.
    const budget = timeoutOf('preGuard');
    const scRaw = await this.timed(input, budget, (env) => steps.scrub(env, e));
    const sc = check(scRaw, ScrubbedSchema);
    const scrubbed = sc.ok ? applyScrub(input, sc.value) : null;
    if (scrubbed !== null) this.safeInput = scrubbed;
    if (!sc.ok || scrubbed === null) {
      this.trace.step('preGuard', sc.ms, 'failed');
      // Reported, never dropped: a failed scrub is a guard bug or outage. Ids and names only.
      this.background.push({ task: 'runner', error: scrubFailure(scRaw) });
      // A raw-text keyword hit escalates without running any step on the raw text.
      if (rawDistress) {
        return this.sendEscalation(e, null, this.buildAlert(input, e, undefined), {
          replyText: LAST_RESORT_DISTRESS_REPLY,
          outcome: 'fallback',
          ms: 0,
        });
      }
      this.endWithError(PRE_GUARD_FAILED);
      return this.finish(e, { outcome: 'blocked', input: null }, 'on_task', 'redirect');
    }
    this.trace.addGuards(sc.value.guards);

    // 3b, 4, 6: concurrent. Each wrapper never rejects; none of them may emit events.
    const [pgRaw, rtRaw, bcRaw] = await Promise.all([
      this.timed(scrubbed, budget - sc.ms, (env) => steps.preGuard(env, e)),
      this.timed(scrubbed, timeoutOf('route'), (env) => steps.route.run(env, e)),
      this.timed(scrubbed, timeoutOf('buildContext'), (env) => steps.buildContext(env, e)),
    ]);

    const pg = check(pgRaw, PreGuardResultSchema);
    this.trace.step('preGuard', sc.ms + pg.ms, pg.ok ? 'ok' : 'failed');
    if (pg.ok) {
      this.trace.addGuards(pg.value.guards);
      this.addReported(pg.value.usage);
    }

    const rt = check(rtRaw, RouteResultSchema);
    let intent: Intent;
    let attempt: TurnContext['attempt'];
    if (rt.ok) {
      ({ intent, attempt } = rt.value);
      this.addReported(rt.value.usage);
      this.trace.step('route', rt.ms, 'ok');
    } else {
      const fb = this.routeFallback(scrubbed, e);
      ({ intent, attempt } = fb);
      this.trace.step('route', rt.ms, fb.outcome);
    }

    const bc = check(bcRaw, BuiltContextSchema);
    this.trace.step('buildContext', bc.ms, bc.ok ? 'ok' : 'fallback');

    // 5. Escalate beats block: a distressed student always gets the caring reply.
    const preAlert = pg.ok && pg.value.result === 'escalate' ? pg.value.alert : undefined;
    // A failed preGuard means no classifier verdict: the keyword check still runs. A hit on the
    // raw text (before the scrub) always counts.
    if (
      preAlert !== undefined ||
      intent === 'distress' ||
      rawDistress ||
      (!pg.ok && this.distressHit(scrubbed, 'scrubbed'))
    ) {
      return this.escalate(scrubbed, e, preAlert);
    }
    if (!pg.ok || pg.value.result === 'block') {
      this.endWithError(pg.ok ? PRE_GUARD_BLOCKED : PRE_GUARD_FAILED);
      return this.finish(e, { outcome: 'blocked', input: scrubbed, intent }, intent, 'redirect');
    }

    // Assemble the TurnContext; its refine (retrieved ⊆ allowed, same teacher, ids match) is the
    // last check before decide. A failure is treated as a buildContext failure.
    let built = bc.ok ? bc.value : fallbackContext(scrubbed, e);
    let ctx = assemble(e, built, intent, attempt);
    if (ctx === null && bc.ok) {
      this.trace.outcome('buildContext', 'fallback');
      built = fallbackContext(scrubbed, e);
      ctx = assemble(e, built, intent, attempt);
    }
    if (ctx === null) {
      this.endWithError({ code: 'no_access', retryable: false });
      return this.finish(e, { outcome: 'error', input: scrubbed, intent }, intent, 'redirect');
    }

    // 7. decide with the help state that came with this context; fall back to `ask`.
    const decided = await this.decide(scrubbed, ctx, built.helpState);
    if (decided === null) {
      this.endWithError(PROVIDER_ERROR);
      return this.finish(
        e,
        { outcome: 'error', input: scrubbed, intent, context: ctx },
        intent,
        'redirect',
      );
    }
    const { decision } = decided;
    const base = {
      input: scrubbed,
      intent,
      context: ctx,
      decision,
      next: decided.next,
      promptPack: decided.promptPack,
    };

    // 8. generate: one retry on the fallback model; a TurnAbort or a cancel is final. Text the
    // student saw is cleared before the error, so unguarded partial text never stays on screen.
    const gen = await this.generate(scrubbed, ctx, decision, decided.sources);
    if (gen === CANCELLED || 'code' in gen) {
      this.clearShown();
      this.endWithError(gen === CANCELLED ? PROVIDER_ERROR : gen);
      return this.finish(e, { ...base, outcome: 'error' }, intent, decision.move);
    }

    // The TeacherQuestion is opened before done, so its id reaches the student (lead answer Q3).
    const questionId =
      decision.move === 'ask_teacher' ? await this.openTeacherQuestionLive(scrubbed, e) : undefined;
    if (questionId !== undefined) this.send({ type: 'teacher_question', questionId });

    // 9. postGuard on the whole reply, before done; a failure sends the safe reply. A post guard
    // that escalates clears the reply and ends the turn as an escalation (caring template, 4.5).
    const post = await this.postGuard(scrubbed, ctx, decision, gen);
    if (typeof post !== 'string') {
      this.clearAll();
      return this.escalate(scrubbed, e, post.alert);
    }
    const replyText = post;
    this.done();
    return this.finish(
      e,
      {
        ...base,
        outcome: 'replied',
        replyText,
        ...(questionId === undefined ? {} : { teacherQuestionId: questionId }),
      },
      intent,
      decision.move,
    );
  }

  /**
   * findSimilar then open (`teacherQuestion.ts`'s shared helper), within one budget, with the
   * scrubbed text (never the raw input). Any failure or timeout is reported and gives no id: the
   * turn still replies and commit (3.17) opens the question. A timed-out open may still land;
   * the store's dedup (migration 0011) makes that, and commit's own fallback, land once.
   */
  private async openTeacherQuestionLive(input: TurnInput, e: Entitled): Promise<string | undefined> {
    const text = input.text;
    if (text === undefined || text.trim() === '') return undefined;
    const r = await runWithTimeout(
      () => openTeacherQuestion(this.deps.teacherQuestions, e.entitlement, text),
      TEACHER_QUESTION_TIMEOUT_MS,
      this.deps.clock,
    );
    if (r.status === 'ok') return r.value;
    this.background.push({
      task: 'teacher_question',
      error: r.status === 'error' ? r.error : new HarnessError('TeacherQuestionStore timed out'),
    });
    return undefined;
  }

  /**
   * route's fallback. If `route.onFailure` fails, the injected distress keyword check still runs,
   * so distress keywords escalate. If that fails too, ROUTE_DEFAULT is used and route is `failed`.
   */
  private routeFallback(
    input: TurnInput,
    e: Entitled,
  ): { intent: Intent; attempt: TurnContext['attempt']; outcome: 'fallback' | 'failed' } {
    try {
      const fb = RouteFallbackSchema.parse(
        this.steps.route.onFailure(this.env(input, cancelSource().token), e),
      );
      return { ...fb, outcome: 'fallback' };
    } catch (error) {
      this.background.push({ task: 'runner', error });
    }
    try {
      const hit = this.deps.distressCheck(input.text ?? '', input.lang);
      return {
        ...ROUTE_DEFAULT,
        ...(hit ? { intent: 'distress' as const } : {}),
        outcome: 'fallback',
      };
    } catch (error) {
      this.background.push({ task: 'runner', error });
      return { ...ROUTE_DEFAULT, outcome: 'failed' };
    }
  }

  private async escalate(
    input: TurnInput,
    e: Entitled,
    preAlert: SafetyAlert | undefined,
  ): Promise<TurnRunResult> {
    const es = check(
      await this.timed(input, timeoutOf('escalate'), (env) =>
        this.steps.escalate(env, e, preAlert),
      ),
      EscalateResultSchema,
    );
    const built = this.buildAlert(input, e, (es.ok ? es.value.alert : undefined) ?? preAlert);

    // The reply is never empty: the step's text, else the locale fallback, else the last resort.
    let replyText = es.ok ? es.value.replyText : '';
    let outcome: 'ok' | 'fallback' | 'failed' = replyText !== '' ? 'ok' : 'fallback';
    if (replyText === '') {
      try {
        replyText = this.deps.fallbackReplies.distress(input.lang, e.locale);
      } catch (error) {
        this.background.push({ task: 'runner', error });
      }
    }
    if (replyText === '') {
      this.background.push({
        task: 'runner',
        error: new HarnessError('no distress reply text; sent the last-resort reply'),
      });
      replyText = LAST_RESORT_DISTRESS_REPLY;
      outcome = 'failed';
    }
    return this.sendEscalation(e, input, built, { replyText, outcome, ms: es.ms });
  }

  /**
   * The end of every escalated turn: dispatch the alert (if one could be built), record escalate
   * (`failed` when the alert could not be built first time), send safety + reply + done, save.
   * `commitInput` is null when the scrub failed, so the raw text is never stored.
   */
  private sendEscalation(
    e: Entitled,
    commitInput: TurnInput | null,
    built: { alert: SafetyAlert | null; failed: boolean },
    reply: { replyText: string; outcome: 'ok' | 'fallback' | 'failed'; ms: number },
  ): Promise<TurnRunResult> {
    const delivered = built.alert === null ? undefined : this.deliverAlert(built.alert);
    this.trace.step('escalate', reply.ms, built.failed ? 'failed' : reply.outcome);
    this.send({ type: 'safety', level: 'alert' });
    this.send({ type: 'token', text: reply.replyText });
    this.done();
    return this.finish(
      e,
      {
        outcome: 'escalated',
        input: commitInput,
        intent: 'distress',
        replyText: reply.replyText,
        ...(built.alert === null ? {} : { alert: built.alert }),
      },
      'distress',
      'redirect',
      delivered,
    );
  }

  /**
   * The alert to raise: `preferred` (from escalate or preGuard), else a runner-built one. Building
   * is tried twice; each failure goes to `finished.background`. Never throws.
   */
  private buildAlert(
    input: TurnInput,
    e: Entitled,
    preferred: SafetyAlert | undefined,
  ): { alert: SafetyAlert | null; failed: boolean } {
    if (preferred !== undefined) return { alert: preferred, failed: false };
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return { alert: fallbackAlert(input, e, this.deps), failed: attempt > 0 };
      } catch (error) {
        this.background.push({ task: 'alert', error });
      }
    }
    return { alert: null, failed: true };
  }

  /**
   * The injected keyword check; never throws. On the raw (unscrubbed) text, a failure is reported
   * without its error, which could quote the text.
   */
  private distressHit(input: TurnInput, kind: 'raw' | 'scrubbed'): boolean {
    try {
      return this.deps.distressCheck(input.text ?? '', input.lang) === true;
    } catch (error) {
      this.background.push({
        task: 'runner',
        error:
          kind === 'raw' ? new HarnessError('distressCheck failed on the unscrubbed text') : error,
      });
      return false;
    }
  }

  /** "Alert retried until delivered": backoff 250 ms doubling to 30 s, no attempt limit. */
  private async deliverAlert(alert: SafetyAlert): Promise<void> {
    let delay = ALERT_RETRY_START_MS;
    for (;;) {
      const r = await runWithTimeout(
        () => this.deps.alerts.raise(alert),
        ALERT_ATTEMPT_TIMEOUT_MS,
        this.deps.clock,
      );
      if (r.status === 'ok') return;
      this.background.push({
        task: 'alert',
        error: r.status === 'error' ? r.error : new HarnessError('AlertSink.raise timed out'),
      });
      await this.deps.clock.sleep(delay);
      delay = Math.min(delay * 2, ALERT_RETRY_MAX_MS);
    }
  }

  private async decide(
    input: TurnInput,
    ctx: TurnContext,
    help: HelpState,
  ): Promise<DecideResult | null> {
    const x = { ctx, help };
    const d = check(
      await this.timed(input, timeoutOf('decide'), (env) => this.steps.decide.run(env, x)),
      DecideResultSchema,
    );
    if (d.ok) {
      this.trace.step('decide', d.ms, 'ok');
      return d.value;
    }
    try {
      const fb = DecideResultSchema.parse(
        this.steps.decide.fallback(this.env(input, cancelSource().token), x),
      );
      // `ask`; `redirect` only for distress (3.5's fallback never asks a distressed student).
      const move = fb.decision.move;
      if (move !== 'ask' && !(move === 'redirect' && ctx.intent === 'distress')) {
        throw new HarnessError(`decide.fallback returned move "${move}"`);
      }
      this.trace.step('decide', d.ms, 'fallback');
      return fb;
    } catch (error) {
      this.background.push({ task: 'runner', error });
      this.trace.step('decide', d.ms, 'failed');
      return null;
    }
  }

  private async generate(
    input: TurnInput,
    ctx: TurnContext,
    decision: PedagogyDecision,
    sources: SourceRef[],
  ): Promise<GenerateResult | TurnError | typeof CANCELLED> {
    const policies = turnPolicies(ctx.agent.modelPolicy);
    let ms = 0;
    for (const attempt of ['primary', 'fallback'] as const) {
      // A turn cancelled before (or between) attempts makes no model call.
      if (this.cancelled.cancelled) {
        this.trace.step('generate', ms, 'failed');
        return CANCELLED;
      }
      const state = { invalid: false };
      const policy = attempt === 'primary' ? policies.primary : policies.retry;
      const raw = await runWithTimeout(
        (stepCancel) => {
          const cancel = linkCancel(stepCancel, this.cancelled);
          const tg = buildTurnGateway(this.deps, policy, this.billing as TurnBilling);
          return this.steps.generate(
            this.env(input, cancel, tg, 'generate'),
            { ctx, decision, sources, attempt },
            this.emitter(cancel, state),
          );
        },
        timeoutOf('generate'),
        this.deps.clock,
      );
      ms += raw.ms;
      if (this.cancelled.cancelled) {
        this.trace.step('generate', ms, 'failed');
        return CANCELLED;
      }
      const g = check(raw, GenerateResultSchema);
      if (g.ok && !state.invalid) {
        this.trace.step('generate', ms, attempt === 'primary' ? 'ok' : 'fallback');
        return g.value;
      }
      // Every failed attempt is reported, by kind and error name only (never a foreign message).
      this.background.push({ task: 'generate', error: attemptFailure(attempt, raw, state) });
      const failure = generateFailure(raw);
      if (failure !== 'retry') {
        this.trace.step('generate', ms, 'failed');
        return failure;
      }
      // Clear streamed text before the retry so the student never sees two half-replies.
      if (attempt === 'primary') this.clearShown();
    }
    this.trace.step('generate', ms, 'failed');
    return PROVIDER_ERROR;
  }

  private async postGuard(
    input: TurnInput,
    ctx: TurnContext,
    decision: PedagogyDecision,
    gen: GenerateResult,
  ): Promise<string | { alert: SafetyAlert }> {
    const { draft } = gen;
    const x = {
      ctx,
      decision,
      draft,
      ...(gen.raw === undefined ? {} : { raw: gen.raw }),
      ...(gen.withheld === undefined ? {} : { withheld: gen.withheld }),
      ...(gen.locked === undefined ? {} : { locked: gen.locked }),
    };
    const raw = await this.timed(input, timeoutOf('postGuard'), (env) =>
      this.steps.postGuard(env, x),
    );
    const p = check(raw, PostGuardResultSchema);
    if (p.ok) {
      this.trace.addGuards(p.value.guards);
      this.addReported(p.value.usage);
      this.trace.step('postGuard', p.ms, 'ok');
      if (p.value.result === 'ok') return draft;
      // The guard's text is never shown on an escalate (4.1 safety review): the caring template is.
      if (p.value.result === 'escalate') {
        this.escalatedText = p.value.text;
        return { alert: p.value.alert };
      }
      this.clearAll();
      this.send({ type: 'replace', text: p.value.text });
      return p.value.text;
    }
    this.trace.step('postGuard', p.ms, 'fallback');
    // Reported like every other step failure: kind and error name only, never a message.
    this.background.push({ task: 'runner', error: postGuardFailure(raw) });
    let safe = '';
    try {
      safe = this.deps.fallbackReplies.safeReply(input.lang);
    } catch (error) {
      this.background.push({ task: 'runner', error });
    }
    this.clearAll();
    this.send({ type: 'replace', text: safe });
    return safe;
  }

  // ---- 10, 11 and the trace: after the stream has ended ---------------------------------------

  private async finish(
    e: Entitled,
    rec: Omit<
      CommitRecord,
      'turnId' | 'sessionId' | 'messageId' | 'receivedAt' | 'createdAt' | 'entitled'
    >,
    intent: Intent,
    move: PedagogyDecision['move'],
    alertDelivered?: Promise<void>,
  ): Promise<TurnRunResult> {
    const record: CommitRecord = {
      ...rec,
      turnId: this.turnId,
      // The original input's session id: set even when the scrub failed and `input` is null.
      sessionId: this.input.sessionId,
      messageId: this.messageId,
      receivedAt: this.receivedAt,
      createdAt: isoAt(this.deps.clock.now()),
      entitled: e,
      ...(this.escalatedText === undefined ? {} : { escalatedText: this.escalatedText }),
    };
    // Usage from a metered turn gateway was metered at the gateway (2.4); only the rest goes here.
    const usage = this.meterable.map((u) => ({ ...u }));
    await Promise.all([
      usage.length > 0
        ? this.backgroundStep('meter', (env) =>
            this.steps.meter(env, { usage, entitlement: e.entitlement }),
          )
        : Promise.resolve(),
      this.backgroundStep('commit', (env) => this.steps.commit(env, record)),
    ]);

    let trace: TurnTrace | null = null;
    try {
      trace = this.trace.build({
        turnId: this.turnId,
        sessionId: this.input.sessionId,
        agentVersion: e.agent.version,
        packageVersion: e.pkg.version,
        intent,
        move,
      });
      await this.deps.traces.record(trace);
    } catch (error) {
      this.background.push({ task: 'trace', error });
    }
    if (alertDelivered !== undefined) await alertDelivered;
    await this.settlePending();
    return { trace, background: this.background };
  }

  /**
   * Waits for stream closes the steps handed over, so a late `return()` failure is in
   * `background` before it is logged. Bounded: past STREAM_CLOSE_SETTLE_MS it is reported and
   * `finished` resolves anyway.
   */
  private async settlePending(): Promise<void> {
    if (this.pending.length === 0) return;
    const r = await runWithTimeout(
      () => Promise.all(this.pending),
      STREAM_CLOSE_SETTLE_MS,
      this.deps.clock,
    );
    if (r.status === 'timeout') {
      this.background.push({
        task: 'generate',
        error: new HarnessError('a model stream close did not settle in time'),
      });
    }
  }

  /** meter and commit: no timeout, never block the reply; a failure is reported, not thrown. */
  private async backgroundStep(
    name: 'meter' | 'commit',
    fn: (env: StepEnv) => Promise<void>,
  ): Promise<void> {
    const started = this.deps.clock.now();
    try {
      await fn(this.env(this.safeInput, cancelSource().token));
      this.trace.step(name, this.deps.clock.now() - started, 'ok');
    } catch (error) {
      this.trace.step(name, this.deps.clock.now() - started, 'failed');
      this.background.push({ task: name, error });
    }
  }
}

/** What a failed generate attempt reports: the kind and the underlying error's name. */
/** What a failed postGuard step reports: the kind and the underlying error's name. */
function postGuardFailure(r: TimedResult<unknown>): PostGuardStepFailed {
  if (r.status === 'timeout') return new PostGuardStepFailed('timeout');
  if (r.status === 'error') return new PostGuardStepFailed('error', errorName(r.error));
  return new PostGuardStepFailed('invalid_result');
}

function attemptFailure(
  attempt: 'primary' | 'fallback',
  raw: TimedResult<unknown>,
  state: { invalid: boolean },
): GenerateAttemptFailed {
  if (raw.status === 'timeout') return new GenerateAttemptFailed(attempt, 'timeout');
  if (raw.status === 'error')
    return new GenerateAttemptFailed(attempt, 'error', errorName(raw.error));
  return new GenerateAttemptFailed(attempt, state.invalid ? 'invalid_event' : 'invalid_result');
}

/** The input without anything the scrub must see first (text and skill payload). */
function withoutText(input: TurnInput): TurnInput {
  const rest = { ...input };
  delete rest.text;
  delete rest.skillPayload;
  return rest;
}

/** The scrubbed input, or `null` when the scrub lost or invented the text or the payload. */
function applyScrub(input: TurnInput, s: Scrubbed): TurnInput | null {
  if ((input.text === undefined) !== (s.text === undefined)) return null;
  if ((input.skillPayload === undefined) !== (s.skillPayload === undefined)) return null;
  return {
    ...withoutText(input),
    ...(s.text === undefined ? {} : { text: s.text }),
    ...(s.skillPayload === undefined ? {} : { skillPayload: s.skillPayload }),
  };
}

const NAME_CAP = 100;

/** What `finished.background` gets for a failed scrub: a cause and an error name, no text. */
function scrubFailure(r: TimedResult<Scrubbed>): ScrubFailedError {
  if (r.status === 'timeout') return new ScrubFailedError({ guardCause: 'step_timeout' });
  if (r.status === 'ok') return new ScrubFailedError({ guardCause: 'step_invalid_result' });
  if (r.error instanceof ScrubFailedError) return r.error;
  const name = r.error instanceof Error ? r.error.name : typeof r.error;
  return new ScrubFailedError({
    guardCause: 'step_error',
    errorName: typeof name === 'string' ? name.slice(0, NAME_CAP) : 'Error',
  });
}

function assemble(
  e: Entitled,
  b: BuiltContext,
  intent: Intent,
  attempt: TurnContext['attempt'],
): TurnContext | null {
  // The help state (raw on Entitled, parsed on BuiltContext) holds `answerKey`: it never enters
  // TurnContext, which goes to the model, events and traces (ADR-0005). It goes to decide apart.
  const raw: Record<string, unknown> = { ...e, ...b, intent, attempt };
  delete raw.helpState;
  const parsed = TurnContextSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
