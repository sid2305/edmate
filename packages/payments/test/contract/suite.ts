// The shared Payments contract suite (ADR-0015). Provider-neutral: it takes a setup that returns
// an adapter, a scenario driver (the provider side a test can't reach through the port: a buyer
// completing checkout, signed deliveries) and capability flags, which are test-side only. It runs
// against the fake for both signature styles (10.1b) and against every real adapter (10.1c on).
// Phase C must not change this file, so every ADR-0015 rule an adapter could break has a case
// here, and test/suite-mutants.test.ts proves deliberately broken adapters fail them.
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
import { WEBHOOK_MAX_BYTES } from '../../src/webhook/body.js';
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
  /** The provider's subscription for a checkout the buyer has not finished (before it starts). */
  | { kind: 'pre_start'; checkoutRef: string }
  | { kind: 'unused' };

/** Which secret signs a delivery: a configured one (rotation), an unknown one, or the empty key. */
export type SigningSecret = 'current' | 'previous' | 'foreign' | 'empty';

export interface ContractDriver {
  /** The buyer pays on the hosted page; a trial starts unpaid, otherwise the first charge is made. */
  completeCheckout(
    checkoutRef: string,
    options: { trial: boolean },
  ): Promise<{ providerRef: string; paymentRef?: string }>;
  /** Every charge on a subscription, oldest first. */
  charges(providerRef: string): Promise<Money[]>;
  /**
   * A correctly signed delivery, or one signed with a foreign secret, or at a skewed time. With
   * `restamp` (timestamped providers), it is signed at now + signedSkewSeconds and then its header
   * timestamp is rewritten to now + headerSkewSeconds, with the signature left unchanged.
   */
  delivery(
    event: DriverEvent,
    options?: {
      foreignSecret?: boolean;
      skewSeconds?: number;
      restamp?: { signedSkewSeconds: number; headerSkewSeconds: number };
    },
  ): Promise<SignedDelivery>;
  /** Signature headers over these exact bytes, signed now with the chosen secret (default current). */
  signed(rawBody: Uint8Array, options?: { secret?: SigningSecret }): Promise<SignedDelivery>;
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

/**
 * The places ADR-0015 §3 and §4 let an adapter throw `unsupported` instead of emulating the
 * operation with hidden state. The caller (10.3) then falls back.
 */
export type UnsupportedOperation =
  | 'changePlan.period_end'
  | 'changePlan.proration_none'
  | 'pause.period_end'
  | 'cancel.period_end'
  /** A provider with no idempotency keys whose refunds can't be found by key (ADR-0015 §3). */
  | 'refund';

export interface ContractCapabilities {
  signsTimestamp: boolean;
  scheduledResume: boolean;
  /** Declared unsupported: the suite expects `unsupported` (after the input check) instead. */
  unsupported?: readonly UnsupportedOperation[];
}

export interface ContractSuiteOptions {
  name: string;
  setup: () => ContractSetup;
  capabilities: ContractCapabilities;
  /**
   * Suite self-test only (test/suite-mutants.test.ts): the cases a deliberately broken adapter
   * must fail. Each runs as `it.fails`; every other case must still pass.
   */
  expectFailing?: readonly string[];
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

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);
const text = (b: Uint8Array): string => new TextDecoder().decode(b);

/** The same JSON value with every object's keys in reverse order. */
function reordered(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(reordered);
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v)
        .reverse()
        .map(([k, x]) => [k, reordered(x)]),
    );
  }
  return v;
}

async function codeOf(p: Promise<unknown>): Promise<PaymentsErrorCode | 'resolved' | 'other'> {
  try {
    await p;
    return 'resolved';
  } catch (err) {
    return isPaymentsError(err) ? err.code : 'other';
  }
}

