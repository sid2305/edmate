// The turn pipeline runner (build plan § Turn pipeline spec):
//   admit → entitle → scrub → [ preGuard ‖ route ‖ buildContext ] → escalate | decide → generate
//   → postGuard → done, then meter ‖ commit in the background, then the trace.
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
} from '@edmate/contracts';
import type { z } from 'zod';
import type { HelpState } from '../pedagogy/helpState.js';
import { cancelSource, type CancelToken, isoAt } from './clock.js';
import { InvalidEventError } from './errors.js';
import { EventQueue } from './events.js';
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
} from './spec.js';
import { runWithTimeout, type TimedResult } from './timeout.js';
import { TraceBuilder } from './trace.js';
import type {
  BuiltContext,
  CommitRecord,
  DecideResult,
  Emit,
  Entitled,
  PipelineDeps,
  StepEnv,
  Steps,
  TurnRun,
  TurnRunResult,
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
}

/** Runs one student turn. The stream ends with exactly one `done` or `error`; `finished` never rejects. */
export function runTurn(input: TurnInput, opts: RunTurnOptions): TurnRun {
  const queue = new EventQueue<TurnEvent>();
  const background: TurnRunResult['background'] = [];
  const turn = new Turn(input, opts.deps, opts.steps, queue, background);
  const finished = turn.run().catch((error: unknown): TurnRunResult => {
    // A runner bug: never leave the stream hanging.
    background.push({ task: 'runner', error });
    turn.endWithErrorIfOpen(PROVIDER_ERROR);
    return { trace: null, background };
  });
  return { events: queue, finished };
}

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
  if (ms === null) throw new Error(`step ${name} has no timeout`);
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

  constructor(
    private readonly input: TurnInput,
    private readonly deps: PipelineDeps,
    private readonly steps: Steps,
    private readonly queue: EventQueue<TurnEvent>,
    private readonly background: TurnRunResult['background'],
  ) {
    this.safeInput = withoutText(input);
  }

  // ---- events -------------------------------------------------------------------------------

  private send(e: TurnEvent): void {
    if (this.terminated) throw new Error(`event after the end of the turn: ${e.type}`);
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
    this.queue.push({ type: 'error', code: err.code, retryable: err.retryable });
    this.queue.close();
  }

  private done(): void {
    this.end({ type: 'done', messageId: this.messageId, usage: this.trace.usage });
  }

  /** An emitter for one step attempt: validates, drops late events, reports invalid ones. */
  private emitter(cancel: CancelToken, state: { tokens: number; invalid: boolean }): Emit {
    return (e) => {
      if (cancel.cancelled || this.terminated) return;
      const parsed = TurnEventSchema.safeParse(e);
      if (!parsed.success || parsed.data.type === 'done' || parsed.data.type === 'error') {
        state.invalid = true;
        throw new InvalidEventError(parsed.success ? parsed.data.type : 'unparseable');
      }
      if (parsed.data.type === 'token') state.tokens++;
      this.queue.push(parsed.data);
    };
  }

  // ---- step helpers -------------------------------------------------------------------------

  private env(input: TurnInput, cancel: CancelToken): StepEnv {
    return { input, deps: this.deps, cancel, turnId: this.turnId };
  }

  private timed<T>(
    input: TurnInput,
    ms: number,
    fn: (env: StepEnv) => Promise<T>,
  ): Promise<TimedResult<T>> {
    return runWithTimeout((cancel) => fn(this.env(input, cancel)), ms, this.deps.clock);
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

    // 3a. Regex PII scrub, first; its time counts against step 3's one budget.
    const budget = timeoutOf('preGuard');
    const sc = check(await this.timed(input, budget, (env) => steps.scrub(env, e)), ScrubbedSchema);
    const scrubbed = sc.ok ? applyScrub(input, sc.value.text) : null;
    if (scrubbed !== null) this.safeInput = scrubbed;
    if (!sc.ok || scrubbed === null) {
      this.trace.step('preGuard', sc.ms, 'failed');
      // In-process keyword check on the raw text (no model call; the text is never stored,
      // traced or reported). A hit escalates without running any step on the raw text.
      if (this.distressHit(input, 'raw')) {
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
      this.trace.addUsage(pg.value.usage);
    }

    const rt = check(rtRaw, RouteResultSchema);
    let intent: Intent;
    let attempt: TurnContext['attempt'];
    if (rt.ok) {
      ({ intent, attempt } = rt.value);
      this.trace.addUsage(rt.value.usage);
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
    // A failed preGuard means no classifier verdict: the keyword check still runs.
    if (
      preAlert !== undefined ||
      intent === 'distress' ||
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

    // 8. generate: one retry; a TurnAbort is final.
    const gen = await this.generate(scrubbed, ctx, decision, decided.sources);
    if ('code' in gen) {
      this.endWithError(gen);
      return this.finish(e, { ...base, outcome: 'error' }, intent, decision.move);
    }

    // 9. postGuard on the whole reply, before done; a failure sends the safe reply.
    const replyText = await this.postGuard(scrubbed, ctx, decision, gen.draft);
    this.done();
    return this.finish(e, { ...base, outcome: 'replied', replyText }, intent, decision.move);
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
        error: new Error('no distress reply text; sent the last-resort reply'),
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
        error: kind === 'raw' ? new Error('distressCheck failed on the unscrubbed text') : error,
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
        error: r.status === 'error' ? r.error : new Error('AlertSink.raise timed out'),
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
        throw new Error(`decide.fallback returned move "${move}"`);
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
  ): Promise<{ draft: string } | TurnError> {
    let ms = 0;
    for (const attempt of ['primary', 'fallback'] as const) {
      const state = { tokens: 0, invalid: false };
      const raw = await this.timed(input, timeoutOf('generate'), (env) =>
        this.steps.generate(
          env,
          { ctx, decision, sources, attempt },
          this.emitter(env.cancel, state),
        ),
      );
      ms += raw.ms;
      const g = check(raw, GenerateResultSchema);
      if (g.ok && !state.invalid) {
        this.trace.addUsage(g.value.usage);
        this.trace.step('generate', ms, attempt === 'primary' ? 'ok' : 'fallback');
        return { draft: g.value.draft };
      }
      const policy = generateFailure(raw);
      if (policy !== 'retry') {
        this.trace.step('generate', ms, 'failed');
        return policy;
      }
      // Clear streamed text before the retry so the student never sees two half-replies.
      if (attempt === 'primary' && state.tokens > 0) this.send({ type: 'replace', text: '' });
    }
    this.trace.step('generate', ms, 'failed');
    return PROVIDER_ERROR;
  }

  private async postGuard(
    input: TurnInput,
    ctx: TurnContext,
    decision: PedagogyDecision,
    draft: string,
  ): Promise<string> {
    const p = check(
      await this.timed(input, timeoutOf('postGuard'), (env) =>
        this.steps.postGuard(env, { ctx, decision, draft }),
      ),
      PostGuardResultSchema,
    );
    if (p.ok) {
      this.trace.addGuards(p.value.guards);
      this.trace.addUsage(p.value.usage);
      this.trace.step('postGuard', p.ms, 'ok');
      if (p.value.result === 'ok') return draft;
      this.send({ type: 'replace', text: p.value.text });
      return p.value.text;
    }
    this.trace.step('postGuard', p.ms, 'fallback');
    let safe = '';
    try {
      safe = this.deps.fallbackReplies.safeReply(input.lang);
    } catch (error) {
      this.background.push({ task: 'runner', error });
    }
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
    };
    const usage = this.trace.usage;
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
    return { trace, background: this.background };
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

function withoutText(input: TurnInput): TurnInput {
  const rest = { ...input };
  delete rest.text;
  return rest;
}

/** The scrubbed input, or `null` when the scrub lost or invented the text. */
function applyScrub(input: TurnInput, text: string | undefined): TurnInput | null {
  if (input.text === undefined) return text === undefined ? input : null;
  return text === undefined ? null : { ...input, text };
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
