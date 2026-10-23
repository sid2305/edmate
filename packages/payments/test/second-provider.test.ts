// Acceptance part 2 (10.1): a second provider is added without changing callers. One caller
// function runs unchanged against two adapters with different provider ids, signature styles and
// status words, picked only through the registry by market.
import type { LocalePack } from '@edmate/contracts';
import { describe, expect, it } from 'vitest';
import { PaymentsError } from '../src/errors.js';
import { createPaymentsRegistry, type PaymentsRegistry } from '../src/registry.js';
import { fakeSetup, START } from './helpers/fake-driver.js';

type Pack = Pick<LocalePack, 'market' | 'payments'>;

/**
 * The caller, as 10.8 and 10.2 will write it: start a checkout for the market, take the
 * provider's signed delivery through the webhook route's adapter, then pause at period end.
 * It knows nothing about any provider.
 */
async function checkoutThenPause(
  registry: PaymentsRegistry,
  x: {
    market: string;
    routeProvider: string;
    buyerPays: (
      checkoutRef: string,
    ) => Promise<{ rawBody: Uint8Array; headers: Record<string, string> }>;
    receivedAt: string;
  },
) {
  const payments = registry.paymentsFor(x.market);
  const checkout = await payments.startCheckout({
    subscriptionId: 'sub_42',
    offer: {
      packageVersionId: 'pkv_basic',
      name: 'Algebra with Ms Rao',
      price: { amountMinor: 1200, currency: 'USD' },
      interval: 'month',
    },
    returnUrl: 'https://edmate.example/checkout/return',
    idempotencyKey: 'sub_42-checkout-1',
  });
  const delivery = await x.buyerPays(checkout.checkoutRef);
  const route = registry.forProvider(x.routeProvider);
  const event = await route.parseWebhook({ ...delivery, receivedAt: x.receivedAt });
  if (event.provider !== route.provider) throw new PaymentsError('malformed_event');
  const fact = event.facts.find((f) => f.type === 'subscription');
  if (fact === undefined) throw new PaymentsError('malformed_event');
  const paused = await payments.pause({
    providerRef: fact.subscription.providerRef,
    when: 'period_end',
    idempotencyKey: 'sub_42-pause-1',
  });
  return { provider: payments.provider, first: fact.subscription, paused };
}

describe('a second provider needs no caller change', () => {
  const us = fakeSetup({ provider: 'paddle', signatureStyle: 'timestamped' });
  const inMarket = fakeSetup({
    provider: 'razorpay',
    signatureStyle: 'body-only',
    statusWords: {
      trial: 'authenticated_trial',
      active: 'active_live',
      past_due: 'pending',
      paused: 'halted',
      ended: 'completed',
    },
  });
  const locales: Pack[] = [
    { market: 'US', payments: { methods: ['card'], provider: 'paddle' } },
    { market: 'IN', payments: { methods: ['upi', 'card'], provider: 'razorpay' } },
  ];
  const registry = createPaymentsRegistry({ adapters: [us.payments, inMarket.payments], locales });

  it.each([
    ['US', 'paddle', us],
    ['IN', 'razorpay', inMarket],
  ] as const)('market %s through %s', async (market, provider, setup) => {
    expect(setup.payments.signatureHeader).not.toBe(
      (setup === us ? inMarket : us).payments.signatureHeader,
    );
    const result = await checkoutThenPause(registry, {
      market,
      routeProvider: provider,
      receivedAt: new Date(START).toISOString(),
      buyerPays: (checkoutRef) => {
        const { providerRef } = setup.payments.completeCheckout(checkoutRef);
        return Promise.resolve(
          setup.payments.emit({
            kind: 'subscription',
            providerRef,
            providerType: 'checkout.completed',
          }),
        );
      },
    });
    expect(result.provider).toBe(provider);
    expect(result.first).toMatchObject({ provider, subscriptionId: 'sub_42', status: 'active' });
    expect(result.paused).toMatchObject({ status: 'active', scheduled: { change: 'pause' } });
  });

  it('a delivery for one provider is refused by the other route', async () => {
    const checkout = await us.payments.startCheckout({
      subscriptionId: 'sub_43',
      offer: {
        packageVersionId: 'pkv_basic',
        name: 'Algebra',
        price: { amountMinor: 900, currency: 'USD' },
        interval: 'month',
      },
      returnUrl: 'https://edmate.example/r',
      idempotencyKey: 'sub_43-checkout-1',
    });
    const { providerRef } = us.payments.completeCheckout(checkout.checkoutRef);
    const delivery = us.payments.emit({ kind: 'subscription', providerRef });
    await expect(
      registry
        .forProvider('razorpay')
        .parseWebhook({ ...delivery, receivedAt: new Date(START).toISOString() }),
    ).rejects.toMatchObject({ code: 'invalid_signature' });
  });
});
