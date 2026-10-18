// Builds the live judge gateway for `edmate eval --record` (task 3.12) from the pinned judge
// model and the provider keys. Only record mode ever calls this; replay needs no keys at all.
import type { ModelGateway } from '@edmate/contracts';
import { JudgeModelConfigError, type JudgeModelConfig } from '@edmate/evals';
import {
  createAnthropicAdapter,
  createOpenAICompatibleAdapter,
  envKeySource,
  loadProviderKeys,
} from '@edmate/gateway';

/** The OpenAI-compatible endpoint for the judge; that provider has no default URL. */
export const JUDGE_BASE_URL_VARIABLE = 'EDMATE_JUDGE_BASE_URL';

export type Env = Readonly<Record<string, string | undefined>>;

export async function createJudgeGateway(
  config: JudgeModelConfig,
  env: Env,
): Promise<ModelGateway> {
  const source = envKeySource(env);
  switch (config.provider) {
    case 'anthropic': {
      const keys = await loadProviderKeys({ source, required: ['anthropic'] });
      return createAnthropicAdapter(keys.get('anthropic'), { model: config.model });
    }
    case 'openai-compatible': {
      const baseURL = (env[JUDGE_BASE_URL_VARIABLE] ?? '').trim();
      if (baseURL === '') {
        throw new JudgeModelConfigError(
          `${JUDGE_BASE_URL_VARIABLE} must be set for an openai-compatible judge model`,
        );
      }
      const keys = await loadProviderKeys({ source, required: ['openai-compatible'] });
      return createOpenAICompatibleAdapter(keys.get('openai-compatible'), {
        model: config.model,
        baseURL,
      });
    }
    default:
      throw new JudgeModelConfigError(
        `unknown judge provider "${config.provider}" (use anthropic or openai-compatible)`,
      );
  }
}
