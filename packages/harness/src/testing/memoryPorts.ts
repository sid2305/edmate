// In-memory port doubles for pipeline tests. Synthetic data only.
import type {
  AlertSink,
  CorrectionStore,
  EvidenceEvent,
  LearnerProfile,
  Message,
  ProfileStore,
  SafetyAlert,
  SafetyEventSink,
  SessionStateStore,
  TeacherQuestion,
  TeacherQuestionStore,
  TraceSink,
  TranscriptStore,
  TurnTrace,
  UsageMeter,
} from '@edmate/contracts';
import { teacherNoteSource, teacherNoteText } from '../pipeline/teacherNote.js';
import type { BackgroundFailureLog, TurnLog } from '../pipeline/types.js';
import type { MemoryRetrieval } from './memoryRetrieval.js';

export interface MemoryTraceSink extends TraceSink {
  readonly records: TurnTrace[];
}

export function memoryTraceSink(opts: { fail?: boolean } = {}): MemoryTraceSink {
  const records: TurnTrace[] = [];
  return {
    records,
    record(t) {
      records.push(t);
      return opts.fail === true ? Promise.reject(new Error('trace sink down')) : Promise.resolve();
    },
  };
}

export interface MemoryUsageMeter extends UsageMeter {
  readonly rows: {
    usage: Parameters<UsageMeter['record']>[0];
    ctx: Parameters<UsageMeter['record']>[1];
  }[];
}

export function memoryUsageMeter(): MemoryUsageMeter {
  const rows: MemoryUsageMeter['rows'] = [];
  return {
    rows,
    record(usage, ctx) {
      rows.push({ usage, ctx });
      return Promise.resolve();
    },
  };
}

export interface MemoryTranscriptStore extends TranscriptStore {
  /** Every append, in order. */
  readonly appended: { sessionId: string; message: Message }[];
}

/** Appends to an in-memory list; `history` returns the session's newest `limit`, oldest first. */
export function memoryTranscriptStore(opts: { fail?: boolean } = {}): MemoryTranscriptStore {
  const appended: MemoryTranscriptStore['appended'] = [];
  return {
    appended,
    history(sessionId, limit) {
      const rows = appended.filter((a) => a.sessionId === sessionId).map((a) => a.message);
      return Promise.resolve(rows.slice(Math.max(0, rows.length - limit)));
    },
    append(sessionId, message) {
      if (opts.fail === true) return Promise.reject(new Error('transcript store down'));
      appended.push({ sessionId, message });
      return Promise.resolve();
    },
  };
}

export interface MemorySessionStateStore extends SessionStateStore {
  /** Every save, in order (last write wins). */
  readonly saved: { sessionId: string; helpState: unknown }[];
}

export function memorySessionStateStore(opts: { fail?: boolean } = {}): MemorySessionStateStore {
  const saved: MemorySessionStateStore['saved'] = [];
  return {
    saved,
    saveHelpState(sessionId, helpState) {
      if (opts.fail === true) return Promise.reject(new Error('session state store down'));
      saved.push({ sessionId, helpState });
      return Promise.resolve();
    },
  };
}

export interface MemoryAlertSink extends AlertSink {
  /** Alerts delivered (attempts that succeeded). */
  readonly raised: SafetyAlert[];
  /** Every attempt, including failed ones. */
  readonly attempts: number;
}

/** Fails the first `failTimes` attempts, then delivers. */
export function memoryAlertSink(opts: { failTimes?: number } = {}): MemoryAlertSink {
  const raised: SafetyAlert[] = [];
  let attempts = 0;
  return {
    raised,
    get attempts() {
      return attempts;
    },
    raise(a) {
      attempts++;
      if (attempts <= (opts.failTimes ?? 0)) {
        return Promise.reject(new Error(`alert sink down (attempt ${attempts})`));
      }
      raised.push(a);
      return Promise.resolve();
    },
  };
}

/** One `SafetyEventSink.record` call (ADR-0006). */
export type SafetyEvent = Parameters<SafetyEventSink['record']>[0];

