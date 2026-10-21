// `safeRegexWorkerEntry.ts` runs for real only inside a `node:worker_threads` worker, spawned by
// `safeRegexGuard.ts` (see that file's own tests for the protocol this module speaks). Here
// `workerData` is faked to exercise the module's top-level side effect directly: posting the
// check result on the port, then storing and notifying the shared flag itself.
import { afterEach, describe, expect, it, vi } from 'vitest';

let workerData: { source: string; opts: Record<string, unknown>; port: unknown; flag: Int32Array };

vi.mock('node:worker_threads', () => ({
  get workerData() {
    return workerData;
  },
}));

describe('safeRegexWorkerEntry', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('posts the check result on the port and notifies the shared flag', async () => {
    const posted: unknown[] = [];
    const flag = new Int32Array(new SharedArrayBuffer(4));
    workerData = { source: '(a+)+$', opts: {}, port: { postMessage: (m: unknown) => posted.push(m) }, flag };
    await import('./safeRegexWorkerEntry.js');
    expect(posted).toEqual([['nests a quantifier inside a repeated group']]);
    expect(Atomics.load(flag, 0)).toBe(1);
  });
});
