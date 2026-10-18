// PROVISIONAL default model policy (task 2.3). The default model mix is an open decision to be
// made after task 7.6 (build plan, "Default model mix"); 7.6 is expected to replace these values.
// This file is the only place under src/router/ that names a model id. Anthropic is the main
// provider (decision log, 18 Oct 2026); no fallback by default: a deployment that wants one
// sets it in its own policy.
import type { ModelPolicy } from '@edmate/contracts';

export const DEFAULT_MODEL_POLICY: ModelPolicy = Object.freeze({
  tiers: Object.freeze({
    small: Object.freeze({ provider: 'anthropic', model: 'claude-haiku-4-5' }),
    main: Object.freeze({ provider: 'anthropic', model: 'claude-sonnet-4-5' }),
  }),
});
