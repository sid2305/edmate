// The step interface between the runner (3.1) and the tasks that build each step (3.2-3.8, 4.x).
// Steps never mutate shared state: each returns a typed result and the runner merges it.
import type {
  AgentConfig,
  AlertSink,
  Attempt,
  Chunk,
  Entitlement,
  EntitlementStore,
  Intent,
  Lang,
  LearnerProfile,
  LocalePack,
  Message,
  ModelGateway,
  PackageConfig,
  PedagogyDecision,
  Persona,
  ProfileStore,
  RetrievalIndex,
  SafetyAlert,
  SessionStateStore,
  SourceRef,
  StyleCard,
  TeacherQuestionStore,
  TraceSink,
  TranscriptStore,
  TurnConfigStore,
  TurnContext,
  TurnEvent,
  TurnInput,
  TurnTrace,
  Usage,
  UsageMeter,
} from '@edmate/contracts';
import type { HelpState, SessionHelp } from '../pedagogy/helpState.js';
import type { PolicyReason } from '../pedagogy/policy.js';
import type { PromptPackLibrary, PromptPackRef } from '../pedagogy/promptPacks.js';
import type { CancelToken, Clock, IdSource } from './clock.js';
import type { TurnLimits } from './limits.js';

/** Localised fallback texts the harness cannot compose itself (no i18n library in the harness). */
export interface FallbackReplies {
  /** postGuard's fail-closed reply. */
  safeReply(lang: Lang): string;
  /** escalate's caring reply when the step fails; should list the locale pack's helplines. */
  distress(lang: Lang, locale: LocalePack): string;
  /**
   * entitle's friendly text for `limit_reached` (task 2.5), carried on the TurnRejection's
   * `message` (the frozen wire event has no message field). Optional: when absent, empty or
   * failing, entitle uses the built-in English `DEFAULT_LIMIT_REACHED_REPLY`.
   */
  limitReached?(lang: Lang): string;
}

/** Contracts ports plus the harness-internal clock, ids and fallback texts. */
export interface PipelineDeps {
  clock: Clock;
  ids: IdSource;
  gateway: ModelGateway;
  entitlements: EntitlementStore;
  /** Loads the agent, package, style card and locale pack at `entitle` (ADR-0004). */
  turnConfig: TurnConfigStore;
  /**
   * Which entitlement this caller resolves, set by the composition root (student web route
   * `subscription`, studio/CLI preview `teacher_preview`, eval runner `eval`); never from TurnInput.
   */
  entitlementSource: Entitlement['source'];
  /** Long-lived rate and message counters, built once by the composition root. */
  limits: TurnLimits;
  profiles: ProfileStore;
  transcripts: TranscriptStore;
  /**
   * Saves the session's help state after the turn (commit, ADR-0005). The only place the answer
   * key is written; the composition root binds it to the turn's student x teacher.
   */
  sessionState: SessionStateStore;
  retrieval: RetrievalIndex;
  teacherQuestions: TeacherQuestionStore;
  usage: UsageMeter;
  traces: TraceSink;
  alerts: AlertSink;
  fallbackReplies: FallbackReplies;
  /**
   * The validated prompt-pack sets, by version, loaded once at start-up by the composition root
   * (`@edmate/content` reads the files). decide uses the set `agent.promptPackVersion` pins.
   */
  promptPacks: PromptPackLibrary;
  /**
   * Last-line distress keyword check on the scrubbed text, used only when `route.onFailure`
   * itself fails ("distress keywords still escalate"). True escalates the turn.
   */
  distressCheck(text: string, lang: Lang): boolean;
}

export interface StepEnv {
  /** The student's input; after step 3's scrub, the scrubbed input. */
  readonly input: TurnInput;
  readonly deps: PipelineDeps;
  /** Fires when the step's budget runs out (or it finished); a step should stop work then. */
  readonly cancel: CancelToken;
  readonly turnId: string;
}

/** Only generate may emit; the runner validates each event and drops events after a timeout. */
export type Emit = (e: TurnEvent) => void;

export type GuardTrace = TurnTrace['guards'][number];

/** What `entitle` resolves: the entitlement plus its config, loaded through TurnConfigStore (ADR-0004). */
export interface Entitled {
  entitlement: Entitlement;
  agent: AgentConfig;
  pkg: PackageConfig;
  locale: LocalePack;
  styleCard: StyleCard;
  /**
   * The session's stored help state, raw and unvalidated (ADR-0005); buildContext parses it.
   * Server-side only: it holds `answerKey`, so it never goes into TurnContext, events or traces.
   */
  helpState?: unknown;
}

export interface Scrubbed {
  /** The input text with PII replaced; absent when the input had no text. */
  text?: string;
  /** The skill payload with every string (and PII-shaped number) scrubbed; absent when none. */
  skillPayload?: unknown;
  guards: GuardTrace[];
}

export type PreGuardResult =
  | { result: 'ok' | 'block'; guards: GuardTrace[]; usage: Usage[] }
  | { result: 'escalate'; alert: SafetyAlert; guards: GuardTrace[]; usage: Usage[] };

export interface RouteResult {
  intent: Intent;
  attempt: Attempt;
  usage: Usage[];
}