export interface MemorySafetyEventSink extends SafetyEventSink {
  /** Events recorded (calls that succeeded). */
  readonly recorded: SafetyEvent[];
  /** Every call, including failed ones. */
  readonly attempts: number;
}

/** Fails the first `failTimes` calls (or every call with `fail`), then records. */
export function memorySafetyEventSink(
  opts: { failTimes?: number; fail?: boolean } = {},
): MemorySafetyEventSink {
  const recorded: SafetyEvent[] = [];
  let attempts = 0;
  return {
    recorded,
    get attempts() {
      return attempts;
    },
    record(e) {
      attempts++;
      if (opts.fail === true || attempts <= (opts.failTimes ?? 0)) {
        return Promise.reject(new Error(`safety event sink down (attempt ${attempts})`));
      }
      recorded.push({ ...e });
      return Promise.resolve();
    },
  };
}

export interface MemoryTeacherQuestionStore extends TeacherQuestionStore {
  /** Every `open` request, in order. */
  readonly opened: Parameters<TeacherQuestionStore['open']>[0][];
  /** Every `findSimilar` call, in order. */
  readonly searched: { teacherId: string; text: string }[];
}

/** Opens questions `tq_mem_<n>`; `similar` is what findSimilar returns; `fail` rejects `open`. */
export function memoryTeacherQuestionStore(
  opts: { similar?: TeacherQuestion[]; fail?: boolean; createdAt?: string } = {},
): MemoryTeacherQuestionStore {
  const opened: MemoryTeacherQuestionStore['opened'] = [];
  const searched: MemoryTeacherQuestionStore['searched'] = [];
  return {
    opened,
    searched,
    findSimilar(teacherId, text) {
      searched.push({ teacherId, text });
      return Promise.resolve((opts.similar ?? []).map((q) => ({ ...q })));
    },
    open(q) {
      opened.push({ ...q, similarIds: [...q.similarIds] });
      if (opts.fail === true) return Promise.reject(new Error('teacher question store down'));
      return Promise.resolve({
        ...q,
        id: `tq_mem_${opened.length}`,
        status: 'open',
        createdAt: opts.createdAt ?? '2026-10-17T10:00:00.000Z',
      });
    },
  };
}

type TeacherNoteInput = Parameters<CorrectionStore['addTeacherNote']>[0];

/** One eval case a teacher note became (the db adapter writes a `teacher_eval_cases` row). */
export interface MemoryEvalCase {
  id: string;
  teacherId: string;
  moduleId: string;
  origin: TeacherNoteInput['origin'];
  question: string;
  answer: string;
  chunkId: string;
}

export interface MemoryCorrectionStore extends CorrectionStore {
  /** Each accepted note, as given, with the chunk it became. */
  readonly notes: (TeacherNoteInput & { chunkId: string })[];
  readonly cases: MemoryEvalCase[];
}

/** 21 Oct 2026, 00:00 UTC: the answer date when no clock is given. */
const CORRECTION_EPOCH_MS = Date.UTC(2026, 9, 21);

/**
 * Task 5.10: a CorrectionStore that writes each teacher note into `retrieval` as one
 * `teacher_note` chunk (text and citation from pipeline/teacherNote.ts, like the db adapter), so a
 * later turn finds it under a scope allowing its module. `moduleOwners` (module id → teacher id),
 * when given, makes an unknown or another teacher's module reject with `not_found`, as the db does.
 * Invalid text rejects with teacherNote's fixed HarnessError. Nothing is written on any rejection.
 */
