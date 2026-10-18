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
  StyleCard,
  TeacherQuestionStore,
  TraceSink,
  TranscriptStore,
  TurnContext,
  TurnEvent,
  TurnInput,
  TurnTrace,
  Usage,
  UsageMeter,
} from '@edmate/contracts';
import type { CancelToken, Clock, IdSource } from './clock.js';

/** Localised fallback texts the harness cannot compose itself (no i18n library in the harness). */
export interface FallbackReplies {
  /** postGuard's fail-closed reply. */
  safeReply(lang: Lang): string;
  /** escalate's caring reply when the step fails; should list the locale pack's helplines. */
  distress(lang: Lang, locale: LocalePack): string;
}

/** Contracts ports plus the harness-internal clock, ids and fallback texts. */
export interface PipelineDeps {
  clock: Clock;
  ids: IdSource;
  gateway: ModelGateway;
  entitlements: EntitlementStore;
  profiles: ProfileStore;
  transcripts: TranscriptStore;
  retrieval: RetrievalIndex;
  teacherQuestions: TeacherQuestionStore;
  usage: UsageMeter;
  traces: TraceSink;
  alerts: AlertSink;
  fallbackReplies: FallbackReplies;
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

/** What `entitle` resolves. agent/pkg/locale/styleCard loading is open (plan Q4, before 3.2). */
export interface Entitled {
  entitlement: Entitlement;
  agent: AgentConfig;
  pkg: PackageConfig;
  locale: LocalePack;
  styleCard: StyleCard;
}

export interface Scrubbed {
  /** The input text with PII replaced; absent when the input had no text. */
  text?: string;
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
  messageId: string;
  createdAt: string;
  entitled: Entitled;
  /** The scrubbed input; `null` when the scrub failed, so unscrubbed text is never stored. */
  input: TurnInput | null;
  outcome: TurnOutcome;
  intent?: Intent;
  context?: TurnContext;
  decision?: PedagogyDecision;
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
    run(env: StepEnv, ctx: TurnContext): Promise<PedagogyDecision>;
    /** Must return move `ask`; anything else ends the turn with an error. */
    fallback(ctx: TurnContext): PedagogyDecision;
  };
  generate(
    env: StepEnv,
    x: { ctx: TurnContext; decision: PedagogyDecision; attempt: 'primary' | 'fallback' },
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
