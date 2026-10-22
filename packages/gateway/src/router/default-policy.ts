// The default model mix per package tier (task 8.6a; decision B-42, decision log 22 Oct 2026).
// Sonnet 5 answers every teaching reply on free and paid packages alike; Haiku 4.5 runs the router,
// guards and classifiers on every tier. This is the one config table for the mix: changing it is a
// one-row PR here, plus a price in src/pricing/prices.yaml (test/pricing/estimate.test.ts fails if
// a model in the mix has no price). Free replies may drop to Haiku once task 7.6 has real numbers.
// This file is the only place under src/router/ that names a model id. Anthropic is the main
// provider (decision log, 18 Oct 2026); no fallback by default: a deployment that wants one sets it
// in its own policy.
import type { ModelPolicy } from '@edmate/contracts';

/** A package's tier for the model mix: a free package or a paid one. */
export type PackageMixTier = 'free' | 'paid';

function mix(main: string, small: string): ModelPolicy {
  return Object.freeze({
    tiers: Object.freeze({
      small: Object.freeze({ provider: 'anthropic', model: small }),
      main: Object.freeze({ provider: 'anthropic', model: main }),
    }),
  });
}

/** The model policy each package tier's agent is built with (B-42). Frozen. */
export const MODEL_MIX: Readonly<Record<PackageMixTier, ModelPolicy>> = Object.freeze({
  free: mix('claude-sonnet-5', 'claude-haiku-4-5'),
  paid: mix('claude-sonnet-5', 'claude-haiku-4-5'),
});

/** The policy an agent gets when nothing names one: the paid mix. */
export const DEFAULT_MODEL_POLICY: ModelPolicy = MODEL_MIX.paid;
