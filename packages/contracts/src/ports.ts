// Ports from Core contracts, type-only (functions can't be Zod data; lead answer Q1). The db,
// gateway, ingest and worker packages implement them by importing contracts; the harness uses them.
import type { ZodType } from 'zod';
import type { Entitlement } from './access.js';
import type { LocalePack } from './locale.js';
import type { TranscribeInput, Transcript } from './media.js';
import type { EvidenceEvent, LearnerProfile } from './memory.js';
import type { ModelChunk, ModelRequest } from './model.js';
import type {
  PaymentEvent,
  PaymentOffer,
  ProviderId,
  ProviderRef,
  ProviderSubscription,
} from './payments.js';
import type { GuardResult, SafetyAlert, SafetyEventCode } from './safety.js';
import type { Money, Skill, ToolName, Usage } from './shared.js';
import type { AgentConfig, PackageConfig, StyleCard } from './teacher.js';
import type { TurnTrace } from './trace.js';
import type { Chunk, Message, TeacherQuestion, TurnContext, TurnInput } from './turn.js';

export interface Guard {
  name: string;
  stage: 'pre' | 'post';
  check(x: { input?: TurnInput; draft?: string; ctx: TurnContext }): Promise<GuardResult>;
}

export interface RetrievalIndex {
  /** The filter is required: there is no way to search a teacher's material without it. */
  search(
    q: string,
    scope: { teacherId: string; allowedModuleIds: string[] },
    k: number,
  ): Promise<Chunk[]>;
  /** Code-only: says whether locked modules match, never returns their text. */
  probe(
    q: string,
    scope: { teacherId: string; moduleIds: string[] },
  ): Promise<{ hit: boolean; score: number }>;
  /**
   * Code-only (ADR-0007): true when any candidate shares an 8+ token span with this teacher's
   * material outside `allowedModuleIds` (and not also in them). One boolean for the whole batch:
   * never text, spans, scores or counts. Fails closed: a timeout or error counts as a hit.
   */
  leakCheck(
    candidates: readonly string[],
    scope: { teacherId: string; allowedModuleIds: string[] },
  ): Promise<{ hit: boolean }>;
}

export interface EntitlementStore {
  resolve(
    x: { studentId: string; agentId: string; source: Entitlement['source'] },
    at: string,
  ): Promise<Entitlement | null>;
}

/**
 * The config a turn runs on (ADR-0004): pkg at e.packageVersion, agent at exactly the session row's
 * `agent_version` (set server-side when the session is created, never from the client), the latest
 * style card for agent.styleCardId, and the locale pack for e.market.
 * A session id is never trusted on its own: `load` returns null unless the session row's studentId,
 * teacherId and agentId equal the entitlement's and the session is open (not ended).
 * `entitle` also checks every loaded object belongs to the entitlement (agent.id === e.agentId,
 * agent.teacherId === e.teacherId, and so on); null or any mismatch fails closed with `no_access`.
 */
export interface TurnConfigStore {
  load(
    e: Entitlement,
    sessionId: string,
  ): Promise<{
    agent: AgentConfig;
    pkg: PackageConfig;
    styleCard: StyleCard;
    locale: LocalePack;
    /** sessions.help_state as stored, unvalidated; the harness owns its shape (ADR-0005). */
    helpState: unknown;
  } | null>;
}

/**
 * Saves the help state of a session (ADR-0005). Bound to one student x teacher at construction;
 * writes only that student's own open session, else rejects with `not_found`. Last write wins.
 */
export interface SessionStateStore {
  saveHelpState(sessionId: string, helpState: unknown): Promise<void>;
}

/** Speech to text for recordings (ADR-0005). Throws on failure; never returns an empty transcript. */
export interface Transcriber {
  transcribe(i: TranscribeInput): Promise<Transcript>;
}

export interface ProfileStore {
  get(studentId: string, teacherId: string): Promise<LearnerProfile>;
  applyEvidence(e: EvidenceEvent[]): Promise<LearnerProfile>;
}

export interface TranscriptStore {
  history(sessionId: string, limit: number): Promise<Message[]>;
  append(sessionId: string, m: Message): Promise<void>;
}

/** Teacher answers and corrections become teacher notes and eval cases. */
export interface CorrectionStore {
  addTeacherNote(n: {
    teacherId: string;
    moduleId: string;
    question: string;
    answer: string;
    origin: 'correction' | 'teacher_answer';
  }): Promise<{ chunkId: string; evalCaseId: string }>;
}

export interface TeacherQuestionStore {
  open(q: Omit<TeacherQuestion, 'id' | 'status' | 'createdAt'>): Promise<TeacherQuestion>;
  findSimilar(teacherId: string, text: string): Promise<TeacherQuestion[]>;
}

