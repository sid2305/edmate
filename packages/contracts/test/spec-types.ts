// Verbatim copy of the `ts` block under "## Core contracts" in docs/edmate-harness-build-plan.md,
// with `export ` added before each top-level type and the one import line below. Do not edit by
// hand and do not let Prettier format it (.prettierignore): test/spec-drift.test.ts requires it to
// equal the spec after whitespace normalisation. To regenerate after an approved ADR changes the
// spec, copy the block again, prefix each line starting with `type ` or `interface ` with
// `export `, and keep this header and the import line.
import type { ZodType } from 'zod';
// ---- Shared ----
export type Lang = string;                 // BCP 47 primary tag, e.g. 'en'; the allowed set comes from locale packs
export type Skill = 'explain' | 'coach' | 'practice' | 'feedback' | 'mock_interview' | 'revision' | 'study_plan';   // study_plan ships in P1
export interface Money { amountMinor: number; currency: string }   // amountMinor: integer ≥ 0; currency: ISO 4217
export type ErrorCode = 'unauthorized' | 'forbidden' | 'not_found' | 'validation' | 'no_access' | 'limit_reached'
  | 'rate_limited' | 'input_too_large' | 'turn_cost_exceeded' | 'provider_error' | 'guard_blocked' | 'payment_required';
export interface Usage { model: string; tier: 'small' | 'main'; inputTokens: number; outputTokens: number; costMicroUsd: number }
export type ToolName = string;             // registered tool id, e.g. 'calculator', 'practice.next_item'

// ---- Teacher side ----
export interface AgentConfig {
  id: string; version: number; teacherId: string; courseId: string;
  styleCardId: string;
  promptPackVersion: string;        // one semver pins the whole platform prompt-pack set
  languages: Lang[];
  regulatedSubject?: 'investing' | 'health' | 'law';
  modelPolicy: ModelPolicy;
}
export interface StyleCard { id: string; teacherId: string; version: number; text: string; mistakeTags: string[] }   // text ≤ 300 words
export interface PackageConfig {
  id: string; version: number; teacherId: string; agentId: string; name: string;
  moduleIds: string[];              // knowledge the agent may use
  skills: Skill[];                  // what the agent may do
  helpCeiling: 1 | 2 | 3 | 4;       // effective ceiling = finalAnswers === 'never' ? min(helpCeiling, 3) : helpCeiling
  finalAnswers: 'never' | 'after_attempt' | 'allowed';
  dailyMessageLimit: number;        // rolling 24-hour window; default 20
  liveClassesPerMonth: number;
  pricePerMonth: Money;             // amountMinor 0 = free package
  trialDays?: number;
  lockedReply: 'name_package' | 'generic';
}

// ---- Access ----
export interface Entitlement {             // computed server-side; never from the client
  source: 'subscription' | 'teacher_preview' | 'eval';
  subscriptionId?: string;          // present when source = 'subscription'
  studentId: string; teacherId: string; agentId: string; market: string;   // market: ISO 3166 code of the locale pack
  packageId: string; packageVersion: number;
  status: 'trial' | 'active' | 'past_due' | 'paused' | 'ended';            // `entitle` refuses paused and ended
  periodEnd: string;
  allowedModuleIds: string[]; lockedModuleIds: string[]; skills: Skill[];
}

// ---- A turn ----
export type ChunkKind = 'material' | 'transcript' | 'teacher_note';   // teacher notes = the teacher's answers and corrections; ranked first
export interface SourceRef { title: string; locator: string; kind: ChunkKind }      // locator: page, slide, heading or timestamp
export interface Chunk { id: string; teacherId: string; documentId: string; moduleId: string; kind: ChunkKind; text: string; source: SourceRef; score?: number }
export interface Attachment { kind: 'image'; mime: string; storageKey: string; bytes: number }   // P1 (photo of written work)
export interface Message { id: string; role: 'student' | 'agent' | 'teacher'; text: string; createdAt: string; sources?: SourceRef[] }
export interface TurnInput {
  agentId: string; sessionId: string; studentId: string;   // pseudonymous ids only
  kind: 'message' | 'hint_request' | 'check_answer' | 'skill_action';
  text?: string;                    // ≤ 4,000 characters
  skill?: Skill; skillPayload?: unknown; attachments?: Attachment[];   // ≤ 2 attachments (P1)
  lang: Lang; clientTs: string;
}
export type Intent = 'on_task' | 'answer_seeking' | 'off_topic' | 'distress' | 'misuse' | 'meta';
export type Attempt = 'none' | 'wrong' | 'partial' | 'correct';   // from `route`; drives the help ladder
export interface Persona { id: string; name: string; style: string; mustNot: string[]; endAfterQuestions: number }
export interface TurnContext {
  agent: AgentConfig; pkg: PackageConfig; entitlement: Entitlement; profile: LearnerProfile;
  locale: LocalePack; styleCard: StyleCard;
  history: Message[]; retrieved: Chunk[];
  lockedHit: boolean;               // the question matches a locked module (code-only probe; locked text never enters a prompt)
  persona?: Persona; helpRung: 0 | 1 | 2 | 3 | 4; intent: Intent; attempt: Attempt;
}
export interface PedagogyDecision {
  move: 'ask' | 'hint' | 'worked_example' | 'explain' | 'solution' | 'redirect' | 'check' | 'locked' | 'ask_teacher';
  rung: 0 | 1 | 2 | 3 | 4;
  mustNotReveal: string[];
  systemPrompt: string; tools: ToolName[]; maxOutputTokens: number;
}
export interface TeacherQuestion {         // created by the `ask_teacher` move
  id: string; teacherId: string; agentId: string; studentId: string;   // student identity hidden from the teacher by default
  text: string; moduleHint?: string; similarIds: string[];
  status: 'open' | 'answered' | 'dismissed'; createdAt: string; answeredAt?: string;
}
export type TurnEvent =
  | { type: 'token'; text: string }
  | { type: 'sources'; items: SourceRef[] }
  | { type: 'hint_rung'; rung: number }
  | { type: 'locked'; packageName?: string }
  | { type: 'teacher_question'; questionId: string }
  | { type: 'skill'; skill: Skill; payload: unknown }     // practice items, interview state: structured, not tokens
  | { type: 'safety'; level: 'info' | 'alert' }
  | { type: 'replace'; text: string }
  | { type: 'done'; messageId: string; usage: Usage[] }
  | { type: 'error'; code: ErrorCode; retryable: boolean };

