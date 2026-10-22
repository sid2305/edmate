// The shared Payments contract suite (ADR-0015). Provider-neutral: it takes a setup that returns
// an adapter, a scenario driver (the provider side a test can't reach through the port: a buyer
// completing checkout, signed deliveries) and capability flags, which are test-side only. It runs
// against the fake for both signature styles (10.1b) and against every real adapter (10.1c on).
import { inspect } from 'node:util';
import {
  CheckoutResultSchema,
  PaymentEventSchema,
  ProviderSubscriptionSchema,
  RefundResultSchema,
  type Money,
  type PaymentEvent,
  type PaymentOffer,
  type Payments,
} from '@edmate/contracts';
import { describe, expect, it } from 'vitest';
import { isPaymentsError, type PaymentsErrorCode } from '../../src/errors.js';
import type { PortOperation } from '../../src/input.js';
import { leaks } from '../helpers/fake-secret.js';

export interface SignedDelivery {
  rawBody: Uint8Array;
  headers: Record<string, string>;
}

export type DriverEvent =
  | { kind: 'checkout_completed'; providerRef: string }
  | { kind: 'subscription'; providerRef: string }
  | { kind: 'payment_succeeded'; paymentRef: string }
  | { kind: 'payment_failed'; providerRef: string }
  | { kind: 'refund'; refundRef: string }
  | { kind: 'unused' };

export interface ContractDriver {
  /** The buyer pays on the hosted page; a trial starts unpaid, otherwise the first charge is made. */
  completeCheckout(
    checkoutRef: string,
    options: { trial: boolean },
  ): Promise<{ providerRef: string; paymentRef?: string }>;
  /** Every charge on a subscription, oldest first. */
  charges(providerRef: string): Promise<Money[]>;
  /** A correctly signed delivery, or one signed with a foreign secret, or at a skewed time. */
  delivery(
    event: DriverEvent,
    options?: { foreignSecret?: boolean; skewSeconds?: number },
  ): Promise<SignedDelivery>;
  /** A correctly signed delivery whose body is broken in one way. */
  malformed(
    kind: 'bad_json' | 'unknown_status' | 'missing_subscription_id',
    providerRef: string,
  ): Promise<SignedDelivery>;
  /** A provider-side scheduled resume of a paused subscription (when the provider has one). */
  scheduleResume(providerRef: string): Promise<void>;
  /** The next call of `op` does the work at the provider, then times out. */
  timeoutAfterApply(op: PortOperation): void;
}

export interface ContractSetup {
  payments: Payments;
  driver: ContractDriver;
  /** The server's receive time for a delivery. */
  receivedAt(): string;
  /** Every key and webhook secret the adapter holds, to prove no fragment leaks. */
  secretValues: readonly string[];
}

export interface ContractSuiteOptions {
  name: string;
  setup: () => ContractSetup;
  capabilities: { signsTimestamp: boolean; scheduledResume: boolean };
}

const offer = (
  packageVersionId: string,
  amountMinor: number,
  trialDays?: number,
): PaymentOffer => ({
  packageVersionId,
  name: 'Algebra with Ms Rao',
  price: { amountMinor, currency: 'USD' },
  interval: 'month',
  ...(trialDays === undefined ? {} : { trialDays }),
});
const BASIC = offer('pkv_basic', 1000, 7);
const PLUS = offer('pkv_plus', 2000);
const RETURN_URL = 'https://edmate.example/checkout/return';

let keyCounter = 0;
/** A fresh idempotency key, as a caller builds one from Edmate ids. */
const key = (op: string): string => `sub_1-${op}-${(keyCounter += 1)}`;

async function codeOf(p: Promise<unknown>): Promise<PaymentsErrorCode | 'resolved' | 'other'> {
  try {
    await p;
    return 'resolved';
  } catch (err) {
    return isPaymentsError(err) ? err.code : 'other';
  }
}

