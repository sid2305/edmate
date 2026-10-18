// Any OpenAI-shaped endpoint: OpenRouter or a self-hosted server. The key is revealed once,
// here, into the SDK client and always passed, so nothing falls back to OPENAI_API_KEY. There
// is no default base URL: the deployment names the endpoint.
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { KeysFor } from '../keys/providers.js';
import { createSdkAdapter } from './sdk-adapter.js';
import type { AdapterCapabilities, ModelAdapter } from './types.js';

/** Conservative defaults: backends differ, so a deployment raises what its model supports. */
export const OPENAI_COMPATIBLE_DEFAULT_CAPABILITIES: Omit<AdapterCapabilities, 'embeddings'> =
  Object.freeze({
    tools: true,
    streaming: true,
    json: true,
    vision: false,
    maxContextTokens: 8_192,
  });

type FetchFunction = NonNullable<Parameters<typeof createOpenAICompatible>[0]['fetch']>;

export interface OpenAICompatibleAdapterOptions {
  /** The chat model id, chosen by the router from ModelPolicy (task 2.3). */
  readonly model: string;
  /** The endpoint, for example OpenRouter's or a self-hosted server's /v1 URL. */
  readonly baseURL: string;
  /** An embedding model on the same endpoint; when set, embeddings are declared and served. */
  readonly embeddingModel?: string;
  /** What this backend's model can do. `embeddings` follows `embeddingModel`. */
  readonly capabilities?: Partial<Omit<AdapterCapabilities, 'embeddings'>>;
  /**
   * The backend enforces a JSON schema (`response_format: json_schema`). Off by default:
   * generateObject then asks for plain JSON and the schema is checked here.
   */
  readonly structuredOutputs?: boolean;
  /** Transport override (tests pass a fake; production uses the global fetch). */
  readonly fetch?: FetchFunction;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** The key travels in a header to this URL, so it must be https unless the server is local. */
function checkBaseURL(value: string): void {
  let url: URL | undefined;
  try {
    url = new URL(value);
  } catch {
    url = undefined;
  }
  const ok =
    url !== undefined &&
    (url.protocol === 'https:' || (url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname)));
  // The value is not echoed: a mistyped URL can hold credentials.
  if (!ok) {
    throw new Error(
      'openai-compatible: baseURL must be an https URL (http is allowed only for localhost, 127.0.0.1 or ::1)',
    );
  }
}

export function createOpenAICompatibleAdapter(
  keys: KeysFor<'openai-compatible'>,
  opts: OpenAICompatibleAdapterOptions,
): ModelAdapter {
  checkBaseURL(opts.baseURL);
  const provider = createOpenAICompatible({
    name: 'openai-compatible',
    baseURL: opts.baseURL,
    apiKey: keys.apiKey.reveal(),
    includeUsage: true,
    supportsStructuredOutputs: opts.structuredOutputs ?? false,
    ...(opts.fetch === undefined ? {} : { fetch: opts.fetch }),
  });
  return createSdkAdapter({
    id: 'openai-compatible',
    model: opts.model,
    languageModel: provider.chatModel(opts.model),
    ...(opts.embeddingModel === undefined
      ? {}
      : { embeddingModel: provider.embeddingModel(opts.embeddingModel) }),
    capabilities: {
      ...OPENAI_COMPATIBLE_DEFAULT_CAPABILITIES,
      ...opts.capabilities,
      embeddings: opts.embeddingModel !== undefined,
    },
  });
}