export interface UsageMeter {
  record(
    u: Usage,
    ctx: {
      teacherId: string;
      packageId: string;
      studentId: string;
      turnId: string;
      source: Entitlement['source'];
    },
  ): Promise<void>;
}

export interface ModelGateway {
  stream(req: ModelRequest): AsyncIterable<ModelChunk>;
  generateObject<T>(req: ModelRequest, schema: ZodType<T>): Promise<T>;
  embed(texts: string[]): Promise<number[][]>;
}

export interface Tool<I, O> {
  name: ToolName;
  /** The registry only offers tools whose skill is in the entitlement. */
  skill: Skill;
  description: string;
  input: ZodType<I>;
  output: ZodType<O>;
  run(input: I, ctx: TurnContext): Promise<O>;
}

export interface TraceSink {
  record(t: TurnTrace): Promise<void>;
}

export interface AlertSink {
  raise(a: SafetyAlert): Promise<void>;
}

/**
 * Where moderationIn and jailbreak record a block (ADR-0006, which extends ADR-0002's port list).
 * Ids, the guard, a fixed code and whether a rule or the classifier decided: never text. Resolves
 * once the event is durably queued; `${turnId}:${guard}` is its dedupe key.
 */
export interface SafetyEventSink {
  record(e: {
    studentId: string;
    teacherId: string;
    sessionId: string;
    turnId: string;
    guard: 'moderationIn' | 'jailbreak';
    code: SafetyEventCode;
    source: 'rule' | 'classifier';
  }): Promise<void>;
}

/**
 * One payment provider (ADR-0015). Callers get it only from `paymentsFor(market)` (the market's
 * LocalePack.payments.provider) or `forProvider(id)` (the webhook route's own config), never by
 * importing an adapter. Every write takes an idempotency key (`^[A-Za-z0-9_-]{8,128}$`, built from
 * Edmate ids, never personal data): the same key and input give the same result; the same key with
 * other input throws `conflict`. Only Edmate's opaque ids, the offer name and price, the return URL
 * and the key are sent to a provider. An operation the provider can't do natively throws
 * `unsupported`; it is never emulated with hidden state. Errors are `PaymentsError` (packages/payments)
 * and never carry a body, key, secret, header or tokened URL.
 */
export interface Payments {
  readonly provider: ProviderId;
  /** url: the provider's hosted https page; returnUrl is https and built server-side from config. */
  startCheckout(x: {
    subscriptionId: string;
    offer: PaymentOffer;
    returnUrl: string;
    idempotencyKey: string;
  }): Promise<{ checkoutRef: ProviderRef; url: string; providerRef?: ProviderRef }>;
  /** 'now' with 'prorate' is the upgrade; 'period_end' for downgrades. Replaces any scheduled change. */
  changePlan(
    x: { providerRef: ProviderRef; offer: PaymentOffer; idempotencyKey: string } & (
      { when: 'now'; proration: 'prorate' | 'none' } | { when: 'period_end' }
    ),
  ): Promise<ProviderSubscription>;
  pause(x: {
    providerRef: ProviderRef;
    when: 'now' | 'period_end';
    idempotencyKey: string;
  }): Promise<ProviderSubscription>;
  /** Ends a pause now; the returned snapshot's periodEnd is the truth about billing. */
  resume(x: { providerRef: ProviderRef; idempotencyKey: string }): Promise<ProviderSubscription>;
  cancel(x: {
    providerRef: ProviderRef;
    when: 'now' | 'period_end';
    idempotencyKey: string;
  }): Promise<ProviderSubscription>;
  /** Undoes a scheduled plan change, cancel or pause. */
  clearScheduled(x: {
    providerRef: ProviderRef;
    idempotencyKey: string;
  }): Promise<ProviderSubscription>;
  getSubscription(providerRef: ProviderRef): Promise<ProviderSubscription>;
  /** No amount = full refund. Checks existing refunds first, so it never refunds twice. */
  refund(x: {
    paymentRef: ProviderRef;
    amount?: Money;
    idempotencyKey: string;
  }): Promise<{ refundRef: ProviderRef; status: 'pending' | 'succeeded' }>;
  /**
   * Verifies the signature over the exact bytes first (constant time, any configured secret, at
   * most 300 s of timestamp tolerance where the provider signs one; bodies over 1 MiB refused),
   * then parses with the provider's own schemas. Header names are lower case. Throws on any
   * failure (`malformed_event` for an unknown status or a missing subscriptionId); never returns
   * unverified data and never maps anything to `active` by default.
   */
  parseWebhook(x: {
    rawBody: Uint8Array;
    headers: Readonly<Record<string, string>>;
    receivedAt: string;
  }): Promise<PaymentEvent>;
}
