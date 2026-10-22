// The gate agent's write ports (task 8.7 Phase B). The gate is a rehearsal: nothing it does may
// become durable. Alerts never page on-call, safety blocks never become safety events, an
// ask-the-teacher reply never lands in the teacher's inbox, and transcripts, help state, profiles
// and traces live in memory for one case and are dropped. Each no-op is counted (never silently
// lost) so a run summary can say what the agent would have done.
import { randomUUID } from 'node:crypto';
import type {
  AlertSink,
  LearnerProfile,
  Message,
  ProfileStore,
  SafetyEventSink,
  SessionStateStore,
  TeacherQuestion,
  TeacherQuestionStore,
  TraceSink,
  TranscriptStore,
  Usage,
} from '@edmate/contracts';
import type { UnmeteredUsage } from '@edmate/gateway';
import type { Clock, IdKind, IdSource, TurnLog } from '@edmate/harness';

/** What the agent would have done outside the gate, counted per run. */
export interface GateSideEffects {
  alerts: number;
  safetyEvents: number;
  teacherQuestions: number;
  traces: number;
  /** Every background report the runner logged, whatever its kind (`log.backgroundFailure`).
   * agent.ts fails the case on all but a `LockedLeakDetected` one (counted separately below). */
  backgroundFailures: number;
  /** `LockedLeakDetected` background reports: the locked-stream guard withheld text and the
   * reply was replaced. Still counted in `backgroundFailures` too (every report is logged
   * there); this is the one agent.ts never fails a case over, surfaced on its own for a run
   * summary. */
  lockedLeaks: number;
}

export function gateSideEffects(): GateSideEffects {
  return { alerts: 0, safetyEvents: 0, teacherQuestions: 0, traces: 0, backgroundFailures: 0, lockedLeaks: 0 };
}

export interface GateUsageTotals {
  /** Priced calls. */
  calls: number;
  costMicroUsd: number;
  /** Calls with no usage or no price: never counted as free (lessons: unpriced usage as $0). */
  unmetered: number;
  /** The distinct unmetered reasons, e.g. `unpriced_model:<id>` (never request content). */
  unmeteredReasons: string[];
}

/**
 * One run's usage: the pipeline's `UsageMeter` and the metered router's `MeterSink` in one (the
 * two `record` contexts differ, and the gate ignores both: it only sums).
 */
export interface GateUsageMeter {
  /**
   * `ctx` is `unknown` only so this shape fits both callers' own, unrelated context types (the
   * pipeline's `UsageMeter` and the metered router's `MeterSink`, see the type's own doc comment
   * above); the gate ignores `ctx` either way, it never widens or narrows it (8.7b review LOW).
   */
  record(u: Usage, ctx?: unknown): Promise<void>;
  recordUnmetered(u: UnmeteredUsage): Promise<void>;
  totals(): GateUsageTotals;
}
export function gateUsageMeter(): GateUsageMeter {
  let calls = 0;
  let costMicroUsd = 0;
  let unmetered = 0;
  const reasons = new Set<string>();
  return {
    record(u: Usage) {
      calls += 1;
      costMicroUsd += u.costMicroUsd;
      return Promise.resolve();
    },
    recordUnmetered(u: UnmeteredUsage) {
      unmetered += 1;
      reasons.add(u.reason);
      return Promise.resolve();
    },
    totals: () => ({ calls, costMicroUsd, unmetered, unmeteredReasons: [...reasons].sort() }),
  };
}

/** The in-memory ports for one gate case (one fresh session). */
export interface GateCasePorts {
  transcripts: TranscriptStore;
  sessionState: SessionStateStore;
  helpState(sessionId: string): unknown;
  profiles: ProfileStore;
  traces: TraceSink;
  alerts: AlertSink;
  safetyEvents: SafetyEventSink;
  teacherQuestions: TeacherQuestionStore;
  log: TurnLog;
}

export function gateCasePorts(effects: GateSideEffects): GateCasePorts {
  const transcripts = new Map<string, Message[]>();
  const helpStates = new Map<string, unknown>();
  const profile = (studentId: string, teacherId: string): LearnerProfile => ({
    studentId,
    teacherId,
    lang: 'en',
    mastery: {},
    mistakes: [],
  });
  return {
    transcripts: {
      history: (sessionId, limit) => {
        const all = transcripts.get(sessionId) ?? [];
        return Promise.resolve(limit <= 0 ? [] : all.slice(-limit));
      },
      append: (sessionId, m) => {
        transcripts.set(sessionId, [...(transcripts.get(sessionId) ?? []), m]);
        return Promise.resolve();
      },
    },
    sessionState: {
      saveHelpState: (sessionId, helpState) => {
        helpStates.set(sessionId, helpState);
        return Promise.resolve();
      },
    },
    helpState: (sessionId) => helpStates.get(sessionId) ?? null,
    profiles: {
      get: (studentId, teacherId) => Promise.resolve(profile(studentId, teacherId)),
      // Evidence from a rehearsal never moves anyone's mastery.
      applyEvidence: (events) => {
        const [first] = events;
        return Promise.resolve(profile(first?.studentId ?? '', first?.teacherId ?? ''));
      },
    },
    traces: {
      record: () => {
        effects.traces += 1;
        return Promise.resolve();
      },
    },
    alerts: {
      raise: () => {
        effects.alerts += 1;
        return Promise.resolve();
      },
    },
    safetyEvents: {
      record: () => {
        effects.safetyEvents += 1;
        return Promise.resolve();
      },
    },
    teacherQuestions: {
      findSimilar: () => Promise.resolve([]),
      open: (q) => {
        effects.teacherQuestions += 1;
        const question: TeacherQuestion = {
          ...q,
          id: `gateq_${randomUUID()}`,
          status: 'open',
          createdAt: new Date().toISOString(),
        };
        return Promise.resolve(question);
      },
    },
    log: {
      backgroundFailure: () => {
        effects.backgroundFailures += 1;
      },
    },
  };
}

/** A real clock: `Date.now()` and a cancellable sleep. */
export function systemClock(): Clock {
  return {
    now: () => Date.now(),
    sleep: (ms, cancel) =>
      new Promise((resolve) => {
        const t = setTimeout(resolve, ms);
        cancel?.onCancel(() => {
          clearTimeout(t);
          resolve();
        });
      }),
  };
}

/** Real ids: `crypto.randomUUID()`, prefixed by kind. */
export function systemIds(): IdSource {
  return { next: (kind: IdKind) => `${kind}_${randomUUID()}` };
}
