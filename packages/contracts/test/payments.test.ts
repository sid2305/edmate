// ADR-0015 payment schemas: each cap on both sides of its boundary, and the fail-closed rules.
import { describe, expect, it } from 'vitest';
import {
  paymentEventCharged,
  paymentEventSubscription,
  paymentOfferMinimal,
  paymentOfferTrial,
  paymentSucceeded,
  providerSubscriptionActive,
} from '../fixtures/index.js';
import {
  CheckoutResultSchema,
  EntitlementSchema,
  IdempotencyKeySchema,
  PAYMENT_LIMITS,
  PaymentEventSchema,
  PaymentFactSchema,
  PaymentOfferSchema,
  ProviderRefSchema,
  ProviderSubscriptionSchema,
  RefundResultSchema,
} from '../src/index.js';

const ok = (r: { success: boolean }) => r.success;

describe('PAYMENT_LIMITS', () => {
  it('holds the ADR-0015 caps', () => {
    expect(PAYMENT_LIMITS).toEqual({
      offerNameMaxChars: 120,
      trialDaysMin: 1,
      trialDaysMax: 90,
      providerTypeMaxLength: 64,
      factsMax: 4,
    });
  });
});

describe('PaymentOffer', () => {
  it('accepts trialDays 1 and 90, and the smallest paid price', () => {
    for (const trialDays of [1, 90]) {
      expect(ok(PaymentOfferSchema.safeParse({ ...paymentOfferTrial, trialDays }))).toBe(true);
    }
    const price = { amountMinor: 1, currency: 'USD' };
    expect(ok(PaymentOfferSchema.safeParse({ ...paymentOfferMinimal, price }))).toBe(true);
  });

  it('counts the name in code points: a letter and 119 emoji pass, 120 emoji fail', () => {
    const name = (n: number) => 'A' + '\u{1F4D8}'.repeat(n - 1);
    expect(ok(PaymentOfferSchema.safeParse({ ...paymentOfferMinimal, name: name(120) }))).toBe(
      true,
    );
    expect(ok(PaymentOfferSchema.safeParse({ ...paymentOfferMinimal, name: name(121) }))).toBe(
      false,
    );
  });

  it('refuses format characters and names with no letter or digit', () => {
    for (const bad of [
      'a\u200bb',
      'a\ufeffb',
      'a\u2066b',
      'a\u2029b',
      'a\u009fb',
      '\u{1F4D8}',
      '-- !',
    ]) {
      expect(ok(PaymentOfferSchema.safeParse({ ...paymentOfferMinimal, name: bad }))).toBe(false);
    }
    for (const good of [
      '7',
      '\u00c9tude 1',
      '\u0905\u0932\u094d\u091c\u0947\u092c\u094d\u0930\u093e',
    ]) {
      expect(ok(PaymentOfferSchema.safeParse({ ...paymentOfferMinimal, name: good }))).toBe(true);
    }
  });

  it('refuses control characters in the name', () => {
    for (const bad of ['a\rb', 'a\u0000b', 'a\u007fb', 'a b', 'a\tb']) {
      expect(ok(PaymentOfferSchema.safeParse({ ...paymentOfferMinimal, name: bad }))).toBe(false);
    }
  });
});

describe('ProviderSubscription', () => {
  it('reuses the Entitlement status enum', () => {
    expect(ProviderSubscriptionSchema.shape.status.options).toEqual(
      EntitlementSchema.shape.status.options,
    );
  });

  it('accepts provider ids of 2 and 32 characters, refuses 33 and "tbd"', () => {
    const parse = (provider: string) =>
      ok(ProviderSubscriptionSchema.safeParse({ ...providerSubscriptionActive, provider }));
    expect(parse('pp')).toBe(true);
    expect(parse('p'.repeat(32))).toBe(true);
    expect(parse('p'.repeat(33))).toBe(false);
    expect(parse('tbd')).toBe(false);
    expect(parse('1pay')).toBe(false);
  });

  it('accepts a 128-character provider ref with . and :, refuses spaces and unicode', () => {
    const parse = (providerRef: string) =>
      ok(ProviderSubscriptionSchema.safeParse({ ...providerSubscriptionActive, providerRef }));
    expect(parse('a.b:c_d-e'.padEnd(128, 'x'))).toBe(true);
    for (const bad of ['', 'a b', 'sub\u200b1', 'sub\u00e9', 'a@b', '.', '..', ':-_.']) {
      expect(parse(bad)).toBe(false);
    }
    expect(parse('.a')).toBe(true);
  });

  it('accepts every scheduled change kind', () => {
    for (const change of ['cancel', 'pause', 'resume'] as const) {
      const scheduled = { change, at: '2026-11-22T00:00:00Z' };
      expect(
        ok(ProviderSubscriptionSchema.safeParse({ ...providerSubscriptionActive, scheduled })),
      ).toBe(true);
    }
  });
});

