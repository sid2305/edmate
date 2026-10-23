// The turn pipeline runner (build plan § Turn pipeline spec):
//   admit → entitle → scrub → [ preGuard ‖ route ‖ buildContext ] → escalate | decide → generate
//   → teacher_question (ask_teacher) → postGuard → done, then meter ‖ commit in the background,
//   then the trace.
//
// Task 3.7 adds: the per-turn gateways billed to the entitlement (turnGateway.ts), usage priced
// as it streams with the per-turn cost ceiling, `replace ''` before an error whenever text was
// shown, cancellation (the consumer detaching, or `RunTurnOptions.cancel`), the TeacherQuestion
// opened before `done`, and every `finished.background` failure logged (ids and error only).
//
// Task 4.7 adds: a reply generate held back (ask_teacher, or coverage near the threshold) is sent
// only after postGuard passes it; and when grounding replaced an ungrounded reply, the turn's
// TeacherQuestion is opened (same shared, idempotent open as ask_teacher; one per turn, and at most
// GROUNDING_ASKS_PER_SESSION per session, counted in the help state; past the cap the student
// gets the ask-teacher reply only).
import {
  type Intent,
  type PedagogyDecision,
  type SafetyAlert,
  type SourceRef,
  type TurnContext,
  type TurnEvent,
  TurnEventSchema,
  type TurnInput,
  type TurnTrace,
  type Usage,
  UsageSchema,
} from '@edmate/contracts';
import type { z } from 'zod';
import { hasAnyDistressKeyword } from '../guardrails/distressKeywords.js';
import {
  copyHelp,
  type HelpState,
  holdsPracticeKey,
  INITIAL_HELP_STATE,
  PRACTICE_SERVED_MAX,
  practiceFields,
  type SessionHelp,
  withGroundingAsks,
  withPersonaCount,
} from '../pedagogy/helpState.js';
import { assemble } from './assemble.js';
import { logBackground } from './backgroundLog.js';
import { type Cancel, cancelSource, type CancelToken, isoAt, linkCancel } from './clock.js';
import {
  errorName,
  GenerateAttemptFailed,
  HarnessError,
  HelpStateUnreadable,
  InvalidEventError,
  PostGuardStepFailed,
  ScrubFailedError,
  UnpricedUsage,
} from './errors.js';
import { EventQueue } from './events.js';
import { LAST_RESORT_DISTRESS_REPLY } from './replies.js';
import { ceilingOf, TurnCost } from './generate/costCeiling.js';
import { type ItemContext, itemContextOf } from './generate/itemContext.js';
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
  GROUNDING_ASKS_PER_SESSION,
  STEP_SPEC,
  type StepName,
  STREAM_CLOSE_SETTLE_MS,
  TEACHER_QUESTION_TIMEOUT_MS,
} from './spec.js';
import { openTeacherQuestion } from './teacherQuestion.js';
import { runWithTimeout, type TimedResult } from './timeout.js';
import { entitledTools, type IssuedItem, noTools, type ToolSessionState } from './tools.js';
import { TraceBuilder } from './trace.js';
import { billingFor, buildTurnGateway, refusingGateway, turnPolicies } from './turnGateway.js';
import type {
  BackgroundTask,
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
 * The trace action (on a `grounding` guard entry) marking a reply grounding replaced after the
 * student had seen it stream in (task 4.7 fix round 1). A code, never text.
 */
export const STREAMED_REPLACED = 'replaced_streamed';

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
  /** Drawn at the start of run(), for the firstToken derived metric (7.7). */
  private startedAtMs = 0;
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
  /**
   * The session's locked stop flag as loaded (ADR-0007 §8, 4.6b fix round 1). `null` when the
   * help state could not be loaded (buildContext failed or timed out, the context fell back, or
   * a stored blob could not be read): the turn then holds its whole reply and saves no help state,
   * so a stored `true` is never overwritten with `false`.
   */
  private loadedStop: boolean | null = false;
  /** A locked hit or failed locked check anywhere in this turn: any attempt, or the post guard. */
  private lockedTrip = false;
  /** decide.fallback chose the decision: generate holds the reply (4.7 fix round 1). */
  private decideFellBack = false;
  /** The help state as loaded (null: not loaded), for carrying practice fields over (5.6). */
  private loadedHelp: SessionHelp | null = null;
  /**
   * Practice items issued this turn, in order, any attempt (5.6, ADR-0010 §4). Server-side only:
   * they hold the answer keys. finish() saves them on every outcome.
   */
  private readonly issued: IssuedItem[] = [];
  /** The active item the loaded help state names, resolved on the server (5.6b); else none. */
  private loadedItems: ItemContext[] = [];
  /** The loaded held and carried practice keys (5.6b, design 4). */
  private loadedPracticeKeys: string[] = [];

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
      // First words of a reply (PRD S5): only a real token counts, not a skill event.
      if (parsed.data.type === 'token') {
        this.trace.markElapsed('firstToken', this.deps.clock.now() - this.startedAtMs);
      }
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
    this.startedAtMs = this.deps.clock.now();
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
    // 5.6a: chunks that reveal the held answer key were dropped before the model saw them. One
    // entry, name and verdict only: never the count, ids, text or keys.
    if (bc.ok && bc.value.answerKeyDropped !== undefined) {
      this.trace.addGuards([{ name: 'answerKeyContext', ok: false, action: 'drop' }]);
    }

    // 5. Escalate beats block: a distressed student always gets the caring reply.
    const preAlert = pg.ok && pg.value.result === 'escalate' ? pg.value.alert : undefined;
    // A failed preGuard means no classifier verdict: the keyword check still runs, and there a
    // soft phrase counts too (no verdict to bypass; 4.3 safety review). A hit on the raw text
    // (before the scrub, hard phrases only) always counts.
    if (
      preAlert !== undefined ||
      intent === 'distress' ||
      rawDistress ||
      (!pg.ok &&
        (this.distressHit(scrubbed, 'scrubbed') || hasAnyDistressKeyword(scrubbed.text ?? '')))
    ) {
      return this.escalate(scrubbed, e, preAlert);
    }
    if (pg.ok && pg.value.result === 'block' && pg.value.reply !== undefined) {
      // moderationIn / jailbreak (4.4): the code's own reply, plus a misuse alert if one came.
      return this.sendBlockReply(
        e,
        scrubbed,
        intent,
        pg.value.reply,
        pg.value.alert,
        pg.value.code,
      );
    }
    if (!pg.ok || pg.value.result === 'block') {
      this.endWithError(pg.ok ? PRE_GUARD_BLOCKED : PRE_GUARD_FAILED);
      // Any non-ok pre outcome keeps the input out of later turns (4.4 fix round 2).
      const code = pg.ok && pg.value.result === 'block' ? pg.value.code : undefined;
      return this.finish(
        e,
        {
          outcome: 'blocked',
          input: scrubbed,
          intent,
          inputWithheld: true,
          ...(code === undefined ? {} : { withheldCode: code }),
        },
        intent,
        'redirect',
      );
    }

    // Assemble the TurnContext; its refine (retrieved ⊆ allowed, same teacher, ids match) is the
    // last check before decide. A failure is treated as a buildContext failure.
    let built = bc.ok ? bc.value : fallbackContext(scrubbed, e);
    let helpLoaded = bc.ok && built.helpStateUnreadable !== true;
    // 4.6c: a corrupt stored help state is reported once per turn, by kind only (never the blob).
    if (bc.ok && built.helpStateUnreadable === true) {
      this.background.push({ task: 'runner', error: new HelpStateUnreadable() });
    }
    let ctx = assemble(e, built, intent, attempt);
    if (ctx === null && bc.ok) {
      this.trace.outcome('buildContext', 'fallback');
      built = fallbackContext(scrubbed, e);
      helpLoaded = false;
      ctx = assemble(e, built, intent, attempt);
    }
    this.loadedStop = helpLoaded ? built.helpState.lockedStopped === true : null;
    this.loadedHelp = helpLoaded ? { rung: built.helpRung, help: built.helpState } : null;
    if (ctx === null) {
      this.endWithError({ code: 'no_access', retryable: false });
      return this.finish(e, { outcome: 'error', input: scrubbed, intent }, intent, 'redirect');
    }
    this.loadAnswerContext(ctx, built.helpState);

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
    // The session's grounding escalation count rides along on every path that saves the help
    // state (decide's ladder may rebuild the state without it; 4.7 fix round 1).
    const asked = built.helpState.groundingAsks ?? 0;
    const base = {
      input: scrubbed,
      intent,
      context: ctx,
      decision,
      next: withGroundingAsks(decided.next, asked),
      promptPack: decided.promptPack,
    };

    // 8. generate: one retry on the fallback model; a TurnAbort or a cancel is final. Text the
    // student saw is cleared before the error, so unguarded partial text never stays on screen.
    // ADR-0007 §8 (4.6b): a session that already stopped streaming (an earlier turn's locked
    // hit or failed check), or whose flag could not be loaded, holds this turn's whole reply.
    const gen = await this.generate(
      scrubbed,
      ctx,
      decision,
      decided.sources,
      this.loadedStop !== false,
      {
        servedItemIds: built.helpState.practiceServed ?? [],
        ...(built.helpState.practiceModuleId === undefined
          ? {}
          : { activeModuleId: built.helpState.practiceModuleId }),
      },
    );
    if (gen !== CANCELLED && !('code' in gen) && gen.locked !== undefined) this.lockedTrip = true;
    if (gen === CANCELLED || 'code' in gen) {
      this.clearShown();
      this.endWithError(gen === CANCELLED ? PROVIDER_ERROR : gen);
      // The student saw no reply, so the persona question count stays as loaded (3.11e).
      return this.finish(
        e,
        { ...base, next: withPersonaCount(base.next, built.helpState), outcome: 'error' },
        intent,
        decision.move,
      );
    }

    // The TeacherQuestion is opened before done, so its id reaches the student (lead answer Q3).
    let questionId =
      decision.move === 'ask_teacher' ? await this.openTeacherQuestionLive(scrubbed, e) : undefined;
    if (questionId !== undefined) this.send({ type: 'teacher_question', questionId });

    // 9. postGuard on the whole reply, before done; a failure sends the safe reply. A post guard
    // that escalates clears the reply and ends the turn as an escalation (caring template, 4.5).
    const post = await this.postGuard(scrubbed, ctx, decision, gen, decided.sources);
    if ('alert' in post) {
      this.clearAll();
      // A locked trip must still be saved (4.6b fix round 1): the loaded state, untouched, gets
      // the flag in finish(). Without one, an escalation saves no help state, as before.
      const keep = this.lockedTrip ? { rung: built.helpRung, help: built.helpState } : undefined;
      return this.escalate(scrubbed, e, post.alert, keep);
    }
    const { replyText } = post;

    // grounding sent an ungrounded reply to the teacher (4.7): one question per turn (none when
    // decide already asked), within the session's cap. Only a question that was opened counts
    // (fix round 1): a failed live open leaves the count to commit, which counts its own fallback
    // open only if it succeeds.
    const escalating =
      post.escalateToTeacher &&
      decision.move !== 'ask_teacher' &&
      asked < GROUNDING_ASKS_PER_SESSION;
    if (escalating) {
      questionId = await this.openTeacherQuestionLive(scrubbed, e);
      if (questionId !== undefined) this.send({ type: 'teacher_question', questionId });
    }
    this.done();
    // ADR-0007 §8 (4.6b): finish() sets the session's stop flag on `next`.
    return this.finish(
      e,
      {
        ...base,
        // Only the model's own reply, passed by the post guard, counts a persona question
        // (3.11e): the safe reply and a guard's replacement keep the loaded count.
        next: withGroundingAsks(
          post.modelReply ? decided.next : withPersonaCount(decided.next, built.helpState),
          asked + (escalating && questionId !== undefined ? 1 : 0),
        ),
        outcome: 'replied',
        replyText,
        ...(questionId === undefined ? {} : { teacherQuestionId: questionId }),
        ...(escalating ? { escalateToTeacher: true } : {}),
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
  private async openTeacherQuestionLive(
    input: TurnInput,
    e: Entitled,
  ): Promise<string | undefined> {
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
    next?: SessionHelp,
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
    return this.sendEscalation(e, input, built, { replyText, outcome, ms: es.ms }, next);
  }

  /**
   * The end of every escalated turn: dispatch the alert (if one could be built), record escalate
   * (`failed` when the alert could not be built first time), send safety + reply + done, save.
   * `commitInput` is null when the scrub failed, so the raw text is never stored. `next` is the
   * help state to save, only after a locked trip (4.6b fix round 1).
   */
  private sendEscalation(
    e: Entitled,
    commitInput: TurnInput | null,
    built: { alert: SafetyAlert | null; failed: boolean },
    reply: { replyText: string; outcome: 'ok' | 'fallback' | 'failed'; ms: number },
    next?: SessionHelp,
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
        ...(next === undefined ? {} : { next }),
      },
      'distress',
      'redirect',
      delivered,
    );
  }

  /**
   * A pre guard blocked with a reply (4.4): send it and end the turn, saved as `blocked`. An alert
   * that came with the block (a misuse alert) is delivered like an escalation's: retried until
   * delivered, and awaited (bounded) before `finished`. No `safety` event: nothing is shown as a
   * crisis.
   */
  private sendBlockReply(
    e: Entitled,
    input: TurnInput,
    intent: Intent,
    replyText: string,
    alert: SafetyAlert | undefined,
    code: string | undefined,
  ): Promise<TurnRunResult> {
    const delivered = alert === undefined ? undefined : this.deliverAlert(alert);
    this.send({ type: 'token', text: replyText });
    this.done();
    return this.finish(
      e,
      {
        outcome: 'blocked',
        input,
        intent,
        replyText,
        // The blocked text is saved as a placeholder and kept out of later turns (4.4 fix round).
        inputWithheld: true,
        ...(code === undefined ? {} : { withheldCode: code }),
        ...(alert === undefined ? {} : { alert }),
      },
      intent,
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
      this.decideFellBack = true;
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
    lockedStopped: boolean,
    practice: ToolSessionState,
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
            {
              ctx,
              decision,
              sources,
              attempt,
              lockedStopped,
              onLockedTrip: () => {
                this.lockedTrip = true;
              },
              // A retry neither serves an earlier attempt's item again (5.6) ...
              practice: {
                ...practice,
                servedItemIds: [...practice.servedItemIds, ...this.issued.map((i) => i.itemId)],
              },
              // ... nor lets its key out: it guards those keys from its first word.
              ...(this.issued.length > 0 ? { issuedKeys: this.issuedKeys() } : {}),
              onPracticeItem: (item) => {
                this.issued.push(item);
              },
              // 5.6b: the loaded item and earlier attempts' items; the turn's practice keys.
              items: this.activeItems(),
              practiceKeys: this.loadedPracticeKeys,
              ...(this.decideFellBack ? { fromFallback: true as const } : {}),
            },
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
    sources: SourceRef[],
  ): Promise<
    { replyText: string; escalateToTeacher: boolean; modelReply: boolean } | { alert: SafetyAlert }
  > {
    const { draft } = gen;
    // Every practice key issued this turn is checked too (5.6, ADR-0010 §4): the items collected
    // through onPracticeItem and the generate result's own `practiceAnswerKey` (5.6 review). Only
    // the guards see them: the decision that is saved and composed is unchanged.
    const keys = [...new Set([...this.issuedKeys(), ...(gen.practiceAnswerKey ?? [])])];
    const guarded =
      keys.length === 0
        ? decision
        : { ...decision, mustNotReveal: [...new Set([...decision.mustNotReveal, ...keys])] };
    const x = {
      ctx,
      decision: guarded,
      draft,
      sources,
      ...(gen.raw === undefined ? {} : { raw: gen.raw }),
      ...(gen.withheld === undefined ? {} : { withheld: gen.withheld }),
      ...(gen.locked === undefined ? {} : { locked: gen.locked }),
      // 5.6b: the loaded item plus every item issued this turn, and every practice key.
      items: this.activeItems(),
      practiceKeys: [...new Set([...this.loadedPracticeKeys, ...keys])],
    };
    const raw = await this.timed(input, timeoutOf('postGuard'), (env) =>
      this.steps.postGuard(env, x),
    );
    const p = check(raw, PostGuardResultSchema);
    if (p.ok) {
      this.trace.addGuards(p.value.guards);
      this.addReported(p.value.usage);
      this.trace.step('postGuard', p.ms, 'ok');
      // A locked hit or failed locked check the post guard found counts as a trip (4.6b fix 1).
      if (p.value.guards.some((g) => g.name === 'lockedLeak' && !g.ok)) this.lockedTrip = true;
      if (p.value.result === 'ok') {
        // A held reply (4.7) reaches the student only now, checked.
        if (gen.held === true) this.send({ type: 'token', text: draft });
        return { replyText: draft, escalateToTeacher: false, modelReply: true };
      }
      // The guard's text is never shown on an escalate (4.1 safety review): the caring template is.
      if (p.value.result === 'escalate') {
        this.escalatedText = p.value.text;
        return { alert: p.value.alert };
      }
      // grounding replaced text the student had already seen stream in: flagged in the trace,
      // code only, so 7.x can size that window (4.7 fix round 1).
      if (p.value.groundingRewrote === true && this.shown) {
        this.trace.addGuards([{ name: 'grounding', ok: false, action: STREAMED_REPLACED }]);
      }
      this.clearAll();
      this.send({ type: 'replace', text: p.value.text });
      return {
        replyText: p.value.text,
        escalateToTeacher: p.value.escalateToTeacher === true,
        modelReply: false,
      };
    }
    this.trace.step('postGuard', p.ms, 'fallback');
    // A failed or timed-out post-guard step counts as a locked trip too (4.6c, fail closed): we
    // cannot tell whether lockedLeak itself would have hit, so the session stops streaming anyway.
    this.lockedTrip = true;
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
    return { replyText: safe, escalateToTeacher: false, modelReply: false };
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
      ...this.withStopFlag(this.withPractice(rec)),
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
   * The runner owns the session's locked stop flag (ADR-0007 §8, 4.6b fix round 1): every help
   * state it saves gets `loaded || tripped this turn`, whatever decide or a skill returned (a
   * correct practice answer, decide's fallback). When the help state could not be loaded, none is
   * saved at all, so a stored `true` is never overwritten.
   */
  private withStopFlag<R extends { next?: SessionHelp }>(rec: R): R {
    if (rec.next === undefined) return rec;
    // 5.6: practice items went out but the stored state could not be read. Their keys must still
    // be saved, so this state is saved stopped (fail closed: true over an unknown stored flag).
    if (this.loadedStop === null && this.issued.length > 0) {
      return { ...rec, next: { ...rec.next, help: { ...rec.next.help, lockedStopped: true } } };
    }
    if (this.loadedStop === null) {
      const out = { ...rec };
      delete out.next;
      return out;
    }
    const lockedStopped = this.loadedStop || this.lockedTrip;
    return { ...rec, next: { ...rec.next, help: { ...rec.next.help, lockedStopped } } };
  }

  /** The union of this turn's issued practice keys, in order (5.6). */
  private issuedKeys(): string[] {
    return [...new Set(this.issued.flatMap((i) => i.answerKey))];
  }

  /**
   * The answer context the loaded help state gives (5.6b). When it holds a practice key, the item
   * it names is rebuilt through the entitled registry (the first entitled tool with an
   * `activeItem` hook), not the tools offered this turn, so a turn that offers no tool still
   * exempts a re-show. The practice keys are the held key and the carried key (design 4). An item
   * no hook resolves gets no spans and no derived keys (Q6): its key stays guarded by decide's
   * `mustNotReveal`. A hook that throws is reported and treated as unresolved (fail closed).
   */
  private loadAnswerContext(ctx: TurnContext, help: Readonly<HelpState>): void {
    const holds = holdsPracticeKey(help);
    this.loadedPracticeKeys = [
      ...new Set([...(holds ? help.answerKey : []), ...(help.practiceCarriedKey ?? [])]),
    ];
    this.loadedItems = [];
    const itemId = help.practiceItemId;
    if (!holds || itemId === undefined) return;
    try {
      const tools = entitledTools(this.deps.tools ?? noTools, ctx.entitlement);
      const hook = tools.find((r) => r.activeItem !== undefined);
      const item = hook?.activeItem?.(itemId, ctx);
      if (item !== undefined) this.loadedItems = [item];
    } catch (error) {
      this.background.push({ task: 'runner', error });
    }
  }

  /** The loaded active item, then every item issued this turn so far (5.6b). */
  private activeItems(): ItemContext[] {
    return [...this.loadedItems, ...this.issued.map(itemContextOf)];
  }

  /**
   * The practice state to save (5.6, ADR-0010 §4). The practice fields of the loaded state ride
   * along on every saved state (decide's ladder rebuilds it without them, as for groundingAsks).
   * When an item went out this turn, on any outcome, the saved state holds its key (the union of
   * this turn's), starts a fresh problem (rung 0, ladder fields reset), marks the last item active
   * and records the ids served. A turn that saves no state otherwise saves the loaded one.
   */
  private withPractice<R extends { next?: SessionHelp }>(rec: R): R {
    const loaded = this.loadedHelp;
    if (this.issued.length === 0) {
      if (rec.next === undefined) return rec;
      // 5.6c (ADR-0011 §2): a carried key lasts one turn. decide's `copyHelp` keeps the field, so
      // it is removed here explicitly, never left to `practiceFields`.
      const help = withoutCarried({
        ...(loaded === null ? {} : practiceFields(loaded.help)),
        ...copyHelp(rec.next.help),
      });
      return { ...rec, next: { ...rec.next, help } };
    }
    const base = rec.next ?? loaded ?? { rung: 0, help: copyHelp(INITIAL_HELP_STATE) };
    const prior = loaded?.help.practiceServed ?? [];
    const ids = [...new Set(this.issued.map((i) => i.itemId))];
    const last = this.issued[this.issued.length - 1] as IssuedItem;
    const answerKey = this.issuedKeys();
    // 5.6c (ADR-0011 §2): the loaded item was replaced unsolved, so its key is guarded one more
    // turn. Carried whether the loaded item was a practice item (`holdsPracticeKey`) or not: any
    // loaded `answerKey` is a key the student had not yet shown (5.6d; no production path sets a
    // non-practice `answerKey` today, but a future one must not skip this guard). Never merged
    // into `answerKey`, which grades only the new item.
    const carried =
      loaded !== null && loaded.help.answerKey.length > 0
        ? loaded.help.answerKey.filter((k) => !answerKey.includes(k))
        : [];
    const help: HelpState = {
      ...withoutCarried(base.help),
      stuckTurns: 0,
      attemptLogged: false,
      pendingCheck: false,
      answerKey,
      practiceItemId: last.itemId,
      practiceModuleId: last.moduleId,
      practiceServed: [...prior.filter((id) => !ids.includes(id)), ...ids].slice(
        -PRACTICE_SERVED_MAX,
      ),
      ...(carried.length === 0 ? {} : { practiceCarriedKey: carried }),
    };
    return { ...rec, next: { rung: 0, help } };
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

/** What a failed postGuard step reports: the kind and the underlying error's name. */
function postGuardFailure(r: TimedResult<unknown>): PostGuardStepFailed {
  if (r.status === 'timeout') return new PostGuardStepFailed('timeout');
  if (r.status === 'error') return new PostGuardStepFailed('error', errorName(r.error));
  return new PostGuardStepFailed('invalid_result');
}

/** What a failed generate attempt reports: the kind and the underlying error's name. */
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

/** `h` without a carried practice key (5.6c, ADR-0011 §2): the runner sets it on the issuing turn only. */
function withoutCarried(h: HelpState): HelpState {
  const out = { ...h };
  delete out.practiceCarriedKey;
  return out;
}
