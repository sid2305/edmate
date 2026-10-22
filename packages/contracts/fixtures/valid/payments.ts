// Payments fixtures (ADR-0015). Every id is an obvious fake (`*_fake_*`); no real provider ids,
// keys, emails or names (the repo is public).
import type { PaymentEvent, PaymentOffer, ProviderSubscription } from '../../src/index.js';

export const paymentOfferMinimal = {
  packageVersionId: 'pkv_fake_0001',
  name: 'Algebra basics, monthly',
  price: { amountMinor: 1000, currency: 'USD' },
  interval: 'month',
} satisfies PaymentOffer;

export const paymentOfferTrial = {
  packageVersionId: 'pkv_fake_0002',
  name: 'Algebra plus live classes',
  price: { amountMinor: 2500, currency: 'USD' },
  interval: 'month',
  trialDays: 7,
} satisfies PaymentOffer;

export const providerSubscriptionActive = {
  provider: 'fakepay',
  providerRef: 'sub_fake_0001',
  subscriptionId: 'sub_test_01',
  status: 'active',
  packageVersionId: 'pkv_fake_0001',
  periodEnd: '2026-11-22T00:00:00Z',
} satisfies ProviderSubscription;

export const providerSubscriptionTrialPlanScheduled = {
  provider: 'fakepay',
  providerRef: 'sub_fake_0002',
  subscriptionId: 'sub_test_02',
  status: 'trial',
  packageVersionId: 'pkv_fake_0002',
  periodEnd: '2026-10-29T00:00:00Z',
  scheduled: { change: 'plan', at: '2026-10-29T00:00:00Z', packageVersionId: 'pkv_fake_0001' },
} satisfies ProviderSubscription;

export const providerSubscriptionCancelScheduled = {
  ...providerSubscriptionActive,
  status: 'past_due',
  scheduled: { change: 'cancel', at: '2026-11-22T00:00:00Z' },
} satisfies ProviderSubscription;

export const providerSubscriptionPaused = {
  ...providerSubscriptionActive,
  status: 'paused',
  scheduled: { change: 'resume', at: '2026-12-01T00:00:00.000+00:00' },
} satisfies ProviderSubscription;

export const providerSubscriptionEnded = {
  ...providerSubscriptionActive,
  provider: 'fake-mor_2',
  providerRef: 'ctr:fake.0003',
  status: 'ended',
} satisfies ProviderSubscription;

export const paymentSucceeded = {
  type: 'payment_succeeded',
  paymentRef: 'txn_fake_0001',
  providerRef: 'sub_fake_0001',
  subscriptionId: 'sub_test_01',
  amount: { amountMinor: 1000, currency: 'USD' },
  tax: { amountMinor: 0, currency: 'USD' },
  fee: { amountMinor: 100, currency: 'USD' },
} satisfies PaymentEvent['facts'][number];

export const paymentEventSubscription = {
  provider: 'fakepay',
  eventId: 'evt_fake_0001',
  providerType: 'subscription.created',
  occurredAt: '2026-10-22T10:00:00Z',
  facts: [{ type: 'subscription', subscription: providerSubscriptionActive }],
} satisfies PaymentEvent;

/** A Razorpay-style `subscription.charged`: one delivery carries a snapshot and a payment. */
export const paymentEventCharged = {
  provider: 'fakepay',
  eventId: 'evt_fake_0002',
  providerType: 'subscription.charged',
  occurredAt: '2026-10-22T10:00:01.250Z',
  facts: [
    { type: 'subscription', subscription: providerSubscriptionActive },
    {
      ...paymentSucceeded,
      // Boundary: tax may equal the amount; net may be in the payout currency.
      tax: { amountMinor: 1000, currency: 'USD' },
      net: { amountMinor: 79000, currency: 'INR' },
    },
  ],
} satisfies PaymentEvent;

export const paymentEventFailed = {
  provider: 'fakepay',
  eventId: 'evt_fake_0003',
  providerType: 'transaction.payment_failed',
  occurredAt: '2026-10-22T10:00:00-07:00',
  facts: [
    {
      type: 'payment_failed',
      paymentRef: 'txn_fake_0002',
      providerRef: 'sub_fake_0001',
      subscriptionId: 'sub_test_01',
    },
  ],
} satisfies PaymentEvent;

export const paymentEventRefund = {
  provider: 'fakepay',
  eventId: 'evt_fake_0004',
  providerType: 'adjustment.updated',
  occurredAt: '2026-10-23T08:00:00Z',
  facts: [
    {
      type: 'refund',
      refundRef: 'adj_fake_0001',
      paymentRef: 'txn_fake_0001',
      subscriptionId: 'sub_test_01',
      amount: { amountMinor: 1000, currency: 'USD' },
      status: 'succeeded',
    },
  ],
} satisfies PaymentEvent;

/** Verified, but nothing Edmate uses. */
export const paymentEventEmpty = {
  provider: 'fakepay',
  eventId: 'evt_fake_0005',
  providerType: 'customer.updated',
  occurredAt: '2026-10-22T10:00:00Z',
  facts: [],
} satisfies PaymentEvent;

export const valid = {
  PaymentOffer: [paymentOfferMinimal, paymentOfferTrial],
  ProviderSubscription: [
    providerSubscriptionActive,
    providerSubscriptionTrialPlanScheduled,
    providerSubscriptionCancelScheduled,
    providerSubscriptionPaused,
    providerSubscriptionEnded,
  ],
  PaymentEvent: [
    paymentEventSubscription,
    paymentEventCharged,
    paymentEventFailed,
    paymentEventRefund,
    paymentEventEmpty,
  ],
};