export interface BuiltContext {
  profile: LearnerProfile;
  history: Message[];
  retrieved: Chunk[];
  lockedHit: boolean;
  persona?: Persona;
  helpRung: TurnContext['helpRung'];
  /**
   * The rest of the parsed help state (ADR-0005). Kept out of TurnContext (it holds `answerKey`);
   * the runner passes it to decide, and decide's `next` goes to commit.
   */
  helpState: HelpState;
}

/** What decide works from: the context plus the parsed help state (kept out of TurnContext). */
export interface DecideInput {
  ctx: TurnContext;
  help: HelpState;
}

/** decide's result. Server-side only: `next` and the do-not-say list hold the answer key. */
export interface DecideResult {
  decision: PedagogyDecision;
  /** The help state to save after the turn (commit, 3.8). */
  next: SessionHelp;
  reason: PolicyReason;
  /** The prompt-pack set and pack versions the system prompt used (lead answer Q1). */
  promptPack: PromptPackRef;
  /** In the order of the `[n]` numbers in the system prompt (for generate's `sources` event). */
  sources: SourceRef[];
}

export interface EscalateResult {
  /** Caring reply with the locale pack's helplines. */
  replyText: string;
  /** Overrides the alert from preGuard (or the runner-built one) when the step enriches it. */
  alert?: SafetyAlert;
}

export interface GenerateResult {
  draft: string;
  usage: Usage[];
}

export type PostGuardResult = { guards: GuardTrace[]; usage: Usage[] } & (
  { result: 'ok' } | { result: 'replace'; text: string }
);

export type TurnOutcome = 'replied' | 'escalated' | 'blocked' | 'error';

/** What `commit` persists: messages, a TeacherQuestion for `ask_teacher`, learner memory. */
export interface CommitRecord {
  turnId: string;
  /** The session the turn belongs to (from the original input; ids are not PII), set even when `input` is null. */
  sessionId: string;
  /** The agent's reply's id: the `done` event's `messageId`. */
  messageId: string;
  /** When the turn started: the student message's timestamp. */
  receivedAt: string;
  /** When the turn finished: the agent message's timestamp. */
  createdAt: string;
  entitled: Entitled;
  /** The scrubbed input; `null` when the scrub failed, so unscrubbed text is never stored. */
  input: TurnInput | null;
  outcome: TurnOutcome;
  intent?: Intent;
  context?: TurnContext;
  decision?: PedagogyDecision;
  /** The session's help state after this turn, for commit (3.8) to save. Holds `answerKey`. */
  next?: SessionHelp;
  /** The prompt-pack set and pack versions the system prompt used. */
  promptPack?: PromptPackRef;
  /** The text the student was shown (after postGuard), when the turn replied or escalated. */
  replyText?: string;
  alert?: SafetyAlert;
}

export interface Steps {
  admit(env: StepEnv): Promise<void>;
  entitle(env: StepEnv): Promise<Entitled>;
  /** Step 3, phase 1: regex-only PII scrub, before the concurrent group. */
  scrub(env: StepEnv, s: Entitled): Promise<Scrubbed>;
  /** Step 3, phase 2: moderation and jailbreak, concurrent with route and buildContext. */
  preGuard(env: StepEnv, s: Entitled): Promise<PreGuardResult>;
  route: {
    run(env: StepEnv, s: Entitled): Promise<RouteResult>;
    /** The spec's fallback: `on_task` / `none`, but distress keywords still give `distress`. */
    onFailure(env: StepEnv, s: Entitled): { intent: Intent; attempt: Attempt };
  };
  buildContext(env: StepEnv, s: Entitled): Promise<BuiltContext>;
  escalate(env: StepEnv, s: Entitled, alert: SafetyAlert | undefined): Promise<EscalateResult>;
  decide: {
    run(env: StepEnv, x: DecideInput): Promise<DecideResult>;
    /**
     * Synchronous. Must return move `ask` (or `redirect` for a distress context); anything else
     * ends the turn with an error.
     */
    fallback(env: StepEnv, x: DecideInput): DecideResult;
  };
  generate(
    env: StepEnv,
    x: {
      ctx: TurnContext;
      decision: PedagogyDecision;
      /** decide's numbered sources, for the `sources` event. */
      sources: SourceRef[];
      attempt: 'primary' | 'fallback';
    },
    emit: Emit,
  ): Promise<GenerateResult>;
  postGuard(
    env: StepEnv,
    x: { ctx: TurnContext; decision: PedagogyDecision; draft: string },
  ): Promise<PostGuardResult>;
  meter(env: StepEnv, x: { usage: Usage[]; entitlement: Entitlement }): Promise<void>;
  commit(env: StepEnv, record: CommitRecord): Promise<void>;
}

export type BackgroundTask = 'meter' | 'commit' | 'trace' | 'alert' | 'runner';

export interface TurnRunResult {
  /** `null` when the turn ended before `entitle` passed (no trace for rejected turns). */
  trace: TurnTrace | null;
  /** Failures that never reached the stream: background steps, trace, alert attempts, bugs. */
  background: { task: BackgroundTask; error: unknown }[];
}

export interface TurnRun {
  /** Ends after exactly one `done` or `error`. */
  events: AsyncIterable<TurnEvent>;
  /** Never rejects; resolves when meter, commit, trace and alert delivery settle. */
  finished: Promise<TurnRunResult>;
}
