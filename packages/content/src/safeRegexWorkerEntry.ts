// The body of the worker `checkSafeRegexGuarded` (safeRegexGuard.ts) spawns for the hard
// wall-clock ceiling (task 3.10, fix round 1). Runs `checkSafeRegex` once, posts the result back
// over the transferred port, then stores and wakes the shared flag itself -- the main thread is
// blocked in `Atomics.wait`, which only a direct `Atomics.notify` on that flag can wake; a
// `postMessage` alone would queue a 'message' event that the main thread's event loop cannot
// process while it is synchronously blocked. Never imported by any other module (it has side
// effects at import time: it reads `workerData` and runs the check).
import type { MessagePort } from 'node:worker_threads';
import { workerData } from 'node:worker_threads';
import { checkSafeRegex, type TimingOptions } from './safeRegex.js';

interface WorkerInput {
  source: string;
  opts: TimingOptions;
  port: MessagePort;
  flag: Int32Array;
}

const { source, opts, port, flag } = workerData as WorkerInput;
port.postMessage(checkSafeRegex(source, opts));
Atomics.store(flag, 0, 1);
Atomics.notify(flag, 0);
