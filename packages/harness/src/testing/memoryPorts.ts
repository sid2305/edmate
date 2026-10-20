// In-memory port doubles for pipeline tests. Synthetic data only.
import type {
  AlertSink,
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
import type { BackgroundFailureLog, TurnLog } from '../pipeline/types.js';

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