export function memoryCorrectionStore(opts: {
  retrieval: Pick<MemoryRetrieval, 'add'>;
  clock?: { now(): number };
  moduleOwners?: Readonly<Record<string, string>>;
  fail?: boolean;
}): MemoryCorrectionStore {
  const notes: MemoryCorrectionStore['notes'] = [];
  const cases: MemoryEvalCase[] = [];
  return {
    notes,
    cases,
    addTeacherNote(n) {
      if (opts.fail === true) return Promise.reject(new Error('correction store down'));
      const owners = opts.moduleOwners;
      if (owners !== undefined && owners[n.moduleId] !== n.teacherId) {
        return Promise.reject(new Error('memoryCorrectionStore.addTeacherNote: not_found'));
      }
      let text: string;
      let source: ReturnType<typeof teacherNoteSource>;
      try {
        text = teacherNoteText(n);
        source = teacherNoteSource(n.origin, opts.clock?.now() ?? CORRECTION_EPOCH_MS);
      } catch (e) {
        return Promise.reject(e as Error);
      }
      const k = notes.length + 1;
      const chunkId = `chk_note_${k}`;
      opts.retrieval.add({
        id: chunkId,
        teacherId: n.teacherId,
        documentId: `doc_note_${k}`,
        moduleId: n.moduleId,
        kind: 'teacher_note',
        text,
        source,
      });
      const evalCaseId = `evc_mem_${k}`;
      notes.push({ ...n, chunkId });
      cases.push({
        id: evalCaseId,
        teacherId: n.teacherId,
        moduleId: n.moduleId,
        origin: n.origin,
        // teacherNoteText accepted them, so the trimmed parts are the note's parts.
        question: n.question.trim(),
        answer: n.answer.trim(),
        chunkId,
      });
      return Promise.resolve({ chunkId, evalCaseId });
    },
  };
}

export interface MemoryProfileStore extends ProfileStore {
  /** Every `applyEvidence` call's events, flattened, in order. */
  readonly applied: EvidenceEvent[];
}

/**
 * Starts every (studentId, teacherId) pair at `learnerProfileNew`-shaped defaults (lang `en`, empty
 * mastery/mistakes); `applyEvidence` is a no-op on mastery (no BKT here — that is the db adapter's
 * job) but records what it was called with and returns the pair's current (unmoved) profile,
 * unless `fail` rejects it.
 */
export function memoryProfileStore(opts: { fail?: boolean } = {}): MemoryProfileStore {
  const applied: EvidenceEvent[] = [];
  const profiles = new Map<string, LearnerProfile>();
  const key = (studentId: string, teacherId: string) => `${studentId}\u0000${teacherId}`;
  const of = (studentId: string, teacherId: string): LearnerProfile =>
    profiles.get(key(studentId, teacherId)) ?? {
      studentId,
      teacherId,
      lang: 'en',
      mastery: {},
      mistakes: [],
    };
  return {
    applied,
    get(studentId, teacherId) {
      return Promise.resolve(of(studentId, teacherId));
    },
    applyEvidence(events) {
      if (opts.fail === true) return Promise.reject(new Error('profile store down'));
      applied.push(...events);
      const [first] = events;
      return Promise.resolve(of(first?.studentId ?? '', first?.teacherId ?? ''));
    },
  };
}

export interface MemoryTurnLog extends TurnLog {
  readonly entries: BackgroundFailureLog[];
}

/** Keeps every logged background failure; `fail` makes each call throw (the runner must cope). */
export function memoryTurnLog(opts: { fail?: boolean } = {}): MemoryTurnLog {
  const entries: BackgroundFailureLog[] = [];
  return {
    entries,
    backgroundFailure(entry) {
      if (opts.fail === true) throw new Error('log down');
      entries.push(entry);
    },
  };
}

/** Thrown by a port that a test says must not be touched. */
export class UnusedPortError extends Error {
  override readonly name = 'UnusedPortError';
}

/**
 * A port where every method throws and records `<name>.<method>` in `calls`. Proves which ports a
 * step touched, e.g. that admit and entitle make no model call.
 */
export function unusedPort<T extends object>(name: string, calls: string[] = []): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      // Not a thenable, so `await port` and vitest's matchers don't trip over it.
      if (prop === 'then' || typeof prop === 'symbol') return undefined;
      return () => {
        calls.push(`${name}.${prop}`);
        throw new UnusedPortError(`${name}.${prop} must not be called in this test`);
      };
    },
  });
}
