// Ports from Core contracts, type-only (functions can't be Zod data; lead answer Q1). The db,
// gateway, ingest and worker packages implement them by importing contracts; the harness uses them.
import type { ZodType } from 'zod';
import type { Entitlement } from './access.js';
import type { EvidenceEvent, LearnerProfile } from './memory.js';
import type { ModelChunk, ModelRequest } from './model.js';
import type { GuardResult, SafetyAlert } from './safety.js';
import type { Skill, ToolName, Usage } from './shared.js';
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
}

export interface EntitlementStore {
  resolve(
    x: { studentId: string; agentId: string; source: Entitlement['source'] },
    at: string,
  ): Promise<Entitlement | null>;
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
