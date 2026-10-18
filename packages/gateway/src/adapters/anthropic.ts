// The main provider (decision log, 18 Oct 2026). The key is revealed once, here, into the SDK
// client. The base URL is always passed so the SDK never reads ANTHROPIC_BASE_URL, and the
// key always, so it never falls back to ANTHROPIC_API_KEY.
import { createAnthropic } from '@ai-sdk/anthropic';
import type { KeysFor } from '../keys/providers.js';
import { createSdkAdapter } from './sdk-adapter.js';
import type { AdapterCapabilities, ModelAdapter } from './types.js';

export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';

/** Fixed: one provider, one family of models. Anthropic has no embeddings API. */
export const ANTHROPIC_CAPABILITIES: AdapterCapabilities = Object.freeze({
  tools: true,
  streaming: true,
  json: true,
  vision: true,
  embeddings: false,
  maxContextTokens: 200_000,
});

type FetchFunction = NonNullable<NonNullable<Parameters<typeof createAnthropic>[0]>['fetch']>;

export interface AnthropicAdapterOptions {
  /** The model id, chosen by the router from ModelPolicy (task 2.3). */
  readonly model: string;
  /** Transport override (tests pass a fake; production uses the global fetch). */
  readonly fetch?: FetchFunction;
}

export function createAnthropicAdapter(
  keys: KeysFor<'anthropic'>,
  opts: AnthropicAdapterOptions,
): ModelAdapter {
  const provider = createAnthropic({
    apiKey: keys.apiKey.reveal(),
    baseURL: ANTHROPIC_BASE_URL,
    ...(opts.fetch === undefined ? {} : { fetch: opts.fetch }),
  });
  return createSdkAdapter({
    id: 'anthropic',
    model: opts.model,
    languageModel: provider(opts.model),
    capabilities: ANTHROPIC_CAPABILITIES,
  });
}
