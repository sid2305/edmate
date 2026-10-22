import {
  paymentEventCharged,
  paymentEventRefund,
  paymentEventSubscription,
  paymentOfferMinimal,
  paymentOfferTrial,
  paymentSucceeded,
  providerSubscriptionActive,
  providerSubscriptionTrialPlanScheduled,
} from '../valid/payments.js';
import type { InvalidCase } from './case.js';

const offer = (over: object): unknown => ({ ...paymentOfferMinimal, ...over });
const sub = (over: object): unknown => ({ ...providerSubscriptionActive, ...over });
const event = (over: object): unknown => ({ ...paymentEventSubscription, ...over });
const paid = (over: object): unknown => ({
  ...paymentEventSubscription,
  facts: [{ ...paymentSucceeded, ...over }],
});
const usd = (amountMinor: number) => ({ amountMinor, currency: 'USD' });
const at = '2026-11-22T00:00:00Z';

/** name, value, the path of the issue it must report. */
type Row = [string, unknown, InvalidCase['path']];
const cases = (schema: string, rows: Row[]): InvalidCase[] =>
  rows.map(([name, value, path]) => ({ schema, name, value, path }));

const offerCases = cases('PaymentOffer', [
  ['float price', offer({ price: usd(999.5) }), ['price', 'amountMinor']],
  ['negative price', offer({ price: usd(-1) }), ['price', 'amountMinor']],
  ['zero price (a free package has no offer)', offer({ price: usd(0) }), ['price', 'amountMinor']],
  [
    'lowercase currency',
    offer({ price: { amountMinor: 1000, currency: 'usd' } }),
    ['price', 'currency'],
  ],
  [
    '2-letter currency',
    offer({ price: { amountMinor: 1000, currency: 'US' } }),
    ['price', 'currency'],
  ],
  ['yearly interval', offer({ interval: 'year' }), ['interval']],
  ['trialDays 0', { ...paymentOfferTrial, trialDays: 0 }, ['trialDays']],
  ['trialDays 91', { ...paymentOfferTrial, trialDays: 91 }, ['trialDays']],
  [
    'trialDays undefined (exact optional)',
    { ...paymentOfferTrial, trialDays: undefined },
    ['trialDays'],
  ],
  ['empty name', offer({ name: '' }), ['name']],
  ['blank name', offer({ name: '   ' }), ['name']],
  ['two-line name', offer({ name: 'Algebra\nbasics' }), ['name']],
  ['name with a line separator', offer({ name: 'Algebra\u2028basics' }), ['name']],
  ['name over 120 characters', offer({ name: 'x'.repeat(121) }), ['name']],
  ['unsafe packageVersionId', offer({ packageVersionId: 'pkv/../1' }), ['packageVersionId']],
  ['name with a NEL (U+0085)', offer({ name: 'Algebra\u0085basics' }), ['name']],
  ['name with a right-to-left override (U+202E)', offer({ name: 'Algebra \u202e99.0$' }), ['name']],
  ['zero-width-only name', offer({ name: '\u200b\u200c\u200d' }), ['name']],
  ['extra key', offer({ studentEmail: 'x' }), []],
]);

const subscriptionCases = cases('ProviderSubscription', [
  ['unknown status', sub({ status: 'trialing' }), ['status']],
  ['provider "tbd"', sub({ provider: 'tbd' }), ['provider']],
  ['upper-case provider', sub({ provider: 'Paddle' }), ['provider']],
  ['one-letter provider', sub({ provider: 'p' }), ['provider']],
  ['providerRef with a slash', sub({ providerRef: 'sub/1' }), ['providerRef']],
  ['providerRef over 128 characters', sub({ providerRef: 'r'.repeat(129) }), ['providerRef']],
  ['missing subscriptionId', sub({ subscriptionId: undefined }), ['subscriptionId']],
  ['non-ISO periodEnd', sub({ periodEnd: '22/11/2026' }), ['periodEnd']],
  [
    'scheduled plan without packageVersionId',
    sub({ scheduled: { change: 'plan', at } }),
    ['scheduled', 'packageVersionId'],
  ],
  [
    'scheduled cancel with packageVersionId',
    sub({ scheduled: { change: 'cancel', at, packageVersionId: 'pkv_fake_0001' } }),
    ['scheduled', 'packageVersionId'],
  ],
  [
    'unknown scheduled change',
    sub({ scheduled: { change: 'upgrade', at } }),
    ['scheduled', 'change'],
  ],
  [
    'extra key in scheduled',
    {
      ...providerSubscriptionTrialPlanScheduled,
      scheduled: { ...providerSubscriptionTrialPlanScheduled.scheduled, note: 'x' },
    },
    ['scheduled'],
  ],
  ['dot-only providerRef', sub({ providerRef: '..' }), ['providerRef']],
  ['extra key (buyer email)', sub({ customerEmail: 'x' }), []],
]);

