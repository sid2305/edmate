// The body of the worker `checkSafeRegexGuarded` (safeRegexGuard.ts) spawns for the hard
// wall-clock ceiling (task 3.10, fix round 1). Runs `checkSafeRegex` once and posts the result
// back; the main thread kills the worker if this takes too long. Never imported by any other
// module (it has side effects at import time: it reads `workerData` and posts a message).
import { parentPort, workerData } from 'node:worker_threads';
import { checkSafeRegex, type TimingOptions } from './safeRegex.js';

interface WorkerInput {
  source: string;
  opts: TimingOptions;
}

const { source, opts } = workerData as WorkerInput;
parentPort?.postMessage(checkSafeRegex(source, opts));
