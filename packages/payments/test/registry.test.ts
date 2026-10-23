import type { LocalePack, Payments } from '@edmate/contracts';
import { describe, expect, it } from 'vitest';
import { isPaymentsError } from '../src/errors.js';
import { createPaymentsRegistry, UNWIRED_PROVIDER } from '../src/registry.js';
import { fakeSetup } from './helpers/fake-driver.js';

type Pack = Pick<LocalePack, 'market' | 'payments'>;
const pack = (market: string, provider: string): Pack => ({
  market,
  payments: { methods: ['card'], provider },
});

function codeOf(fn: () => unknown): string {
  try {
    fn();
    return 'returned';
  } catch (err) {
    return isPaymentsError(err) ? err.code : 'other';
  }
}

describe('createPaymentsRegistry', () => {
  const paddle = fakeSetup({ provider: 'paddle' }).payments;
  const razorpay = fakeSetup({ provider: 'razorpay', signatureStyle: 'body-only' }).payments;
  const registry = createPaymentsRegistry({
    adapters: [paddle, razorpay],
    locales: [
      pack('US', 'paddle'),
      pack('IN', 'razorpay'),
      pack('global', UNWIRED_PROVIDER),
      pack('GB', 'stripe'),
    ],
  });

  it('paymentsFor returns the adapter the market pack names', () => {
    expect(registry.paymentsFor('US')).toBe(paddle);
    expect(registry.paymentsFor('IN')).toBe(razorpay);
  });

  it('a tbd pack, a provider with no adapter or an unknown market is unsupported (no checkout)', () => {
    for (const market of ['global', 'GB', 'FR', '', '__proto__', 'constructor']) {
      expect(codeOf(() => registry.paymentsFor(market))).toBe('unsupported');
    }
  });

  it('forProvider serves the webhook route; tbd and unknown ids are unsupported', () => {
    expect(registry.forProvider('paddle')).toBe(paddle);
    expect(registry.forProvider('razorpay')).toBe(razorpay);
    for (const id of [UNWIRED_PROVIDER, 'stripe', 'PADDLE', '', 'toString']) {
      expect(codeOf(() => registry.forProvider(id))).toBe('unsupported');
    }
  });

  it('a duplicate provider id or market throws at construction', () => {
    const twin = fakeSetup({ provider: 'paddle' }).payments;
    expect(codeOf(() => createPaymentsRegistry({ adapters: [paddle, twin], locales: [] }))).toBe(
      'conflict',
    );
    expect(
      codeOf(() =>
        createPaymentsRegistry({
          adapters: [paddle],
          locales: [pack('US', 'paddle'), pack('US', 'tbd')],
        }),
      ),
    ).toBe('conflict');
  });

  it('an adapter whose id is not a provider id (or is tbd) throws at construction', () => {
    for (const provider of ['tbd', 'Paddle', 'p', '']) {
      const odd = { ...paddle, provider } as Payments;
      expect(codeOf(() => createPaymentsRegistry({ adapters: [odd], locales: [] }))).toBe(
        'validation',
      );
    }
  });

  it('an empty registry refuses everything', () => {
    const empty = createPaymentsRegistry({ adapters: [], locales: [] });
    expect(codeOf(() => empty.paymentsFor('US'))).toBe('unsupported');
    expect(codeOf(() => empty.forProvider('paddle'))).toBe('unsupported');
  });
});
