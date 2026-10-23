// Market -> provider (ADR-0015 §8). Callers never import an adapter: checkout and plan changes use
// paymentsFor(market), which reads LocalePack.payments.provider; the webhook route uses
// forProvider(id) from its own route config, never from the body. A market whose pack says `tbd`,
// an unknown market, or a provider with no adapter fails closed with `unsupported`.
import { ProviderSubscriptionSchema, type LocalePack, type Payments } from '@edmate/contracts';
import { PaymentsError } from './errors.js';

/** The placeholder a locale pack uses before a provider is wired; it never names an adapter. */
export const UNWIRED_PROVIDER = 'tbd';

export interface PaymentsRegistry {
  /** The adapter for a market's locale pack; `unsupported` when the market can't take payments. */
  paymentsFor(market: string): Payments;
  /** The adapter by provider id (the webhook route's own config); `unsupported` when absent. */
  forProvider(provider: string): Payments;
}

export function createPaymentsRegistry(x: {
  adapters: readonly Payments[];
  locales: readonly Pick<LocalePack, 'market' | 'payments'>[];
}): PaymentsRegistry {
  const byProvider = new Map<string, Payments>();
  for (const adapter of x.adapters) {
    if (!ProviderSubscriptionSchema.shape.provider.safeParse(adapter.provider).success) {
      throw new PaymentsError('validation');
    }
    if (byProvider.has(adapter.provider)) throw new PaymentsError('conflict');
    byProvider.set(adapter.provider, adapter);
  }
  const byMarket = new Map<string, string>();
  for (const pack of x.locales) {
    if (byMarket.has(pack.market)) throw new PaymentsError('conflict');
    byMarket.set(pack.market, pack.payments.provider);
  }

  const forProvider = (provider: string): Payments => {
    const adapter = provider === UNWIRED_PROVIDER ? undefined : byProvider.get(provider);
    if (adapter === undefined) throw new PaymentsError('unsupported');
    return adapter;
  };

  return {
    paymentsFor(market) {
      const provider = byMarket.get(market);
      if (provider === undefined) throw new PaymentsError('unsupported');
      return forProvider(provider);
    },
    forProvider,
  };
}
