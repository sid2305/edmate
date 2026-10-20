// Step 4 (task 3.3): intent and `attempt`, rules first, the small model only for an inconclusive
// intent (src/routing). A rejection (the model failed or timed out) leaves the runner's route
// fallback to apply: `onFailure` is the spec's default, and distress keywords still escalate.
import { classifyTurn } from '../../routing/index.js';
import { ROUTE_DEFAULT } from '../policies.js';
import type { Steps } from '../types.js';

export const route: Steps['route'] = {
  run: (env, s) => classifyTurn(env, s),
  onFailure: (env) =>
    env.deps.distressCheck(env.input.text ?? '', env.input.lang)
      ? { ...ROUTE_DEFAULT, intent: 'distress' }
      : { ...ROUTE_DEFAULT },
};
