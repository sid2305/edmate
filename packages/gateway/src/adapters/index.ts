// Provider adapters behind the ModelGateway port (task 2.2).
export type { AdapterCapabilities, ModelAdapter } from './types.js';
export { GatewayError, mapProviderError, type GatewayErrorCode } from './errors.js';
export {
  ANTHROPIC_CAPABILITIES,
  createAnthropicAdapter,
  type AnthropicAdapterOptions,
} from './anthropic.js';
export {
  OPENAI_COMPATIBLE_DEFAULT_CAPABILITIES,
  createOpenAICompatibleAdapter,
  type OpenAICompatibleAdapterOptions,
} from './openai-compatible.js';
