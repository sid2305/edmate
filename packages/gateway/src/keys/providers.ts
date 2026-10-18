// What each provider needs: provider id -> field -> the variable that holds it.
// A provider can need several secrets (say a key plus a credentials JSON), so each entry maps
// fields to variables. Variables use the EDMATE_ prefix, not SDK defaults such as
// OPENAI_API_KEY, so a key can reach an SDK only through this module.
// The main provider's entry is added by task 2.2.
import type { Secret } from './secret.js';

export const PROVIDER_KEYS = {
  'openai-compatible': {
    apiKey: { variable: 'EDMATE_OPENAI_COMPATIBLE_API_KEY' },
  },
} as const satisfies Readonly<
  Record<string, Readonly<Record<string, { readonly variable: string }>>>
>;

export type ProviderId = keyof typeof PROVIDER_KEYS;

/** One Secret per field the provider needs, for example `{ apiKey: Secret }`. */
export type KeysFor<P extends ProviderId> = {
  readonly [F in keyof (typeof PROVIDER_KEYS)[P]]: Secret;
};