// ---- Model access ----
export interface ModelPolicy {
  tiers: Record<'small' | 'main', { provider: string; model: string }>;
  fallback?: { provider: string; model: string };
}
// Embeddings are platform-wide config (provider, model, dims), never per agent: changing them re-indexes every teacher.
export interface ModelRequest {
  tier: 'small' | 'main'; system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  tools?: { name: ToolName; description: string; inputSchema: unknown }[];
  maxOutputTokens: number; temperature?: number; cacheKey?: string;
}
export type ModelChunk =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: ToolName; args: unknown }
  | { type: 'usage'; usage: Usage };

// ---- Safety, memory, tracing, locale ----
export interface SafetyAlert {
  id: string; level: 'info' | 'alert' | 'critical'; kind: 'distress' | 'abuse' | 'misuse' | 'other';
  studentId: string; teacherId: string; sessionId: string; excerptRedacted: string; createdAt: string;
}
export type GuardResult =
  | { ok: true }
  | { ok: false; action: 'block'; reason: string }
  | { ok: false; action: 'rewrite'; text: string; reason: string }   // text = the replacement input or reply
  | { ok: false; action: 'escalate'; alert: SafetyAlert };
export interface Guard { name: string; stage: 'pre' | 'post'; check(x: { input?: TurnInput; draft?: string; ctx: TurnContext }): Promise<GuardResult> }
export interface LearnerProfile {          // one per (student, teacher)
  studentId: string; teacherId: string; lang: Lang;
  mastery: Record<string, { p: number; n: number; updatedAt: string }>;   // topic id -> P(known)
  mistakes: { tag: string; count: number; lastSeen: string }[];
  lastSummary?: string;             // ≤ 60 words, from the previous session
}
export interface TurnTrace {
  turnId: string; sessionId: string; agentVersion: number; packageVersion: number;
  steps: { name: string; ms: number; outcome: 'ok' | 'fallback' | 'failed' }[];
  intent: Intent; move: PedagogyDecision['move']; guards: { name: string; ok: boolean; action?: string }[]; usage: Usage[];
}
export interface LocalePack {
  market: string; languages: Lang[]; timezone: string;            // IANA, e.g. 'Asia/Kolkata'
  currency: { code: string; format: string };
  payments: { methods: string[]; provider: string };
  helplines: { name: string; number: string; kind: string }[];
  compliance: { privacyLaw: string; minAge: number; dataRegion: string; grievance: string };
  regulatedDisclaimers: Partial<Record<'investing' | 'health' | 'law', string>>; piiPatterns: string[];
}

// ---- Ports (the harness defines them; db, gateway, ingest and worker implement them) ----
export interface RetrievalIndex {
  // The filter is required: there is no way to search a teacher's material without it.
  search(q: string, scope: { teacherId: string; allowedModuleIds: string[] }, k: number): Promise<Chunk[]>;
  // Code-only: says whether locked modules match, never returns their text.
  probe(q: string, scope: { teacherId: string; moduleIds: string[] }): Promise<{ hit: boolean; score: number }>;
}
export interface EntitlementStore { resolve(x: { studentId: string; agentId: string; source: Entitlement['source'] }, at: string): Promise<Entitlement | null> }
export interface ProfileStore { get(studentId: string, teacherId: string): Promise<LearnerProfile>; applyEvidence(e: EvidenceEvent[]): Promise<LearnerProfile> }
export interface TranscriptStore { history(sessionId: string, limit: number): Promise<Message[]>; append(sessionId: string, m: Message): Promise<void> }
export interface CorrectionStore {         // teacher answers and corrections become teacher notes + eval cases
  addTeacherNote(n: { teacherId: string; moduleId: string; question: string; answer: string; origin: 'correction' | 'teacher_answer' }): Promise<{ chunkId: string; evalCaseId: string }>;
}
export interface TeacherQuestionStore { open(q: Omit<TeacherQuestion, 'id' | 'status' | 'createdAt'>): Promise<TeacherQuestion>; findSimilar(teacherId: string, text: string): Promise<TeacherQuestion[]> }
export interface UsageMeter { record(u: Usage, ctx: { teacherId: string; packageId: string; studentId: string; turnId: string; source: Entitlement['source'] }): Promise<void> }
export interface ModelGateway {
  stream(req: ModelRequest): AsyncIterable<ModelChunk>;
  generateObject<T>(req: ModelRequest, schema: ZodType<T>): Promise<T>;
  embed(texts: string[]): Promise<number[][]>;
}
export interface Tool<I, O> {
  name: ToolName; skill: Skill;      // the registry only offers tools whose skill is in the entitlement
  description: string; input: ZodType<I>; output: ZodType<O>;
  run(input: I, ctx: TurnContext): Promise<O>;
}
export interface EvidenceEvent { studentId: string; teacherId: string; topicId: string; correct: boolean; source: 'check' | 'practice' | 'rubric'; weight: number; ts: string }
export interface TraceSink { record(t: TurnTrace): Promise<void> }
export interface AlertSink { raise(a: SafetyAlert): Promise<void> }
