// OpenAI itself (task 2.7): the AI SDK transcription model behind the Whisper Transcriber. The key
// is revealed once, here, and the base URL is always passed, so the SDK never falls back to
// OPENAI_API_KEY or OPENAI_BASE_URL.
import { createOpenAI } from '@ai-sdk/openai';
import type { KeysFor } from '../keys/providers.js';
import { checkBaseURL } from './openai-compatible.js';

export const OPENAI_BASE_URL = 'https://api.openai.com/v1';

type FetchFunction = NonNullable<NonNullable<Parameters<typeof createOpenAI>[0]>['fetch']>;

/** The AI SDK transcription model (`provider.transcription(id)`). */
export type OpenAITranscriptionModel = ReturnType<ReturnType<typeof createOpenAI>['transcription']>;

export interface OpenAITranscriptionModelOptions {
  /** The transcription model id, for example `whisper-1`. */
  readonly model: string;
  /** Defaults to OpenAI's own endpoint; never read from the environment. */
  readonly baseURL?: string;
  /** Transport override (tests pass a fake; production uses the global fetch). */
  readonly fetch?: FetchFunction;
}

export function createOpenAITranscriptionModel(
  keys: KeysFor<'openai'>,
  opts: OpenAITranscriptionModelOptions,
): OpenAITranscriptionModel {
  const baseURL = opts.baseURL ?? OPENAI_BASE_URL;
  checkBaseURL(baseURL, 'openai');
  const provider = createOpenAI({
    baseURL,
    apiKey: keys.apiKey.reveal(),
    ...(opts.fetch === undefined ? {} : { fetch: opts.fetch }),
  });
  return provider.transcription(opts.model);
}
