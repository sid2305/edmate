// The turn's model gateway (task 3.9 Phase A): one real Anthropic adapter, the same key-loading
// pattern `judgeGateway.ts` uses for `edmate eval --record` (task 3.12), composed with
// `@edmate/gateway`'s router and metering (2.3/2.4) into `PipelineDeps.gatewayFor`. The key lives
// only in `ANTHROPIC_API_KEY`/`EDMATE_ANTHROPIC_API_KEY` (whichever `envKeySource` reads); it is
// never logged, printed or carried in an error message (`loadProviderKeys` keeps it in a `Secret`).
import {
  createAnthropicAdapter,
  createRouter,
  envKeySource,
  loadProviderKeys,
  loadBundledPrices,
  meterRouter,
  type PriceTable,
  type ProviderAdapterFactories,
} from '@edmate/gateway';
import type { TurnGateway, TurnGatewaySpec } from '@edmate/harness';
import type { MeterSink } from '@edmate/gateway';

export type Env = Readonly<Record<string, string | undefined>>;

/** Builds the one Anthropic adapter factory `createRouter` needs for every tier. Anthropic only. */
export async function createChatGateway(env: Env): Promise<ProviderAdapterFactories> {
  const keys = await loadProviderKeys({ source: envKeySource(env), required: ['anthropic'] });
  return {
    anthropic: (model: string) => createAnthropicAdapter(keys.get('anthropic'), { model }),
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
