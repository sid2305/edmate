// Step 7 stub (teaching policy in 3.5, prompts in 3.6). Both throw: the `ask` fallback needs a
// composed system prompt, which does not exist yet, so the turn ends with `provider_error`.
import { StepNotImplementedError } from '../errors.js';
import type { Steps } from '../types.js';

export const decide: Steps['decide'] = {
  run: () => Promise.reject(new StepNotImplementedError('decide')),
  fallback: () => {
    throw new StepNotImplementedError('decide');
  },
};