const refundFact = paymentEventRefund.facts[0];

const eventCases = cases('PaymentEvent', [
  ['empty eventId', event({ eventId: '' }), ['eventId']],
  ['non-ISO occurredAt', event({ occurredAt: 'yesterday' }), ['occurredAt']],
  ['empty providerType', event({ providerType: '' }), ['providerType']],
  [
    'providerType with payload text',
    event({ providerType: 'order for a buyer' }),
    ['providerType'],
  ],
  ['providerType over 64 characters', event({ providerType: 'e'.repeat(65) }), ['providerType']],
  ['provider "tbd"', event({ provider: 'tbd' }), ['provider']],
  ['extra key (raw body)', event({ raw: '{}' }), []],
  [
    'more than 4 facts',
    event({ facts: Array<unknown>(5).fill(paymentEventSubscription.facts[0]) }),
    ['facts'],
  ],
  [
    'unknown fact type (the first draft\'s "ignored")',
    event({ facts: [{ type: 'ignored', providerType: 'x' }] }),
    ['facts', 0, 'type'],
  ],
  [
    'snapshot from another provider',
    event({ provider: 'otherpay' }),
    ['facts', 0, 'subscription', 'provider'],
  ],
  [
    'snapshot with an unknown status',
    event({ facts: [{ type: 'subscription', subscription: sub({ status: 'unknown' }) }] }),
    ['facts', 0, 'subscription', 'status'],
  ],
  [
    'payment tax in another currency',
    paid({ tax: { amountMinor: 0, currency: 'EUR' } }),
    ['facts', 0, 'tax', 'currency'],
  ],
  [
    'payment fee in another currency',
    paid({ fee: { amountMinor: 100, currency: 'EUR' } }),
    ['facts', 0, 'fee', 'currency'],
  ],
  ['payment tax above the amount', paid({ tax: usd(1001) }), ['facts', 0, 'tax', 'amountMinor']],
  ['payment fee above the amount', paid({ fee: usd(1001) }), ['facts', 0, 'fee', 'amountMinor']],
  [
    'payment without subscriptionId',
    paid({ subscriptionId: undefined }),
    ['facts', 0, 'subscriptionId'],
  ],
  ['payment net undefined (exact optional)', paid({ net: undefined }), ['facts', 0, 'net']],
  ['payment with card details', paid({ cardLast4: '0000' }), ['facts', 0]],
  [
    'failed payment without providerRef',
    event({
      facts: [
        { type: 'payment_failed', paymentRef: 'txn_fake_0002', subscriptionId: 'sub_test_01' },
      ],
    }),
    ['facts', 0, 'providerRef'],
  ],
  [
    'refund of zero',
    event({ facts: [{ ...refundFact, amount: usd(0) }] }),
    ['facts', 0, 'amount', 'amountMinor'],
  ],
  [
    'unknown refund status',
    event({ facts: [{ ...refundFact, status: 'reversed' }] }),
    ['facts', 0, 'status'],
  ],
  [
    'second fact invalid',
    {
      ...paymentEventCharged,
      facts: [paymentEventCharged.facts[0], { ...paymentSucceeded, paymentRef: 'a b' }],
    },
    ['facts', 1, 'paymentRef'],
  ],
]);

export const invalid: InvalidCase[] = [...offerCases, ...subscriptionCases, ...eventCases];
