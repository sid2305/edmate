import { describe, expect, it } from 'vitest';
import { isPaymentsError } from '../src/errors.js';
import { Secret } from '../src/secret.js';
import { createFakePayments, type FakePayments } from '../src/testing/index.js';
import { describePaymentsContract } from './contract/suite.js';
import { fakeSetup, START } from './helpers/fake-driver.js';
import { fakeSecret } from './helpers/fake-secret.js';

describePaymentsContract({
  name: 'fake, timestamped signatures (Paddle-like)',
  setup: () => fakeSetup({ signatureStyle: 'timestamped' }),
  capabilities: { signsTimestamp: true, scheduledResume: true },
});

describePaymentsContract({
  name: 'fake, body-only signatures (Lemon Squeezy and Razorpay-like)',
  setup: () => fakeSetup({ provider: 'altpay', signatureStyle: 'body-only' }),
  capabilities: { signsTimestamp: false, scheduledResume: true },
});

const OFFER = {
  packageVersionId: 'pkv_basic',
  name: 'Algebra',
  price: { amountMinor: 1000, currency: 'USD' },
  interval: 'month' as const,
};
let n = 0;
const k = () => `fake-key-${(n += 1)}`;

async function codeOf(p: Promise<unknown> | (() => unknown)): Promise<string> {
  try {
    await (typeof p === 'function' ? p() : p);
    return 'resolved';
  } catch (err) {
    return isPaymentsError(err) ? err.code : 'other';
  }
}

async function live(payments: FakePayments, trial = false) {
  const c = await payments.startCheckout({
    subscriptionId: 'sub_1',
    offer: OFFER,
    returnUrl: 'https://edmate.example/r',
    idempotencyKey: k(),
  });
  return { checkoutRef: c.checkoutRef, ...payments.completeCheckout(c.checkoutRef, { trial }) };
}