export function describePaymentsContract(o: ContractSuiteOptions): void {
  describe(`Payments contract: ${o.name}`, () => {
    /** A subscription that is live: checkout, then the buyer pays (or starts a trial). */
    async function started(trial = false) {
      const env = o.setup();
      const checkout = await env.payments.startCheckout({
        subscriptionId: 'sub_1',
        offer: BASIC,
        returnUrl: RETURN_URL,
        idempotencyKey: key('checkout'),
      });
      const done = await env.driver.completeCheckout(checkout.checkoutRef, { trial });
      return { ...env, ...done, checkout };
    }

    async function parsed(env: ContractSetup, d: SignedDelivery): Promise<PaymentEvent> {
      const event = await env.payments.parseWebhook({ ...d, receivedAt: env.receivedAt() });
      expect(PaymentEventSchema.parse(event)).toEqual(event);
      expect(event.provider).toBe(env.payments.provider);
      return event;
    }

    describe('checkout', () => {
      it('returns the hosted https page, and the same result for the same key', async () => {
        const { payments } = o.setup();
        const input = {
          subscriptionId: 'sub_1',
          offer: BASIC,
          returnUrl: RETURN_URL,
          idempotencyKey: key('checkout'),
        };
        const first = await payments.startCheckout(input);
        expect(CheckoutResultSchema.parse(first)).toEqual(first);
        expect(new URL(first.url).protocol).toBe('https:');
        expect(await payments.startCheckout({ ...input })).toEqual(first);
        expect(await codeOf(payments.startCheckout({ ...input, offer: PLUS }))).toBe('conflict');
      });

      it('a completed checkout gives a subscription event with Edmate subscriptionId (trial or active)', async () => {
        for (const trial of [true, false]) {
          const env = await started(trial);
          const event = await parsed(
            env,
            await env.driver.delivery({ kind: 'checkout_completed', providerRef: env.providerRef }),
          );
          expect(event.facts).toHaveLength(1);
          const fact = event.facts[0];
          expect(fact?.type).toBe('subscription');
          if (fact?.type !== 'subscription') return;
          expect(fact.subscription).toMatchObject({
            provider: env.payments.provider,
            providerRef: env.providerRef,
            subscriptionId: 'sub_1',
            status: trial ? 'trial' : 'active',
            packageVersionId: BASIC.packageVersionId,
          });
          // Buyer details the provider sends are dropped (ADR-0015 §6).
          expect(JSON.stringify(event)).not.toMatch(/@|Buyer/);
        }
      });
    });

    describe('one shared input check on every write (ADR-0015 §3, §6)', () => {
      const bad = ['short', 'has space key', 'x'.repeat(129), 'emoji-key-😀', ''];
      it.each(bad)('refuses idempotency key %j with validation, before any work', async (k) => {
        const env = await started();
        const ref = env.providerRef;
        const calls: Promise<unknown>[] = [
          env.payments.startCheckout({
            subscriptionId: 'sub_1',
            offer: BASIC,
            returnUrl: RETURN_URL,
            idempotencyKey: k,
          }),
          env.payments.changePlan({
            providerRef: ref,
            offer: PLUS,
            when: 'now',
            proration: 'prorate',
            idempotencyKey: k,
          }),
          env.payments.pause({ providerRef: ref, when: 'now', idempotencyKey: k }),
          env.payments.resume({ providerRef: ref, idempotencyKey: k }),
          env.payments.cancel({ providerRef: ref, when: 'now', idempotencyKey: k }),
          env.payments.clearScheduled({ providerRef: ref, idempotencyKey: k }),
          env.payments.refund({ paymentRef: env.paymentRef as string, idempotencyKey: k }),
        ];
        for (const call of calls) expect(await codeOf(call)).toBe('validation');
        expect((await env.payments.getSubscription(ref)).status).toBe('active');
        expect(await env.driver.charges(ref)).toHaveLength(1);
      });

      it.each(['http://edmate.example/return', 'javascript:alert(1)', 'not a url', ''])(
        'refuses return URL %j',
        async (returnUrl) => {
          const { payments } = o.setup();
          expect(
            await codeOf(
              payments.startCheckout({
                subscriptionId: 'sub_1',
                offer: BASIC,
                returnUrl,
                idempotencyKey: key('c'),
              }),
            ),
          ).toBe('validation');
        },
      );

      it('refuses a bad offer, ref, refund amount or an extra field', async () => {
        const env = await started();
        const calls: Promise<unknown>[] = [
          env.payments.startCheckout({
            subscriptionId: 'sub_1',
            offer: { ...BASIC, name: 'Algebraㅤ' },
            returnUrl: RETURN_URL,
            idempotencyKey: key('c'),
          }),
          env.payments.startCheckout({
            subscriptionId: 'sub/1',
            offer: BASIC,
            returnUrl: RETURN_URL,
            idempotencyKey: key('c'),
          }),
          env.payments.pause({ providerRef: '..', when: 'now', idempotencyKey: key('p') }),
          env.payments.getSubscription('a/b'),
          env.payments.refund({
            paymentRef: env.paymentRef as string,
            amount: { amountMinor: 0, currency: 'USD' },
            idempotencyKey: key('r'),
          }),
          env.payments.cancel({
            providerRef: env.providerRef,
            when: 'now',
            idempotencyKey: key('x'),
            studentEmail: 'x',
          } as never),
          env.payments.changePlan({
            providerRef: env.providerRef,
            offer: PLUS,
            when: 'period_end',
            proration: 'none',
            idempotencyKey: key('x'),
          } as never),
        ];
        for (const call of calls) expect(await codeOf(call)).toBe('validation');
      });
    });

    describe('plan changes', () => {
      it('now with prorate applies at once and charges a prorated amount', async () => {
        const env = await started();
        const after = await env.payments.changePlan({
          providerRef: env.providerRef,
          offer: PLUS,
          when: 'now',
          proration: 'prorate',
          idempotencyKey: key('plan'),
        });
        expect(ProviderSubscriptionSchema.parse(after)).toEqual(after);
        expect(after.packageVersionId).toBe(PLUS.packageVersionId);
        expect(after.scheduled).toBeUndefined();
        const charges = await env.driver.charges(env.providerRef);
        expect(charges).toHaveLength(2);
        const prorated = charges[1]?.amountMinor ?? 0;
        expect(prorated).toBeGreaterThan(0);
        expect(prorated).toBeLessThanOrEqual(PLUS.price.amountMinor - BASIC.price.amountMinor);
      });

      it('now with none applies with no charge (the scheduled-downgrade fallback)', async () => {
        const env = await started();
        const after = await env.payments.changePlan({
          providerRef: env.providerRef,
          offer: PLUS,
          when: 'now',
          proration: 'none',
          idempotencyKey: key('plan'),
        });
        expect(after.packageVersionId).toBe(PLUS.packageVersionId);
        expect(await env.driver.charges(env.providerRef)).toHaveLength(1);
      });

      it('at period end sets scheduled plan, and a repeat to the same offer returns the snapshot', async () => {
        const env = await started();
        const input = { providerRef: env.providerRef, offer: PLUS, when: 'period_end' as const };
        const after = await env.payments.changePlan({ ...input, idempotencyKey: key('plan') });
        expect(after.packageVersionId).toBe(BASIC.packageVersionId);
        expect(after.scheduled).toEqual({
          change: 'plan',
          at: after.periodEnd,
          packageVersionId: PLUS.packageVersionId,
        });
        expect(await env.payments.changePlan({ ...input, idempotencyKey: key('plan') })).toEqual(
          after,
        );
        expect(await env.payments.getSubscription(env.providerRef)).toEqual(after);
      });
    });

    describe('pause, resume, cancel and clearScheduled', () => {
      it('pause now, then resume', async () => {
        const env = await started();
        const paused = await env.payments.pause({
          providerRef: env.providerRef,
          when: 'now',
          idempotencyKey: key('pause'),
        });
        expect(paused.status).toBe('paused');
        expect(
          await env.payments.pause({
            providerRef: env.providerRef,
            when: 'now',
            idempotencyKey: key('pause'),
          }),
        ).toEqual(paused);
        const resumed = await env.payments.resume({
          providerRef: env.providerRef,
          idempotencyKey: key('resume'),
        });
        expect(resumed.status).toBe('active');
        expect(ProviderSubscriptionSchema.parse(resumed)).toEqual(resumed);
        expect(
          await env.payments.resume({
            providerRef: env.providerRef,
            idempotencyKey: key('resume'),
          }),
        ).toEqual(resumed);
      });

      it('pause at period end is scheduled, and clearScheduled undoes it', async () => {
        const env = await started();
        const later = await env.payments.pause({
          providerRef: env.providerRef,
          when: 'period_end',
          idempotencyKey: key('pause'),
        });
        expect(later.status).toBe('active');
        expect(later.scheduled).toEqual({ change: 'pause', at: later.periodEnd });
        const cleared = await env.payments.clearScheduled({
          providerRef: env.providerRef,
          idempotencyKey: key('clear'),
        });
        expect(cleared.scheduled).toBeUndefined();
        expect(cleared.status).toBe('active');
      });

      it.runIf(o.capabilities.scheduledResume)(
        'clearScheduled clears a scheduled resume',
        async () => {
          const env = await started();
          await env.payments.pause({
            providerRef: env.providerRef,
            when: 'now',
            idempotencyKey: key('pause'),
          });
          await env.driver.scheduleResume(env.providerRef);
          expect((await env.payments.getSubscription(env.providerRef)).scheduled?.change).toBe(
            'resume',
          );
          const cleared = await env.payments.clearScheduled({
            providerRef: env.providerRef,
            idempotencyKey: key('clear'),
          });
          expect(cleared.scheduled).toBeUndefined();
          expect(cleared.status).toBe('paused');
        },
      );

      it('clearScheduled with nothing scheduled returns the current snapshot', async () => {
        const env = await started();
        const before = await env.payments.getSubscription(env.providerRef);
        expect(before.scheduled).toBeUndefined();
        expect(
          await env.payments.clearScheduled({
            providerRef: env.providerRef,
            idempotencyKey: key('clear'),
          }),
        ).toEqual(before);
      });

      it('cancel at period end is scheduled; cancel now ends it; a repeat returns the snapshot', async () => {
        const env = await started();
        const later = await env.payments.cancel({
          providerRef: env.providerRef,
          when: 'period_end',
          idempotencyKey: key('cancel'),
        });
        expect(later.status).toBe('active');
        expect(later.scheduled).toEqual({ change: 'cancel', at: later.periodEnd });
        const ended = await env.payments.cancel({
          providerRef: env.providerRef,
          when: 'now',
          idempotencyKey: key('cancel'),
        });
        expect(ended.status).toBe('ended');
        expect(ended.scheduled).toBeUndefined();
        expect(
          await env.payments.cancel({
            providerRef: env.providerRef,
            when: 'now',
            idempotencyKey: key('cancel'),
          }),
        ).toEqual(ended);
      });

      it('getSubscription returns the current view; an unknown ref is not_found', async () => {
        const env = await started();
        const view = await env.payments.getSubscription(env.providerRef);
        expect(ProviderSubscriptionSchema.parse(view)).toEqual(view);
        expect(view).toMatchObject({
          providerRef: env.providerRef,
          subscriptionId: 'sub_1',
          status: 'active',
        });
        expect(await codeOf(env.payments.getSubscription('sub_missing_9'))).toBe('not_found');
      });
    });

    describe('refunds', () => {
      it('a partial refund, then amount omitted refunds exactly what is left', async () => {
        const env = await started();
        const paymentRef = env.paymentRef as string;
        const part = await env.payments.refund({
          paymentRef,
          amount: { amountMinor: 300, currency: 'USD' },
          idempotencyKey: key('refund'),
        });
        expect(RefundResultSchema.parse(part)).toEqual(part);
        const full = await env.payments.refund({ paymentRef, idempotencyKey: key('refund') });
        const event = await parsed(
          env,
          await env.driver.delivery({ kind: 'refund', refundRef: full.refundRef }),
        );
        expect(event.facts[0]).toMatchObject({
          type: 'refund',
          paymentRef,
          subscriptionId: 'sub_1',
          amount: { amountMinor: 700, currency: 'USD' },
        });
        // Nothing is left: another full refund is a conflict, never a second payout.
        expect(
          await codeOf(env.payments.refund({ paymentRef, idempotencyKey: key('refund') })),
        ).toBe('conflict');
      });

      it('amount omitted on an untouched payment is a full refund', async () => {
        const env = await started();
        const full = await env.payments.refund({
          paymentRef: env.paymentRef as string,
          idempotencyKey: key('refund'),
        });
        const event = await parsed(
          env,
          await env.driver.delivery({ kind: 'refund', refundRef: full.refundRef }),
        );
        expect(event.facts[0]).toMatchObject({ type: 'refund', amount: BASIC.price });
      });

      it('same key returns the same refund; a different amount under it is a conflict; too much is validation', async () => {
        const env = await started();
        const paymentRef = env.paymentRef as string;
        const k = key('refund');
        const first = await env.payments.refund({
          paymentRef,
          amount: { amountMinor: 100, currency: 'USD' },
          idempotencyKey: k,
        });
        expect(
          await env.payments.refund({
            paymentRef,
            amount: { amountMinor: 100, currency: 'USD' },
            idempotencyKey: k,
          }),
        ).toEqual(first);
        expect(
          await codeOf(
            env.payments.refund({
              paymentRef,
              amount: { amountMinor: 200, currency: 'USD' },
              idempotencyKey: k,
            }),
          ),
        ).toBe('conflict');
        expect(
          await codeOf(
            env.payments.refund({
              paymentRef,
              amount: { amountMinor: 5000, currency: 'USD' },
              idempotencyKey: key('refund'),
            }),
          ),
        ).toBe('validation');
        expect(
          await codeOf(
            env.payments.refund({ paymentRef: 'pay_missing_9', idempotencyKey: key('refund') }),
          ),
        ).toBe('not_found');
      });
    });

    describe('a retry after a timeout uses the same key and never repeats the work (ADR-0015 §3)', () => {
      it('plan change and cancel', async () => {
        const env = await started();
        env.driver.timeoutAfterApply('changePlan');
        const planInput = {
          providerRef: env.providerRef,
          offer: PLUS,
          when: 'now' as const,
          proration: 'prorate' as const,
          idempotencyKey: key('plan'),
        };
        const err = await env.payments.changePlan(planInput).catch((e: unknown) => e);
        expect(isPaymentsError(err, 'provider_error') && err.retryable).toBe(true);
        const retried = await env.payments.changePlan(planInput);
        expect(retried.packageVersionId).toBe(PLUS.packageVersionId);
        expect(await env.driver.charges(env.providerRef)).toHaveLength(2);

        env.driver.timeoutAfterApply('cancel');
        const cancelInput = {
          providerRef: env.providerRef,
          when: 'period_end' as const,
          idempotencyKey: key('cancel'),
        };
        expect(await codeOf(env.payments.cancel(cancelInput))).toBe('provider_error');
        expect((await env.payments.cancel(cancelInput)).scheduled?.change).toBe('cancel');
      });

      it('refund: the retry returns the first refund and nothing is refunded twice', async () => {
        const env = await started();
        const paymentRef = env.paymentRef as string;
        env.driver.timeoutAfterApply('refund');
        const input = {
          paymentRef,
          amount: { amountMinor: 300, currency: 'USD' },
          idempotencyKey: key('refund'),
        };
        expect(await codeOf(env.payments.refund(input))).toBe('provider_error');
        const retried = await env.payments.refund(input);
        expect(RefundResultSchema.parse(retried)).toEqual(retried);
        // Only one 300 went out: a full refund now returns the other 700.
        const rest = await env.payments.refund({ paymentRef, idempotencyKey: key('refund') });
        const event = await parsed(
          env,
          await env.driver.delivery({ kind: 'refund', refundRef: rest.refundRef }),
        );
        expect(event.facts[0]).toMatchObject({ amount: { amountMinor: 700, currency: 'USD' } });
      });
    });

    describe('webhooks', () => {
      it('maps payments and refunds, and an unused event type gives no facts', async () => {
        const env = await started();
        const paid = await parsed(
          env,
          await env.driver.delivery({
            kind: 'payment_succeeded',
            paymentRef: env.paymentRef as string,
          }),
        );
        expect(paid.facts[0]).toMatchObject({
          type: 'payment_succeeded',
          paymentRef: env.paymentRef,
          providerRef: env.providerRef,
          subscriptionId: 'sub_1',
          amount: BASIC.price,
        });
        const failed = await parsed(
          env,
          await env.driver.delivery({ kind: 'payment_failed', providerRef: env.providerRef }),
        );
        expect(failed.facts[0]).toMatchObject({
          type: 'payment_failed',
          providerRef: env.providerRef,
          subscriptionId: 'sub_1',
        });
        const snap = await parsed(
          env,
          await env.driver.delivery({ kind: 'subscription', providerRef: env.providerRef }),
        );
        expect(snap.facts[0]).toMatchObject({
          type: 'subscription',
          subscription: await env.payments.getSubscription(env.providerRef),
        });
        const unused = await parsed(env, await env.driver.delivery({ kind: 'unused' }));
        expect(unused.facts).toEqual([]);
      });

      it('refuses a missing header, a bad signature and a tampered body', async () => {
        const env = await started();
        const good = await env.driver.delivery({
          kind: 'subscription',
          providerRef: env.providerRef,
        });
        const receivedAt = env.receivedAt();
        expect(
          await codeOf(
            env.payments.parseWebhook({ rawBody: good.rawBody, headers: {}, receivedAt }),
          ),
        ).toBe('invalid_signature');
        const foreign = await env.driver.delivery(
          { kind: 'subscription', providerRef: env.providerRef },
          { foreignSecret: true },
        );
        expect(await codeOf(env.payments.parseWebhook({ ...foreign, receivedAt }))).toBe(
          'invalid_signature',
        );
        const tampered = Uint8Array.from(good.rawBody);
        const at = tampered.length - 2;
        tampered[at] = (tampered[at] ?? 0) ^ 1;
        expect(
          await codeOf(
            env.payments.parseWebhook({ rawBody: tampered, headers: good.headers, receivedAt }),
          ),
        ).toBe('invalid_signature');
        const swapped = Object.fromEntries(
          Object.keys(good.headers).map((h) => [h, foreign.headers[h] as string]),
        );
        expect(
          await codeOf(
            env.payments.parseWebhook({ rawBody: good.rawBody, headers: swapped, receivedAt }),
          ),
        ).toBe('invalid_signature');
      });

      it.runIf(o.capabilities.signsTimestamp)('refuses a stale or future timestamp', async () => {
        const env = await started();
        for (const skewSeconds of [-301, 301]) {
          const d = await env.driver.delivery(
            { kind: 'subscription', providerRef: env.providerRef },
            { skewSeconds },
          );
          expect(
            await codeOf(env.payments.parseWebhook({ ...d, receivedAt: env.receivedAt() })),
          ).toBe('stale_signature');
        }
        const ok = await env.driver.delivery(
          { kind: 'subscription', providerRef: env.providerRef },
          { skewSeconds: -299 },
        );
        expect(
          await codeOf(env.payments.parseWebhook({ ...ok, receivedAt: env.receivedAt() })),
        ).toBe('resolved');
      });

      it.each(['bad_json', 'unknown_status', 'missing_subscription_id'] as const)(
        'a signed body with %s is malformed_event, never active',
        async (kind) => {
          const env = await started();
          const d = await env.driver.malformed(kind, env.providerRef);
          expect(
            await codeOf(env.payments.parseWebhook({ ...d, receivedAt: env.receivedAt() })),
          ).toBe('malformed_event');
        },
      );
    });

    it('no key or secret fragment reaches any output or error', async () => {
      const env = await started();
      const texts: string[] = [];
      const keep = (v: unknown) =>
        texts.push(JSON.stringify(v), inspect(v, { depth: 8, showHidden: true }), String(v));
      keep(env.payments);
      keep(await env.payments.getSubscription(env.providerRef));
      keep(
        await parsed(
          env,
          await env.driver.delivery({ kind: 'subscription', providerRef: env.providerRef }),
        ),
      );
      const failures = [
        env.payments.parseWebhook({
          ...(await env.driver.delivery({ kind: 'unused' }, { foreignSecret: true })),
          receivedAt: env.receivedAt(),
        }),
        env.payments.parseWebhook({
          ...(await env.driver.malformed('unknown_status', env.providerRef)),
          receivedAt: env.receivedAt(),
        }),
        env.payments.getSubscription('sub_missing_9'),
        env.payments.pause({ providerRef: env.providerRef, when: 'now', idempotencyKey: 'bad' }),
      ];
      for (const f of failures) {
        const err = await f.catch((e: unknown) => e);
        expect(isPaymentsError(err)).toBe(true);
        keep(err);
        texts.push(String((err as Error).stack));
      }
      expect(env.secretValues.length).toBeGreaterThan(0);
      for (const secret of env.secretValues) {
        expect(texts.some((t) => leaks(t, secret))).toBe(false);
      }
    });
  });
}