export function describePaymentsContract(o: ContractSuiteOptions): void {
  const failing = new Set(o.expectFailing ?? []);
  const registered = new Set<string>();
  /** Registers one case: `it`, or `it.fails` when the self-test expects this adapter to fail it. */
  const test = (name: string, fn: () => Promise<void>, run = true): void => {
    if (registered.has(name)) throw new Error(`duplicate contract case: ${name}`);
    registered.add(name);
    if (!run) {
      it.skip(name, fn);
      return;
    }
    if (failing.delete(name)) it.fails(name, fn);
    else it(name, fn);
  };
  const supports = (op: UnsupportedOperation): boolean =>
    !(o.capabilities.unsupported ?? []).includes(op);
  /** When `op` is declared unsupported, asserts the call threw `unsupported` and returns true. */
  async function refusedAsUnsupported(op: UnsupportedOperation, call: Promise<unknown>) {
    if (supports(op)) return false;
    expect(await codeOf(call)).toBe('unsupported');
    return true;
  }

  describe(`Payments contract: ${o.name}`, () => {
    /** A subscription that is live: checkout, then the buyer pays (or starts a trial). */
    async function startIn(env: ContractSetup, trial = false, subscriptionId = 'sub_1') {
      const checkout = await env.payments.startCheckout({
        subscriptionId,
        offer: BASIC,
        returnUrl: RETURN_URL,
        idempotencyKey: key('checkout'),
      });
      return { ...(await env.driver.completeCheckout(checkout.checkoutRef, { trial })), checkout };
    }
    async function started(trial = false) {
      const env = o.setup();
      return { ...env, ...(await startIn(env, trial)) };
    }

    async function parsed(env: ContractSetup, d: SignedDelivery): Promise<PaymentEvent> {
      const event = await env.payments.parseWebhook({ ...d, receivedAt: env.receivedAt() });
      expect(PaymentEventSchema.parse(event)).toEqual(event);
      expect(event.provider).toBe(env.payments.provider);
      return event;
    }
    const verdict = (env: ContractSetup, d: SignedDelivery) =>
      codeOf(env.payments.parseWebhook({ ...d, receivedAt: env.receivedAt() }));

    describe('checkout', () => {
      test('returns the hosted https page, and the same result for the same key', async () => {
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

      test('a completed checkout gives a subscription event with Edmate subscriptionId (trial or active)', async () => {
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
      for (const k of ['short', 'has space key', 'x'.repeat(129), 'emoji-key-\u{1f600}', '']) {
        test(`refuses idempotency key ${JSON.stringify(k)} with validation, before any work`, async () => {
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
      }

      for (const returnUrl of [
        'http://edmate.example/return',
        'javascript:alert(1)',
        'not a url',
        '',
      ]) {
        test(`refuses return URL ${JSON.stringify(returnUrl)}`, async () => {
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
        });
      }

      test('refuses a bad offer, ref, refund amount or an extra field', async () => {
        const env = await started();
        const calls: Promise<unknown>[] = [
          env.payments.startCheckout({
            subscriptionId: 'sub_1',
            offer: { ...BASIC, name: 'Algebra\u{3164}' },
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

      test('the same key with different input is a conflict on every write', async () => {
        const env = await started();
        const other = await startIn(env, false, 'sub_2');
        const [a, b] = [env.providerRef, other.providerRef];
        const writes: [string, (ref: string, k: string) => Promise<unknown>][] = [
          [
            'changePlan',
            (ref, k) =>
              env.payments.changePlan({
                providerRef: ref,
                offer: PLUS,
                when: 'now',
                proration: 'prorate',
                idempotencyKey: k,
              }),
          ],
          [
            'pause',
            (ref, k) => env.payments.pause({ providerRef: ref, when: 'now', idempotencyKey: k }),
          ],
          ['resume', (ref, k) => env.payments.resume({ providerRef: ref, idempotencyKey: k })],
          [
            'clearScheduled',
            (ref, k) => env.payments.clearScheduled({ providerRef: ref, idempotencyKey: k }),
          ],
          [
            'cancel',
            (ref, k) => env.payments.cancel({ providerRef: ref, when: 'now', idempotencyKey: k }),
          ],
        ];
        let used = '';
        for (const [op, call] of writes) {
          const k = key(op);
          expect([op, await codeOf(call(a, k))]).toEqual([op, 'resolved']);
          expect([op, await codeOf(call(b, k))]).toEqual([op, 'conflict']);
          // A key used by one operation is a conflict for another one too.
          if (used !== '') expect([op, await codeOf(call(a, used))]).toEqual([op, 'conflict']);
          used = k;
        }
        if (supports('refund')) {
          const k = key('refund');
          const amount = { amountMinor: 100, currency: 'USD' };
          const paymentRef = env.paymentRef as string;
          await env.payments.refund({ paymentRef, amount, idempotencyKey: k });
          const otherRef = other.paymentRef as string;
          expect(
            await codeOf(env.payments.refund({ paymentRef: otherRef, amount, idempotencyKey: k })),
          ).toBe('conflict');
        }
        // The second subscription was never touched.
        expect(await env.payments.getSubscription(b)).toMatchObject({
          status: 'active',
          packageVersionId: BASIC.packageVersionId,
        });
        expect(await env.driver.charges(b)).toHaveLength(1);
      });
    });

    describe('plan changes', () => {
      test('now with prorate applies at once and charges a prorated amount', async () => {
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

      test('now with none applies with no charge (the scheduled-downgrade fallback)', async () => {
        const env = await started();
        const call = env.payments.changePlan({
          providerRef: env.providerRef,
          offer: PLUS,
          when: 'now',
          proration: 'none',
          idempotencyKey: key('plan'),
        });
        if (await refusedAsUnsupported('changePlan.proration_none', call)) return;
        expect((await call).packageVersionId).toBe(PLUS.packageVersionId);
        expect(await env.driver.charges(env.providerRef)).toHaveLength(1);
      });

      test('at period end sets scheduled plan, and a repeat to the same offer returns the snapshot', async () => {
        const env = await started();
        const input = { providerRef: env.providerRef, offer: PLUS, when: 'period_end' as const };
        const call = env.payments.changePlan({ ...input, idempotencyKey: key('plan') });
        if (await refusedAsUnsupported('changePlan.period_end', call)) return;
        const after = await call;
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
      test('pause now, then resume', async () => {
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

      test('pause at period end is scheduled, and clearScheduled undoes it', async () => {
        const env = await started();
        const call = env.payments.pause({
          providerRef: env.providerRef,
          when: 'period_end',
          idempotencyKey: key('pause'),
        });
        if (await refusedAsUnsupported('pause.period_end', call)) return;
        const later = await call;
        expect(later.status).toBe('active');
        expect(later.scheduled).toEqual({ change: 'pause', at: later.periodEnd });
        const cleared = await env.payments.clearScheduled({
          providerRef: env.providerRef,
          idempotencyKey: key('clear'),
        });
        expect(cleared.scheduled).toBeUndefined();
        expect(cleared.status).toBe('active');
      });

      test(
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
        o.capabilities.scheduledResume,
      );

      test('clearScheduled with nothing scheduled returns the current snapshot', async () => {
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

      test('cancel at period end is scheduled; cancel now ends it; a repeat returns the snapshot', async () => {
        const env = await started();
        const call = env.payments.cancel({
          providerRef: env.providerRef,
          when: 'period_end',
          idempotencyKey: key('cancel'),
        });
        if (!(await refusedAsUnsupported('cancel.period_end', call))) {
          const later = await call;
          expect(later.status).toBe('active');
          expect(later.scheduled).toEqual({ change: 'cancel', at: later.periodEnd });
        }
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

      test('getSubscription returns the current view; an unknown ref is not_found', async () => {
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
      test('a partial refund, then amount omitted refunds exactly what is left', async () => {
        const env = await started();
        const paymentRef = env.paymentRef as string;
        const call = env.payments.refund({
          paymentRef,
          amount: { amountMinor: 300, currency: 'USD' },
          idempotencyKey: key('refund'),
        });
        if (await refusedAsUnsupported('refund', call)) return;
        const part = await call;
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

      test('amount omitted on an untouched payment is a full refund', async () => {
        const env = await started();
        const call = env.payments.refund({
          paymentRef: env.paymentRef as string,
          idempotencyKey: key('refund'),
        });
        if (await refusedAsUnsupported('refund', call)) return;
        const full = await call;
        const event = await parsed(
          env,
          await env.driver.delivery({ kind: 'refund', refundRef: full.refundRef }),
        );
        expect(event.facts[0]).toMatchObject({ type: 'refund', amount: BASIC.price });
      });

      test('same key returns the same refund; a different amount under it is a conflict; too much is validation', async () => {
        const env = await started();
        const paymentRef = env.paymentRef as string;
        const k = key('refund');
        const call = env.payments.refund({
          paymentRef,
          amount: { amountMinor: 100, currency: 'USD' },
          idempotencyKey: k,
        });
        if (await refusedAsUnsupported('refund', call)) return;
        const first = await call;
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
      test('plan change and cancel', async () => {
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

        const when: 'now' | 'period_end' = supports('cancel.period_end') ? 'period_end' : 'now';
        env.driver.timeoutAfterApply('cancel');
        const cancelInput = { providerRef: env.providerRef, when, idempotencyKey: key('cancel') };
        expect(await codeOf(env.payments.cancel(cancelInput))).toBe('provider_error');
        const after = await env.payments.cancel(cancelInput);
        if (when === 'now') expect(after.status).toBe('ended');
        else expect(after.scheduled?.change).toBe('cancel');
      });

      test('resume: the retry resumes once and charges once', async () => {
        const env = await started();
        await env.payments.pause({
          providerRef: env.providerRef,
          when: 'now',
          idempotencyKey: key('pause'),
        });
        env.driver.timeoutAfterApply('resume');
        const input = { providerRef: env.providerRef, idempotencyKey: key('resume') };
        expect(await codeOf(env.payments.resume(input))).toBe('provider_error');
        const retried = await env.payments.resume(input);
        expect(retried.status).toBe('active');
        expect(await env.payments.resume(input)).toEqual(retried);
        // The first charge, then exactly one for the resume.
        expect(await env.driver.charges(env.providerRef)).toHaveLength(2);
      });

      test('refund: the retry returns the first refund and nothing is refunded twice', async () => {
        const env = await started();
        const paymentRef = env.paymentRef as string;
        env.driver.timeoutAfterApply('refund');
        const input = {
          paymentRef,
          amount: { amountMinor: 300, currency: 'USD' },
          idempotencyKey: key('refund'),
        };
        const code = await codeOf(env.payments.refund(input));
        if (!supports('refund')) {
          expect(code).toBe('unsupported');
          return;
        }
        expect(code).toBe('provider_error');
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

      test('full refund (amount omitted): the retry returns the same refund, paid out once', async () => {
        const env = await started();
        const paymentRef = env.paymentRef as string;
        env.driver.timeoutAfterApply('refund');
        const input = { paymentRef, idempotencyKey: key('refund') };
        const code = await codeOf(env.payments.refund(input));
        if (!supports('refund')) {
          expect(code).toBe('unsupported');
          return;
        }
        expect(code).toBe('provider_error');
        const retried = await env.payments.refund(input);
        expect(await env.payments.refund(input)).toEqual(retried);
        const event = await parsed(
          env,
          await env.driver.delivery({ kind: 'refund', refundRef: retried.refundRef }),
        );
        expect(event.facts[0]).toMatchObject({ amount: BASIC.price });
        // Everything went out once: nothing is left for a new key.
        expect(
          await codeOf(
            env.payments.refund({
              paymentRef,
              amount: { amountMinor: 1, currency: 'USD' },
              idempotencyKey: key('refund'),
            }),
          ),
        ).not.toBe('resolved');
      });
    });

    describe('webhooks', () => {
      test('maps payments and refunds, and an unused event type gives no facts', async () => {
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

      test('a provider state before the subscription starts gives no facts', async () => {
        const env = o.setup();
        const checkout = await env.payments.startCheckout({
          subscriptionId: 'sub_1',
          offer: BASIC,
          returnUrl: RETURN_URL,
          idempotencyKey: key('checkout'),
        });
        const event = await parsed(
          env,
          await env.driver.delivery({ kind: 'pre_start', checkoutRef: checkout.checkoutRef }),
        );
        expect(event.facts).toEqual([]);
      });

      test('eventId is stable when the same bytes are redelivered', async () => {
        const env = await started();
        const d = await env.driver.delivery({ kind: 'subscription', providerRef: env.providerRef });
        const first = await parsed(env, d);
        const again = await parsed(env, {
          rawBody: Uint8Array.from(d.rawBody),
          headers: { ...d.headers },
        });
        expect(again.eventId).toBe(first.eventId);
        expect(again).toEqual(first);
      });

      test('refuses a missing header, a bad signature and a tampered body', async () => {
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

      test('refuses a delivery signed with an empty secret', async () => {
        const env = await started();
        const d = await env.driver.delivery({ kind: 'subscription', providerRef: env.providerRef });
        expect(await verdict(env, await env.driver.signed(d.rawBody, { secret: 'empty' }))).toBe(
          'invalid_signature',
        );
      });

      test('accepts a delivery signed with the previous secret (rotation)', async () => {
        const env = await started();
        const d = await env.driver.delivery({ kind: 'subscription', providerRef: env.providerRef });
        const event = await parsed(env, await env.driver.signed(d.rawBody, { secret: 'previous' }));
        expect(event.facts[0]?.type).toBe('subscription');
      });

      test('verifies the exact bytes: extra whitespace and unsorted keys, signed as sent, are accepted', async () => {
        const env = await started();
        const d = await env.driver.delivery({ kind: 'subscription', providerRef: env.providerRef });
        const compact = await parsed(env, d);
        const value: unknown = JSON.parse(text(d.rawBody));
        const pretty = bytes(`\n  ${JSON.stringify(reordered(value), null, 3)}  \n`);
        expect(await parsed(env, await env.driver.signed(pretty))).toEqual(compact);
      });

      test('refuses the same JSON value in other bytes than were signed', async () => {
        const env = await started();
        const d = await env.driver.delivery({ kind: 'subscription', providerRef: env.providerRef });
        const value = reordered(JSON.parse(text(d.rawBody)));
        const pretty = bytes(JSON.stringify(value, null, 2));
        const compact = bytes(JSON.stringify(value));
        const signedPretty = await env.driver.signed(pretty);
        const signedCompact = await env.driver.signed(compact);
        expect(await verdict(env, { rawBody: compact, headers: signedPretty.headers })).toBe(
          'invalid_signature',
        );
        expect(await verdict(env, { rawBody: pretty, headers: signedCompact.headers })).toBe(
          'invalid_signature',
        );
      });

      test('refuses a correctly signed body over 1 MiB; exactly 1 MiB is read', async () => {
        const env = await started();
        const d = await env.driver.delivery({ kind: 'subscription', providerRef: env.providerRef });
        const padded = (size: number) =>
          bytes(text(d.rawBody) + ' '.repeat(size - d.rawBody.length));
        expect(await verdict(env, await env.driver.signed(padded(WEBHOOK_MAX_BYTES)))).toBe(
          'resolved',
        );
        expect(await verdict(env, await env.driver.signed(padded(WEBHOOK_MAX_BYTES + 1)))).toBe(
          'malformed_event',
        );
      });

      test(
        'refuses a stale or future timestamp',
        async () => {
          const env = await started();
          for (const skewSeconds of [-301, 301]) {
            const d = await env.driver.delivery(
              { kind: 'subscription', providerRef: env.providerRef },
              { skewSeconds },
            );
            expect(await verdict(env, d)).toBe('stale_signature');
          }
          const ok = await env.driver.delivery(
            { kind: 'subscription', providerRef: env.providerRef },
            { skewSeconds: -299 },
          );
          expect(await verdict(env, ok)).toBe('resolved');
        },
        o.capabilities.signsTimestamp,
      );

      test(
        'refuses a delivery whose signed timestamp was rewritten, signature unchanged',
        async () => {
          const env = await started();
          const event = { kind: 'subscription', providerRef: env.providerRef } as const;
          // An old delivery replayed with a fresh timestamp, and a fresh one nudged by 5 s.
          for (const restamp of [
            { signedSkewSeconds: -3600, headerSkewSeconds: 0 },
            { signedSkewSeconds: 0, headerSkewSeconds: 5 },
          ]) {
            const d = await env.driver.delivery(event, { restamp });
            expect([restamp, await verdict(env, d)]).toEqual([restamp, 'invalid_signature']);
          }
        },
        o.capabilities.signsTimestamp,
      );

      for (const kind of ['bad_json', 'unknown_status', 'missing_subscription_id'] as const) {
        test(`a signed body with ${kind} is malformed_event, never active`, async () => {
          const env = await started();
          expect(await verdict(env, await env.driver.malformed(kind, env.providerRef))).toBe(
            'malformed_event',
          );
        });
      }

      for (const kind of ['unknown_status', 'missing_subscription_id'] as const) {
        test(`a body with ${kind} signed with a foreign secret is invalid_signature (signature first)`, async () => {
          const env = await started();
          const bad = await env.driver.malformed(kind, env.providerRef);
          const foreign = await env.driver.signed(bad.rawBody, { secret: 'foreign' });
          expect(await verdict(env, foreign)).toBe('invalid_signature');
        });
      }
    });

    test('no key or secret fragment reaches any output or error', async () => {
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

    if (o.expectFailing !== undefined) {
      // Read when it runs, after collection: nested describes register their cases late, and
      // every name `test` registered as `it.fails` was removed from `failing`.
      it('every case the self-test expects to fail exists and runs', () => {
        expect([...failing]).toEqual([]);
      });
    }
  });
}
