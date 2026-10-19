// In-memory port doubles for pipeline tests. Synthetic data only.
import type {
  AlertSink,
  Message,
  SafetyAlert,
  SessionStateStore,
  TraceSink,
  TranscriptStore,
  TurnTrace,
  UsageMeter,
} from '@edmate/contracts';

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