describe('PaymentEvent', () => {
  it('accepts up to 4 facts and a 64-character providerType', () => {
    const facts = Array(4).fill(paymentEventSubscription.facts[0]);
    expect(ok(PaymentEventSchema.safeParse({ ...paymentEventSubscription, facts }))).toBe(true);
    const providerType = 'e'.repeat(64);
    expect(ok(PaymentEventSchema.safeParse({ ...paymentEventSubscription, providerType }))).toBe(
      true,
    );
  });

  it('lets tax and fee equal the amount, and net be in another currency', () => {
    const fact = {
      ...paymentSucceeded,
      tax: { amountMinor: 1000, currency: 'USD' },
      fee: { amountMinor: 1000, currency: 'USD' },
      net: { amountMinor: 0, currency: 'EUR' },
    };
    expect(ok(PaymentEventSchema.safeParse({ ...paymentEventCharged, facts: [fact] }))).toBe(true);
  });

  it('reports every bad snapshot provider in a multi-fact delivery', () => {
    const r = PaymentEventSchema.safeParse({ ...paymentEventCharged, provider: 'otherpay' });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.path)).toEqual([['facts', 0, 'subscription', 'provider']]);
  });

  it('a bad currency and an over-amount fee are both reported', () => {
    const fact = {
      ...paymentSucceeded,
      tax: { amountMinor: 0, currency: 'EUR' },
      fee: { amountMinor: 2000, currency: 'USD' },
    };
    const r = PaymentEventSchema.safeParse({ ...paymentEventSubscription, facts: [fact] });
    expect(r.error?.issues.map((i) => i.path)).toEqual([
      ['facts', 0, 'tax', 'currency'],
      ['facts', 0, 'fee', 'amountMinor'],
    ]);
  });
});

describe('helper schemas (unregistered)', () => {
  it('IdempotencyKey: 8 to 128 of letters, digits, _ or -', () => {
    const parse = (k: unknown) => ok(IdempotencyKeySchema.safeParse(k));
    for (const good of ['sub_01-chk', 'k'.repeat(8), 'K'.repeat(128)])
      expect(parse(good)).toBe(true);
    for (const bad of ['k'.repeat(7), 'k'.repeat(129), 'sub 0001', 'a@b.example', 'sub.0001', 8]) {
      expect(parse(bad)).toBe(false);
    }
  });

  it('ProviderRef: needs a letter or digit, refuses dot-only refs', () => {
    expect(ok(ProviderRefSchema.safeParse('sub_fake_0001'))).toBe(true);
    for (const bad of ['.', '..', '', 'a/b', 'r'.repeat(129), null]) {
      expect(ok(ProviderRefSchema.safeParse(bad))).toBe(false);
    }
  });

  it('CheckoutResult: https url only, optional providerRef, strict', () => {
    const base = {
      checkoutRef: 'chk_fake_0001',
      url: 'https://checkout.example.test/c/chk_fake_0001',
    };
    const parse = (v: unknown) => ok(CheckoutResultSchema.safeParse(v));
    expect(parse(base)).toBe(true);
    expect(parse({ ...base, providerRef: 'sub_fake_0001' })).toBe(true);
    for (const url of [
      'http://checkout.example.test/c',
      ' https://checkout.example.test/c',
      'https://user@checkout.example.test/c',
      'javascript:alert(1)',
      'checkout.example.test/c',
    ]) {
      expect(parse({ ...base, url })).toBe(false);
    }
    expect(parse({ ...base, checkoutRef: '..' })).toBe(false);
    expect(parse({ ...base, providerRef: undefined })).toBe(false);
    expect(parse({ ...base, email: 'x' })).toBe(false);
  });

  it('RefundResult: a ref and a pending or succeeded status', () => {
    const parse = (v: unknown) => ok(RefundResultSchema.safeParse(v));
    expect(parse({ refundRef: 'rfd_fake_0001', status: 'pending' })).toBe(true);
    expect(parse({ refundRef: 'rfd_fake_0001', status: 'succeeded' })).toBe(true);
    expect(parse({ refundRef: 'rfd_fake_0001', status: 'failed' })).toBe(false);
    expect(parse({ refundRef: '..', status: 'pending' })).toBe(false);
    expect(parse({ refundRef: 'rfd_fake_0001', status: 'pending', amount: 1 })).toBe(false);
  });

  it('PaymentFact: parses one queued fact on its own', () => {
    expect(ok(PaymentFactSchema.safeParse(paymentSucceeded))).toBe(true);
    expect(ok(PaymentFactSchema.safeParse(paymentEventSubscription.facts[0]))).toBe(true);
    expect(ok(PaymentFactSchema.safeParse({ ...paymentSucceeded, type: 'ignored' }))).toBe(false);
    expect(ok(PaymentFactSchema.safeParse({ ...paymentSucceeded, cardLast4: '0000' }))).toBe(false);
  });
});
