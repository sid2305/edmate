// Step 3 phase 2 stub (moderation and jailbreak come in 4.3, 4.4). It throws, so step 3 fails
// closed: `guard_blocked`. Phase 1, the PII scrub, is `scrub.ts` (4.2).
import { StepNotImplementedError } from '../errors.js';
import type { Steps } from '../types.js';

/** Phase 2: moderation and jailbreak (4.3, 4.4), concurrent with route and buildContext. */
export const preGuard: Steps['preGuard'] = () =>
  Promise.reject(new StepNotImplementedError('preGuard'));
