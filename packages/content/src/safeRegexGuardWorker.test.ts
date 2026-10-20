// Tests for the worker-protocol branches of `checkSafeRegexGuarded` that this package's own test
// run cannot reach for real (no `dist` build, so the compiled worker file never exists -- see
// safeRegexGuard.test.ts). `node:fs` and `node:worker_threads` are mocked here to make the
// compiled file "exist" and to stand in for a worker thread.
//
// The fake `Worker` sets the shared flag (and, for the 'answers' case, the pending port message)
// synchronously in its constructor, before `checkSafeRegexGuarded` ever calls `Atomics.wait`.
// That is not a shortcut around the real protocol: it models the real, legitimate race where a
// worker thread finishes and calls `Atomics.notify` before the main thread reaches its own
// `Atomics.wait` call -- `Atomics.wait` returns immediately, "not-equal", whenever the flag no
// longer holds the value it was told to expect, exactly as it would here. The 'silent' case models
// the other real outcome this module documents: nothing ever notifies the flag, and the real
// `Atomics.wait` genuinely blocks for the ceiling before timing out.
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

type Behavior = 'answers' | 'silent' | 'throw';

let behavior: Behavior = 'answers';
let answerPayload: string[] = [];
let terminateCalls = 0;
let lastWorkerData: { source: string; opts: unknown } | undefined;
let pendingMessage: string[] | undefined;

class FakeWorker extends EventEmitter {
  constructor(
    _url: URL,
    opts: { workerData: { source: string; opts: unknown; flag: Int32Array } },
  ) {
    super();
    const { source, opts: innerOpts, flag } = opts.workerData;
    lastWorkerData = { source, opts: innerOpts };
    if (behavior === 'throw') throw new Error('cannot start a worker here');
    if (behavior === 'answers') {
      pendingMessage = answerPayload;
      Atomics.store(flag, 0, 1);
      Atomics.notify(flag, 0);
    }
  }
  terminate(): void {
    terminateCalls++;
  }
}

class FakeMessageChannel {
  port1 = {
    close: vi.fn(),
  };
  port2 = {
    close: vi.fn(),
  };
}

function fakeReceiveMessageOnPort(): { message: string[] } | undefined {
  if (pendingMessage === undefined) return undefined;
  const message = pendingMessage;
  pendingMessage = undefined;
  return { message };
}

vi.mock('node:fs', () => ({ existsSync: () => true }));
vi.mock('node:worker_threads', () => ({
  Worker: FakeWorker,
  MessageChannel: FakeMessageChannel,
  receiveMessageOnPort: fakeReceiveMessageOnPort,
}));

const { checkSafeRegexGuarded } = await import('./safeRegexGuard.js');

describe('checkSafeRegexGuarded (mocked worker protocol)', () => {
  afterEach(() => {
    behavior = 'answers';
    answerPayload = [];
    terminateCalls = 0;
    lastWorkerData = undefined;
    pendingMessage = undefined;
  });

  it('returns the worker result when it answers before the ceiling, and terminates it', () => {
    answerPayload = [];
    expect(checkSafeRegexGuarded('a', {}, 50)).toEqual([]);
    expect(terminateCalls).toBe(1);
  });

  it('passes the source and plain-data opts through to the worker', () => {
    checkSafeRegexGuarded('(a|aa)+', { budgetMs: 10, attempts: 1, units: ['x'] }, 50);
    expect(lastWorkerData).toEqual({
      source: '(a|aa)+',
      opts: { budgetMs: 10, attempts: 1, units: ['x'] },
    });
  });

  it('relays an issue the worker found', () => {
    answerPayload = ['repeats an alternation whose branches can start the same way'];
    expect(checkSafeRegexGuarded('(a|aa)+', {}, 50)).toEqual([
      'repeats an alternation whose branches can start the same way',
    ]);
  });

  it('falls back to the in-process check when a worker cannot even start', () => {
    behavior = 'throw';
    expect(checkSafeRegexGuarded('(a+)+$', {}, 50)).toEqual([
      'nests a quantifier inside a repeated group',
    ]);
  });

  it('reports the pattern unsafe and terminates the worker when nothing answers by the ceiling', () => {
    behavior = 'silent';
    const start = performance.now();
    expect(checkSafeRegexGuarded('a', {}, 40)).toEqual([
      'exceeded the 40 ms hard limit for the load/validate path (terminated)',
    ]);
    expect(performance.now() - start).toBeGreaterThanOrEqual(40);
    expect(terminateCalls).toBe(1);
  });
});
