// Step stub: built by a later task (see packages/harness/README.md). It throws, so the runner
// applies this step's failure policy; no stub returns success data (fail closed).
import { StepNotImplementedError } from '../errors.js';
import type { Steps } from '../types.js';

export const commit: Steps['commit'] = () => Promise.reject(new StepNotImplementedError('commit'));
