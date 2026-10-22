// The turn's model gateway (task 3.9 Phase A): one real Anthropic adapter, the same key-loading
// pattern `judgeGateway.ts` uses for `edmate eval --record` (task 3.12), composed with
// `@edmate/gateway`'s router and metering (2.3/2.4) into `PipelineDeps.gatewayFor`. The key lives
// only in `ANTHROPIC_API_KEY`/`EDMATE_ANTHROPIC_API_KEY` (whichever `envKeySource` reads); it is
// never logged, printed or carried in an error message (`loadProviderKeys` keeps it in a `Secret`).
import {
  createAnthropicAdapter,
  createOpenAICompatibleAdapter,
  createRouter,
  envKeySource,
  loadProviderKeys,
  loadBundledPrices,
  meterRouter,
  type PriceTable,
  type ProviderAdapterFactories,
  type ProviderId,
} from '@edmate/gateway';
import type { TurnGateway, TurnGatewaySpec } from '@edmate/harness';
import type { MeterSink } from '@edmate/gateway';

export type Env = Readonly<Record<string, string | undefined>>;

export interface ChatGatewayOptions {
  /**
   * Builds an `openai-compatible` adapter factory too (task 7.6a), for the live model sweep's
   * `openai-compatible` entries (`evals/live-models.yaml`'s own `baseURL` per entry, following
   * `judgeGateway.ts`'s per-provider pattern). Absent (the plain `edmate chat` case): only the
   * Anthropic factory is built, exactly as before. The key comes only from
   * `EDMATE_OPENAI_COMPATIBLE_API_KEY` (`PROVIDER_KEYS`'s existing pattern) and is never logged.
   */
  baseURL?: string;
}

/** Builds the Anthropic adapter factory `createRouter` needs for every tier, plus an
 * `openai-compatible` one when `opts.baseURL` is given (task 7.6a). */
export async function createChatGateway(
  env: Env,
  opts?: ChatGatewayOptions,
): Promise<ProviderAdapterFactories> {
  const source = envKeySource(env);
  const required: ProviderId[] =
    opts?.baseURL === undefined ? ['anthropic'] : ['anthropic', 'openai-compatible'];
  const keys = await loadProviderKeys({ source, required });
  const baseURL = opts?.baseURL;
  return {
    anthropic: (model: string) => createAnthropicAdapter(keys.get('anthropic'), { model }),
    ...(baseURL === undefined
      ? {}
      : {
          'openai-compatible': (model: string) =>
            createOpenAICompatibleAdapter(keys.get('openai-compatible'), { model, baseURL }),
        }),
  };
}

/**
 * A `MeterSink` that forwards priced usage to `usage` (`PipelineDeps.usage`, so `edmate chat`'s
 * meter step never double-counts: `metered: true` below keeps the step itself from recording
 * again) and reports unpriced/unknown usage to `onUnmetered` (ids, model and reason only, never
 * request text).
 */
export function meterSinkFor(
  usage: MeterSink['record'],
  onUnmetered: MeterSink['recordUnmetered'],
): MeterSink {
  return { record: usage, recordUnmetered: onUnmetered };
}

/** `PipelineDeps.gatewayFor`: one metered router per spec, billed to the entitlement. */
export function gatewayFor(opts: {
  factories: ProviderAdapterFactories;
  sink: MeterSink;
  prices?: PriceTable;
}): (spec: TurnGatewaySpec) => TurnGateway {
  const prices = opts.prices ?? loadBundledPrices();
  return (spec) => {
    const router = createRouter(spec.policy, opts.factories);
    const gateway = meterRouter(router, opts.sink, spec.billing, prices);
    return { gateway, metered: true };
  };
}
