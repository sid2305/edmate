// Step 3 stubs (guards come in 4.1-4.4). Both throw, so step 3 fails closed: `guard_blocked`.
import { StepNotImplementedError } from '../errors.js';
import type { Steps } from '../types.js';

/** Phase 1: regex-only PII scrub (4.2). */
export const scrub: Steps['scrub'] = () => Promise.reject(new StepNotImplementedError('scrub'));

/** Phase 2: moderation and jailbreak (4.3, 4.4), concurrent with route and buildContext. */
export const preGuard: Steps['preGuard'] = () =>
  Promise.reject(new StepNotImplementedError('preGuard'));