describe('fake adapter specifics', () => {
  it('refuses a bad provider id, duplicate status words or no secrets', () => {
    const base = { webhookSecrets: [Secret.of(fakeSecret())], now: () => new Date(START) };
    expect(() => createFakePayments({ ...base, provider: 'Bad Id' })).toThrow(
      'payment request is invalid',
    );
    expect(() => createFakePayments({ ...base, provider: 'tbd' })).toThrow(
      'payment request is invalid',
    );
    expect(() =>
      createFakePayments({
        ...base,
        statusWords: { trial: 'a', active: 'a', past_due: 'b', paused: 'c', ended: 'd' },
      }),
    ).toThrow('payment request is invalid');
    expect(() => createFakePayments({ ...base, webhookSecrets: [] })).toThrow(
      'payment request is invalid',
    );
    // An empty or blank secret slipped past Secret.of (a stand-in with the same shape).
    for (const value of ['', '  ']) {
      const blank = { reveal: () => value } as unknown as Secret;
      expect(() =>
        createFakePayments({ ...base, webhookSecrets: [Secret.of(fakeSecret()), blank] }),
      ).toThrow('payment request is invalid');
    }
    // No status may use the fake's pre-start word.
    expect(() =>
      createFakePayments({
        ...base,
        statusWords: { trial: 'incomplete', active: 'a', past_due: 'b', paused: 'c', ended: 'd' },
      }),
    ).toThrow('payment request is invalid');
    expect(createFakePayments(base).provider).toBe('fake');
  });

  it('completeCheckout is repeat-safe, and an unknown checkout is not_found', async () => {
    const { payments } = fakeSetup();
    const first = await live(payments);
    expect(payments.completeCheckout(first.checkoutRef)).toEqual({
      providerRef: first.providerRef,
      paymentRef: first.paymentRef,
    });
    const trial = await live(payments, true);
    expect(trial.paymentRef).toBeUndefined();
    expect(payments.completeCheckout(trial.checkoutRef, { trial: true })).toEqual({
      providerRef: trial.providerRef,
    });
    expect(await codeOf(() => payments.completeCheckout('chk_missing'))).toBe('not_found');
  });

  it('a trial without trialDays lasts 14 days; with trialDays, that many', async () => {
    const { payments } = fakeSetup();
    const t = await live(payments, true);
    expect((await payments.getSubscription(t.providerRef)).periodEnd).toBe(
      new Date(START + 14 * 86_400_000).toISOString(),
    );
    const c = await payments.startCheckout({
      subscriptionId: 'sub_2',
      offer: { ...OFFER, trialDays: 3 },
      returnUrl: 'https://edmate.example/r',
      idempotencyKey: k(),
    });
    const s = payments.completeCheckout(c.checkoutRef, { trial: true });
    expect((await payments.getSubscription(s.providerRef)).periodEnd).toBe(
      new Date(START + 3 * 86_400_000).toISOString(),
    );
  });

  it('charge adds a renewal; an ended subscription refuses writes with conflict', async () => {
    const { payments } = fakeSetup();
    const s = await live(payments);
    payments.charge(s.providerRef);
    expect(payments.charges(s.providerRef)).toHaveLength(2);
    await payments.cancel({ providerRef: s.providerRef, when: 'now', idempotencyKey: k() });
    expect(await codeOf(() => payments.charge(s.providerRef))).toBe('conflict');
    expect(
      await codeOf(
        payments.pause({ providerRef: s.providerRef, when: 'now', idempotencyKey: k() }),
      ),
    ).toBe('conflict');
    expect(await codeOf(payments.resume({ providerRef: s.providerRef, idempotencyKey: k() }))).toBe(
      'conflict',
    );
    expect(
      await codeOf(
        payments.changePlan({
          providerRef: s.providerRef,
          offer: OFFER,
          when: 'period_end',
          idempotencyKey: k(),
        }),
      ),
    ).toBe('conflict');
    expect(
      await codeOf(payments.clearScheduled({ providerRef: 'sub_none', idempotencyKey: k() })),
    ).toBe('not_found');
  });

  it('scheduleResume refuses a bad time with validation and changes nothing', async () => {
    const { payments } = fakeSetup();
    const s = await live(payments);
    await payments.pause({ providerRef: s.providerRef, when: 'now', idempotencyKey: k() });
    const before = await payments.getSubscription(s.providerRef);
    for (const at of ['tomorrow', '2026-10-23T10:00:00', '', 7 as unknown as string]) {
      expect(await codeOf(() => payments.scheduleResume(s.providerRef, at))).toBe('validation');
      expect(await payments.getSubscription(s.providerRef)).toEqual(before);
    }
    expect(await codeOf(() => payments.scheduleResume('sub_missing_9', 'tomorrow'))).toBe(
      'validation',
    );
  });

  it('a pre-start delivery for an unknown checkout is not_found', async () => {
    const { payments } = fakeSetup();
    expect(await codeOf(() => payments.emit({ kind: 'pre_start', checkoutRef: 'chk_none' }))).toBe(
      'not_found',
    );
  });

  it('scheduleResume needs a paused subscription', async () => {
    const { payments } = fakeSetup();
    const s = await live(payments);
    expect(
      await codeOf(() => payments.scheduleResume(s.providerRef, new Date(START).toISOString())),
    ).toBe('conflict');
  });

  it('a plan change in another currency is unsupported; a downgrade now charges nothing', async () => {
    const { payments } = fakeSetup();
    const s = await live(payments);
    const eur = {
      ...OFFER,
      packageVersionId: 'pkv_eur',
      price: { amountMinor: 900, currency: 'EUR' },
    };
    expect(
      await codeOf(
        payments.changePlan({
          providerRef: s.providerRef,
          offer: eur,
          when: 'now',
          proration: 'prorate',
          idempotencyKey: k(),
        }),
      ),
    ).toBe('unsupported');
    const cheaper = {
      ...OFFER,
      packageVersionId: 'pkv_lite',
      price: { amountMinor: 500, currency: 'USD' },
    };
    await payments.changePlan({
      providerRef: s.providerRef,
      offer: cheaper,
      when: 'now',
      proration: 'prorate',
      idempotencyKey: k(),
    });
    expect(payments.charges(s.providerRef)).toHaveLength(1);
  });

  it('a period-end change to the current offer replaces a scheduled change (it is not a no-op then)', async () => {
    const { payments } = fakeSetup();
    const s = await live(payments);
    await payments.cancel({ providerRef: s.providerRef, when: 'period_end', idempotencyKey: k() });
    const after = await payments.changePlan({
      providerRef: s.providerRef,
      offer: OFFER,
      when: 'period_end',
      idempotencyKey: k(),
    });
    expect(after.scheduled).toMatchObject({ change: 'plan', packageVersionId: 'pkv_basic' });
    const same = await payments
      .changePlan({
        providerRef: 'x'.repeat(3),
        offer: OFFER,
        when: 'period_end',
        idempotencyKey: k(),
      })
      .catch((e: unknown) => e);
    expect(isPaymentsError(same, 'not_found')).toBe(true);
  });

  it('a period-end change to the current offer with nothing scheduled returns the snapshot', async () => {
    const { payments } = fakeSetup();
    const s = await live(payments);
    const before = await payments.getSubscription(s.providerRef);
    expect(
      await payments.changePlan({
        providerRef: s.providerRef,
        offer: OFFER,
        when: 'period_end',
        idempotencyKey: k(),
      }),
    ).toEqual(before);
  });

  it('a scheduled cancel travels in the webhook snapshot with no packageVersionId', async () => {
    const env = fakeSetup();
    const s = await live(env.payments);
    await env.payments.cancel({
      providerRef: s.providerRef,
      when: 'period_end',
      idempotencyKey: k(),
    });
    const d = env.payments.emit({ kind: 'subscription', providerRef: s.providerRef });
    const event = await env.payments.parseWebhook({ ...d, receivedAt: env.receivedAt() });
    expect(event.facts[0]).toMatchObject({ subscription: { scheduled: { change: 'cancel' } } });
  });

  it('pause at period end on a paused subscription returns the snapshot', async () => {
    const { payments } = fakeSetup();
    const s = await live(payments);
    const paused = await payments.pause({
      providerRef: s.providerRef,
      when: 'now',
      idempotencyKey: k(),
    });
    expect(
      await payments.pause({ providerRef: s.providerRef, when: 'period_end', idempotencyKey: k() }),
    ).toEqual(paused);
  });

  it('injected failures: before the work, on reads, and a key reused across operations is a conflict', async () => {
    const { payments } = fakeSetup();
    const s = await live(payments);
    payments.failNext('pause', { code: 'rate_limited' });
    const key = k();
    const err = await payments
      .pause({ providerRef: s.providerRef, when: 'now', idempotencyKey: key })
      .catch((e: unknown) => e);
    expect(isPaymentsError(err, 'rate_limited') && err.retryable).toBe(true);
    expect((await payments.getSubscription(s.providerRef)).status).toBe('active');
    expect(
      (await payments.pause({ providerRef: s.providerRef, when: 'now', idempotencyKey: key }))
        .status,
    ).toBe('paused');
    expect(await codeOf(payments.resume({ providerRef: s.providerRef, idempotencyKey: key }))).toBe(
      'conflict',
    );

    payments.failNext('getSubscription', { code: 'provider_error', retryable: false });
    const read = await payments.getSubscription(s.providerRef).catch((e: unknown) => e);
    expect(isPaymentsError(read, 'provider_error') && !read.retryable).toBe(true);

    payments.failNext('refund', { code: 'provider_error' });
    expect(
      await codeOf(payments.refund({ paymentRef: s.paymentRef as string, idempotencyKey: k() })),
    ).toBe('provider_error');
    payments.failNext('refund', { code: 'not_found' });
    payments.failNext('refund', { code: 'conflict' });
    expect(
      await codeOf(payments.refund({ paymentRef: s.paymentRef as string, idempotencyKey: k() })),
    ).toBe('not_found');
    expect(
      await codeOf(payments.refund({ paymentRef: s.paymentRef as string, idempotencyKey: k() })),
    ).toBe('conflict');
  });

  it('a refund key already used by another write, or a refund in another currency, is refused', async () => {
    const { payments } = fakeSetup();
    const s = await live(payments);
    const key = k();
    await payments.clearScheduled({ providerRef: s.providerRef, idempotencyKey: key });
    expect(
      await codeOf(payments.refund({ paymentRef: s.paymentRef as string, idempotencyKey: key })),
    ).toBe('conflict');
    expect(
      await codeOf(
        payments.refund({
          paymentRef: s.paymentRef as string,
          amount: { amountMinor: 10, currency: 'EUR' },
          idempotencyKey: k(),
        }),
      ),
    ).toBe('validation');
  });

  it('emit refuses unknown payments and refunds', async () => {
    const { payments } = fakeSetup();
    expect(
      await codeOf(() => payments.emit({ kind: 'payment_succeeded', paymentRef: 'pay_x' })),
    ).toBe('not_found');
    expect(await codeOf(() => payments.emit({ kind: 'refund', refundRef: 're_x' }))).toBe(
      'not_found',
    );
    expect(
      await codeOf(() => payments.emit({ kind: 'payment_failed', providerRef: 'sub_x' })),
    ).toBe('not_found');
  });

  it('a timestamped header needs exactly one ts with digits, and an h1 that matches', async () => {
    const env = fakeSetup();
    const s = await live(env.payments);
    const d = env.payments.emit({ kind: 'subscription', providerRef: s.providerRef });
    const header = d.headers['fake-signature'] as string;
    const [ts, h1] = header.split(';');
    const receivedAt = env.receivedAt();
    for (const bad of [`${h1}`, `${ts};${ts};${h1}`, `ts=abc;${h1}`, `${ts};h1`, `${ts}`]) {
      expect(
        await codeOf(
          env.payments.parseWebhook({
            rawBody: d.rawBody,
            headers: { 'fake-signature': bad },
            receivedAt,
          }),
        ),
      ).toBe('invalid_signature');
    }
    expect(
      await codeOf(
        env.payments.parseWebhook({
          rawBody: d.rawBody,
          headers: { 'fake-signature': `${ts};h1=00;${h1}` },
          receivedAt,
        }),
      ),
    ).toBe('resolved');
    // The second (older) secret still verifies during rotation.
    const older = env.payments.sign(d.rawBody, {
      secret: Secret.of(env.secretValues[1] as string),
    });
    expect(
      await codeOf(env.payments.parseWebhook({ rawBody: d.rawBody, headers: older, receivedAt })),
    ).toBe('resolved');
  });

  it('a configured tolerance below 300 s is honoured', async () => {
    const env = fakeSetup({ toleranceSeconds: 30 });
    const s = await live(env.payments);
    const d = env.payments.emit(
      { kind: 'subscription', providerRef: s.providerRef },
      { signedAt: new Date(START - 31_000) },
    );
    expect(await codeOf(env.payments.parseWebhook({ ...d, receivedAt: env.receivedAt() }))).toBe(
      'stale_signature',
    );
  });

  it('bad envelopes, bad fact data, a scheduled change and a snapshot that fails the contracts schema', async () => {
    const env = fakeSetup({ signatureStyle: 'body-only' });
    const s = await live(env.payments);
    const receivedAt = env.receivedAt();
    const parse = (body: unknown) =>
      env.payments.parseWebhook({ ...env.payments.emitRaw(body), receivedAt });
    const at = new Date(START).toISOString();
    expect(await codeOf(parse({ event_type: 'x' }))).toBe('malformed_event');
    for (const type of ['payment.succeeded', 'payment.failed', 'refund.updated']) {
      expect(
        await codeOf(parse({ event_id: 'evt_1', event_type: type, occurred_at: at, data: {} })),
      ).toBe('malformed_event');
    }
    // A non-ISO occurredAt passes the provider shape but fails the contracts schema.
    expect(
      await codeOf(parse({ event_id: 'evt_1', event_type: 'x.y', occurred_at: 'today', data: {} })),
    ).toBe('malformed_event');
    await env.payments.changePlan({
      providerRef: s.providerRef,
      offer: { ...OFFER, packageVersionId: 'pkv_plus' },
      when: 'period_end',
      idempotencyKey: k(),
    });
    const event = await parse({
      event_id: 'evt_2',
      event_type: 'subscription.updated',
      occurred_at: at,
      data: env.payments.subscriptionBody(s.providerRef),
    });
    expect(event.facts[0]).toMatchObject({
      subscription: { scheduled: { change: 'plan', packageVersionId: 'pkv_plus' } },
    });
    const pending = {
      ...env.payments.subscriptionBody(s.providerRef),
      status: 'active',
      custom_data: { subscription_id: 'sub 1', package_version_id: 'pkv_basic' },
    };
    expect(
      await codeOf(
        parse({
          event_id: 'evt_3',
          event_type: 'subscription.updated',
          occurred_at: at,
          data: pending,
        }),
      ),
    ).toBe('malformed_event');
  });

  it('status words are the provider own: each maps to its status', async () => {
    const words = {
      trial: 'on_trial',
      active: 'live',
      past_due: 'unpaid',
      paused: 'halted',
      ended: 'expired',
    };
    const env = fakeSetup({ provider: 'altpay', signatureStyle: 'body-only', statusWords: words });
    const s = await live(env.payments);
    for (const [status, word] of Object.entries(words)) {
      const data = { ...env.payments.subscriptionBody(s.providerRef), status: word };
      const event = await env.payments.parseWebhook({
        ...env.payments.emitRaw({
          event_id: `evt_${word}`,
          event_type: 'subscription.updated',
          occurred_at: new Date(START).toISOString(),
          data,
        }),
        receivedAt: env.receivedAt(),
      });
      expect(event.facts[0]).toMatchObject({ subscription: { status } });
    }
    expect(env.payments.subscriptionBody(s.providerRef).status).toBe('live');
  });
});
