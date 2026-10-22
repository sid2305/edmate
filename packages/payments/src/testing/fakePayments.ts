// An in-memory `Payments` adapter for tests (10.1b). It behaves like a provider with
// subscriptions: hosted checkout, plan changes (prorated now, or at period end), pause, resume,
// cancel, scheduled changes, refunds, and signed webhooks in its own body shape. The provider id,
// signature style (`timestamped` like Paddle, `body-only` like Lemon Squeezy and Razorpay) and
// status words are configurable, so one fake can stand in for two different providers.
// State lives only in the object a test creates; nothing reaches a network or a disk.
import {
  CheckoutResultSchema,
  PaymentEventSchema,
  ProviderSubscriptionSchema,
  RefundResultSchema,
  type CheckoutResult,
  type Money,
  type PaymentEvent,
  type PaymentFact,
  type PaymentOffer,
  type Payments,
  type ProviderSubscription,
  type RefundResult,
} from '@edmate/contracts';
import { z } from 'zod';
import { PaymentsError, type PaymentsErrorCode } from '../errors.js';
import { checkPortInput, type PortInput, type PortOperation } from '../input.js';
import type { Secret } from '../secret.js';
import {
  checkWebhookInput,
  parseJsonBody,
  readHeader,
  type WebhookInput,
} from '../webhook/body.js';
import {
  checkSignedTimestamp,
  concatBytes,
  hmacSha256Hex,
  matchesAnySignature,
} from '../webhook/hmac.js';

type Status = ProviderSubscription['status'];
type Scheduled = NonNullable<ProviderSubscription['scheduled']>;

export type FakeSignatureStyle = 'timestamped' | 'body-only';

export interface FakePaymentsOptions {
  /** The provider id; default `fake`. */
  provider?: string;
  /** Default `timestamped`. */
  signatureStyle?: FakeSignatureStyle;
  /** The provider's word for each status; default Paddle-like words. */
  statusWords?: Readonly<Record<Status, string>>;
  /** The first signs `emit` output; any of them verifies (rotation). At least one. */
  webhookSecrets: readonly Secret[];
  /** The injected clock. */
  now: () => Date;
  /** Signed-timestamp tolerance for `timestamped`; default and maximum 300 s. */
  toleranceSeconds?: number;
}

/** An injected failure for the next call of one operation. */
export interface FakeFailure {
  code: PaymentsErrorCode;
  retryable?: boolean;
  /** Apply the change, then throw: a timeout after the provider did the work. */
  afterApply?: boolean;
}

export interface SignedWebhook {
  rawBody: Uint8Array;
  headers: Record<string, string>;
}

export interface FakeSignOptions {
  /** Sign with this secret instead of the first configured one. */
  secret?: Secret;
  /** The signed timestamp (`timestamped` only); default the clock. */
  signedAt?: Date;
}

export type FakeEmit =
  | { kind: 'subscription'; providerRef: string; providerType?: string }
  | { kind: 'payment_succeeded'; paymentRef: string }
  | { kind: 'payment_failed'; providerRef: string }
  | { kind: 'refund'; refundRef: string }
  | { kind: 'other'; providerType: string };

export interface FakePayments extends Payments {
  /** The header the signature travels in (lower case). */
  readonly signatureHeader: string;
  /** Whether this fake signs a timestamp (and so refuses stale deliveries). */
  readonly signsTimestamp: boolean;
  /** The buyer completes the hosted checkout: a subscription starts (trial, or active and paid). */
  completeCheckout(
    checkoutRef: string,
    options?: { trial?: boolean },
  ): { providerRef: string; paymentRef?: string };
  /** A renewal charge at the current price; returns the payment ref. */
  charge(providerRef: string): string;
  /** A provider-side scheduled resume of a paused subscription (not on the port). */
  scheduleResume(providerRef: string, at: string): void;
  /** The next call of `op` fails with this error (once per call to failNext). */
  failNext(op: PortOperation, failure: FakeFailure): void;
  /** Every payment charged to a subscription, oldest first. */
  charges(providerRef: string): Money[];
  /** A signed webhook delivery for current state. */
  emit(event: FakeEmit, options?: FakeSignOptions): SignedWebhook;
  /** A signed webhook delivery for a body the test builds (any JSON value). */
  emitRaw(body: unknown, options?: FakeSignOptions): SignedWebhook;
  /** Signature headers for exact bytes. */
  sign(rawBody: Uint8Array, options?: FakeSignOptions): Record<string, string>;
  /** The provider's own data object for a subscription, for building raw variants. */
  subscriptionBody(providerRef: string): Record<string, unknown>;
}

const DEFAULT_STATUS_WORDS: Readonly<Record<Status, string>> = {
  trial: 'trialing',
  active: 'active',
  past_due: 'past_due',
  paused: 'paused',
  ended: 'canceled',
};
const DAY_MS = 86_400_000;
const PERIOD_MS = 30 * DAY_MS;
const DEFAULT_TRIAL_DAYS = 14;
/** The fake's processing fee, in percent of the amount. */
const FEE_PERCENT = 5;
const SUBSCRIPTION_TYPES = new Set([
  'checkout.completed',
  'subscription.created',
  'subscription.updated',
]);

interface SubState {
  providerRef: string;
  subscriptionId: string;
  packageVersionId: string;
  price: Money;
  status: Status;
  periodStart: number;
  periodEnd: number;
  scheduled?: Scheduled & { price?: Money };
}

interface RefundState {
  refundRef: string;
  key: string;
  /** The refund input as asked ('full' or an amount), to tell a retry from a conflict. */
  asked: string;
  amount: Money;
}

interface PaymentState {
  paymentRef: string;
  providerRef: string;
  subscriptionId: string;
  amount: Money;
  refunds: RefundState[];
}

// The fake provider's own webhook body shape. Unknown keys (the buyer's email) are dropped.
const EnvelopeSchema = z.object({
  event_id: z.string(),
  event_type: z.string(),
  occurred_at: z.string(),
  data: z.unknown(),
});
const CustomSchema = z.object({ subscription_id: z.string() });
const SubDataSchema = z.object({
  id: z.string(),
  status: z.string(),
  custom_data: CustomSchema.extend({ package_version_id: z.string() }),
  current_period_end: z.string(),
  scheduled_change: z
    .object({
      action: z.enum(['plan', 'cancel', 'pause', 'resume']),
      effective_at: z.string(),
      package_version_id: z.string().optional(),
    })
    .nullable(),
});
const PaidDataSchema = z.object({
  id: z.string(),
  subscription_ref: z.string(),
  custom_data: CustomSchema,
  totals: z.object({ currency: z.string(), amount: z.int(), tax: z.int(), fee: z.int() }),
});
const FailedDataSchema = z.object({
  id: z.string(),
  subscription_ref: z.string(),
  custom_data: CustomSchema,
});
const RefundDataSchema = z.object({
  id: z.string(),
  payment_id: z.string(),
  custom_data: CustomSchema,
  amount: z.int(),
  currency: z.string(),
  status: z.enum(['pending', 'succeeded', 'failed']),
});

function parseOr<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new PaymentsError('malformed_event');
  return parsed.data;
}

const iso = (ms: number): string => new Date(ms).toISOString();

export function createFakePayments(options: FakePaymentsOptions): FakePayments {
  const provider = options.provider ?? 'fake';
  const style = options.signatureStyle ?? 'timestamped';
  const words = options.statusWords ?? DEFAULT_STATUS_WORDS;
  const statusOf = new Map(Object.entries(words).map(([status, word]) => [word, status as Status]));
  if (
    !ProviderSubscriptionSchema.shape.provider.safeParse(provider).success ||
    statusOf.size !== Object.keys(DEFAULT_STATUS_WORDS).length ||
    options.webhookSecrets.length === 0
  ) {
    throw new PaymentsError('validation');
  }
  const secrets = [...options.webhookSecrets];
  const signatureHeader = style === 'timestamped' ? `${provider}-signature` : 'x-signature';
  const nowMs = (): number => options.now().getTime();

  let counter = 0;
  const nextRef = (prefix: string): string => `${prefix}_${provider}_${(counter += 1)}`;
  const checkouts = new Map<
    string,
    { subscriptionId: string; offer: PaymentOffer; providerRef?: string; paymentRef?: string }
  >();
  const subs = new Map<string, SubState>();
  const payments = new Map<string, PaymentState>();
  const refunds = new Map<string, RefundState & { paymentRef: string }>();
  const keys = new Map<string, { op: PortOperation; input: string; result: unknown }>();
  const failures = new Map<PortOperation, FakeFailure[]>();

  function takeFailure(op: PortOperation, afterApply: boolean): void {
    const next = failures.get(op)?.[0];
    if (next === undefined || (next.afterApply ?? false) !== afterApply) return;
    failures.get(op)?.shift();
    throw new PaymentsError(
      next.code,
      next.retryable === undefined ? {} : { retryable: next.retryable },
    );
  }

  function sub(providerRef: string): SubState {
    const s = subs.get(providerRef);
    if (s === undefined) throw new PaymentsError('not_found');
    return s;
  }

  function snapshot(s: SubState): ProviderSubscription {
    return ProviderSubscriptionSchema.parse({
      provider,
      providerRef: s.providerRef,
      subscriptionId: s.subscriptionId,
      status: s.status,
      packageVersionId: s.packageVersionId,
      periodEnd: iso(s.periodEnd),
      ...(s.scheduled === undefined
        ? {}
        : {
            scheduled: {
              change: s.scheduled.change,
              at: s.scheduled.at,
              ...(s.scheduled.packageVersionId === undefined
                ? {}
                : { packageVersionId: s.scheduled.packageVersionId }),
            },
          }),
    });
  }

  function pay(s: SubState, amount: Money): string {
    const paymentRef = nextRef('pay');
    payments.set(paymentRef, {
      paymentRef,
      providerRef: s.providerRef,
      subscriptionId: s.subscriptionId,
      amount,
      refunds: [],
    });
    return paymentRef;
  }

  /** A write: injected failures, then the idempotency key (same input = same result). */
  async function write<K extends PortOperation, T>(
    op: K,
    raw: unknown,
    apply: (x: PortInput<K>) => T,
  ): Promise<T> {
    await Promise.resolve();
    const x = checkPortInput(op, raw);
    takeFailure(op, false);
    const key = (x as { idempotencyKey: string }).idempotencyKey;
    const input = JSON.stringify(x);
    const prior = keys.get(key);
    if (prior !== undefined) {
      if (prior.op !== op || prior.input !== input) throw new PaymentsError('conflict');
      return structuredClone(prior.result) as T;
    }
    const result = apply(x);
    keys.set(key, { op, input, result });
    takeFailure(op, true);
    return structuredClone(result);
  }

  function live(s: SubState): SubState {
    if (s.status === 'ended') throw new PaymentsError('conflict');
    return s;
  }

  /** The prorated charge for moving to a dearer price now: the price gap times the time left. */
  function prorate(s: SubState, price: Money): void {
    const left = Math.max(0, s.periodEnd - nowMs()) / (s.periodEnd - s.periodStart);
    const amountMinor = Math.round((price.amountMinor - s.price.amountMinor) * left);
    if (amountMinor > 0) pay(s, { amountMinor, currency: price.currency });
  }

  function subscriptionBody(providerRef: string): Record<string, unknown> {
    const s = sub(providerRef);
    return {
      id: s.providerRef,
      status: words[s.status],
      custom_data: { subscription_id: s.subscriptionId, package_version_id: s.packageVersionId },
      current_period_end: iso(s.periodEnd),
      scheduled_change:
        s.scheduled === undefined
          ? null
          : {
              action: s.scheduled.change,
              effective_at: s.scheduled.at,
              ...(s.scheduled.packageVersionId === undefined
                ? {}
                : { package_version_id: s.scheduled.packageVersionId }),
            },
      // Buyer details a real provider sends; parseWebhook must drop them (ADR-0015 §6).
      customer: { email: `buyer-${s.providerRef}@example.test`, name: 'Test Buyer' },
    };
  }

  function sign(rawBody: Uint8Array, signOptions: FakeSignOptions = {}): Record<string, string> {
    const secret = signOptions.secret ?? (secrets[0] as Secret);
    if (style === 'body-only') return { [signatureHeader]: hmacSha256Hex(secret, rawBody) };
    const ts = Math.floor((signOptions.signedAt ?? options.now()).getTime() / 1000);
    return {
      [signatureHeader]: `ts=${ts};h1=${hmacSha256Hex(secret, concatBytes(`${ts}:`, rawBody))}`,
    };
  }

  function emitRaw(body: unknown, signOptions?: FakeSignOptions): SignedWebhook {
    const rawBody = new TextEncoder().encode(JSON.stringify(body));
    return { rawBody, headers: sign(rawBody, signOptions) };
  }

  function emitData(event: FakeEmit): { type: string; data: unknown } {
    switch (event.kind) {
      case 'subscription':
        return {
          type: event.providerType ?? 'subscription.updated',
          data: subscriptionBody(event.providerRef),
        };
      case 'payment_succeeded': {
        const p = payments.get(event.paymentRef);
        if (p === undefined) throw new PaymentsError('not_found');
        return {
          type: 'payment.succeeded',
          data: {
            id: p.paymentRef,
            subscription_ref: p.providerRef,
            custom_data: { subscription_id: p.subscriptionId },
            totals: {
              currency: p.amount.currency,
              amount: p.amount.amountMinor,
              tax: 0,
              fee: Math.floor((p.amount.amountMinor * FEE_PERCENT) / 100),
            },
          },
        };
      }
      case 'payment_failed': {
        const s = sub(event.providerRef);
        return {
          type: 'payment.failed',
          data: {
            id: nextRef('pay'),
            subscription_ref: s.providerRef,
            custom_data: { subscription_id: s.subscriptionId },
          },
        };
      }
      case 'refund': {
        const r = refunds.get(event.refundRef);
        if (r === undefined) throw new PaymentsError('not_found');
        return {
          type: 'refund.updated',
          data: {
            id: r.refundRef,
            payment_id: r.paymentRef,
            custom_data: {
              subscription_id: (payments.get(r.paymentRef) as PaymentState).subscriptionId,
            },
            amount: r.amount.amountMinor,
            currency: r.amount.currency,
            status: 'succeeded',
          },
        };
      }
      case 'other':
        return { type: event.providerType, data: {} };
    }
  }

  function verify(x: WebhookInput): void {
    const header = readHeader(x.headers, signatureHeader);
    if (header === undefined) throw new PaymentsError('invalid_signature');
    if (style === 'body-only') {
      if (!matchesAnySignature({ payload: x.rawBody, candidates: [header], secrets })) {
        throw new PaymentsError('invalid_signature');
      }
      return;
    }
    const parts = header.split(';').map((p) => p.split('='));
    const ts = parts.filter(([k]) => k === 'ts').map(([, v]) => v);
    const candidates = parts
      .filter(([k, v]) => k === 'h1' && v !== undefined)
      .map(([, v]) => v as string);
    const signedAt = ts.length === 1 ? (ts[0] as string) : '';
    if (
      !/^\d{1,12}$/.test(signedAt) ||
      !matchesAnySignature({ payload: concatBytes(`${signedAt}:`, x.rawBody), candidates, secrets })
    ) {
      throw new PaymentsError('invalid_signature');
    }
    checkSignedTimestamp({
      signedAtSeconds: Number(signedAt),
      receivedAt: x.receivedAt,
      ...(options.toleranceSeconds === undefined
        ? {}
        : { toleranceSeconds: options.toleranceSeconds }),
    });
  }

  function facts(type: string, data: unknown): PaymentFact[] {
    if (SUBSCRIPTION_TYPES.has(type)) {
      const d = parseOr(SubDataSchema, data);
      const status = statusOf.get(d.status);
      // An unknown provider status is never mapped to anything, least of all `active`.
      if (status === undefined) throw new PaymentsError('malformed_event');
      const scheduled = d.scheduled_change;
      return [
        {
          type: 'subscription',
          subscription: {
            provider,
            providerRef: d.id,
            subscriptionId: d.custom_data.subscription_id,
            status,
            packageVersionId: d.custom_data.package_version_id,
            periodEnd: d.current_period_end,
            ...(scheduled === null
              ? {}
              : {
                  scheduled: {
                    change: scheduled.action,
                    at: scheduled.effective_at,
                    ...(scheduled.package_version_id === undefined
                      ? {}
                      : { packageVersionId: scheduled.package_version_id }),
                  },
                }),
          },
        },
      ];
    }
    if (type === 'payment.succeeded') {
      const d = parseOr(PaidDataSchema, data);
      const money = (amountMinor: number): Money => ({ amountMinor, currency: d.totals.currency });
      return [
        {
          type: 'payment_succeeded',
          paymentRef: d.id,
          providerRef: d.subscription_ref,
          subscriptionId: d.custom_data.subscription_id,
          amount: money(d.totals.amount),
          tax: money(d.totals.tax),
          fee: money(d.totals.fee),
        },
      ];
    }
    if (type === 'payment.failed') {
      const d = parseOr(FailedDataSchema, data);
      return [
        {
          type: 'payment_failed',
          paymentRef: d.id,
          providerRef: d.subscription_ref,
          subscriptionId: d.custom_data.subscription_id,
        },
      ];
    }
    if (type === 'refund.updated') {
      const d = parseOr(RefundDataSchema, data);
      return [
        {
          type: 'refund',
          refundRef: d.id,
          paymentRef: d.payment_id,
          subscriptionId: d.custom_data.subscription_id,
          amount: { amountMinor: d.amount, currency: d.currency },
          status: d.status,
        },
      ];
    }
    return [];
  }

  const fake: FakePayments = {
    provider,
    signatureHeader,
    signsTimestamp: style === 'timestamped',

    startCheckout: (x) =>
      write('startCheckout', x, (c): CheckoutResult => {
        const checkoutRef = nextRef('chk');
        checkouts.set(checkoutRef, { subscriptionId: c.subscriptionId, offer: c.offer });
        return CheckoutResultSchema.parse({
          checkoutRef,
          url: `https://pay.example/${provider}/${checkoutRef}`,
        });
      }),

    changePlan: (x) =>
      write('changePlan', x, (c) => {
        const s = live(sub(c.providerRef));
        if (c.offer.price.currency !== s.price.currency) throw new PaymentsError('unsupported');
        if (c.when === 'period_end') {
          if (c.offer.packageVersionId !== s.packageVersionId || s.scheduled !== undefined) {
            s.scheduled = {
              change: 'plan',
              at: iso(s.periodEnd),
              packageVersionId: c.offer.packageVersionId,
              price: c.offer.price,
            };
          }
          return snapshot(s);
        }
        if (c.proration === 'prorate') prorate(s, c.offer.price);
        s.packageVersionId = c.offer.packageVersionId;
        s.price = c.offer.price;
        delete s.scheduled;
        return snapshot(s);
      }),

    pause: (x) =>
      write('pause', x, (c) => {
        const s = live(sub(c.providerRef));
        if (s.status === 'paused') return snapshot(s);
        if (c.when === 'now') {
          s.status = 'paused';
          delete s.scheduled;
        } else {
          s.scheduled = { change: 'pause', at: iso(s.periodEnd) };
        }
        return snapshot(s);
      }),

    resume: (x) =>
      write('resume', x, (c) => {
        const s = live(sub(c.providerRef));
        if (s.status !== 'paused') return snapshot(s);
        s.status = 'active';
        s.periodStart = nowMs();
        s.periodEnd = s.periodStart + PERIOD_MS;
        delete s.scheduled;
        pay(s, s.price);
        return snapshot(s);
      }),

    cancel: (x) =>
      write('cancel', x, (c) => {
        const s = sub(c.providerRef);
        if (s.status === 'ended') return snapshot(s);
        if (c.when === 'now') {
          s.status = 'ended';
          s.periodEnd = Math.min(s.periodEnd, nowMs());
          delete s.scheduled;
        } else {
          s.scheduled = { change: 'cancel', at: iso(s.periodEnd) };
        }
        return snapshot(s);
      }),

    clearScheduled: (x) =>
      write('clearScheduled', x, (c) => {
        // Nothing scheduled: the current snapshot, unchanged.
        const s = sub(c.providerRef);
        delete s.scheduled;
        return snapshot(s);
      }),

    async getSubscription(providerRef) {
      await Promise.resolve();
      const ref = checkPortInput('getSubscription', providerRef);
      takeFailure('getSubscription', false);
      return snapshot(sub(ref));
    },

    async refund(x): Promise<RefundResult> {
      await Promise.resolve();
      const c = checkPortInput('refund', x);
      takeFailure('refund', false);
      const p = payments.get(c.paymentRef);
      if (p === undefined) throw new PaymentsError('not_found');
      const asked = c.amount === undefined ? 'full' : JSON.stringify(c.amount);
      // ADR-0015 §3 refund safeguard: list this payment's refunds first and return the one with
      // the same key, so a retry after a timeout never refunds twice.
      const earlier = p.refunds.find((r) => r.key === c.idempotencyKey);
      if (earlier !== undefined) {
        if (earlier.asked !== asked) throw new PaymentsError('conflict');
        return RefundResultSchema.parse({ refundRef: earlier.refundRef, status: 'succeeded' });
      }
      if (keys.has(c.idempotencyKey)) throw new PaymentsError('conflict');
      const left = p.amount.amountMinor - p.refunds.reduce((n, r) => n + r.amount.amountMinor, 0);
      // Amount omitted = a full refund: exactly what is left on the payment.
      const amountMinor = c.amount === undefined ? left : c.amount.amountMinor;
      if (c.amount !== undefined && c.amount.currency !== p.amount.currency) {
        throw new PaymentsError('validation');
      }
      if (left === 0) throw new PaymentsError('conflict');
      if (amountMinor > left) throw new PaymentsError('validation');
      const refund: RefundState = {
        refundRef: nextRef('re'),
        key: c.idempotencyKey,
        asked,
        amount: { amountMinor, currency: p.amount.currency },
      };
      p.refunds.push(refund);
      refunds.set(refund.refundRef, { ...refund, paymentRef: p.paymentRef });
      keys.set(c.idempotencyKey, { op: 'refund', input: JSON.stringify(c), result: undefined });
      const result = RefundResultSchema.parse({ refundRef: refund.refundRef, status: 'succeeded' });
      takeFailure('refund', true);
      return result;
    },

    async parseWebhook(x): Promise<PaymentEvent> {
      await Promise.resolve();
      checkWebhookInput(x);
      // The signature over the exact bytes comes first; nothing is parsed before it passes.
      verify(x);
      const envelope = parseOr(EnvelopeSchema, parseJsonBody(x.rawBody));
      const event = PaymentEventSchema.safeParse({
        provider,
        eventId: envelope.event_id,
        providerType: envelope.event_type,
        occurredAt: envelope.occurred_at,
        facts: facts(envelope.event_type, envelope.data),
      });
      if (!event.success) throw new PaymentsError('malformed_event');
      return event.data;
    },

    completeCheckout(checkoutRef, completeOptions = {}) {
      const checkout = checkouts.get(checkoutRef);
      if (checkout === undefined) throw new PaymentsError('not_found');
      if (checkout.providerRef !== undefined) {
        return {
          providerRef: checkout.providerRef,
          ...(checkout.paymentRef === undefined ? {} : { paymentRef: checkout.paymentRef }),
        };
      }
      const trial = completeOptions.trial ?? false;
      const start = nowMs();
      const s: SubState = {
        providerRef: nextRef('sub'),
        subscriptionId: checkout.subscriptionId,
        packageVersionId: checkout.offer.packageVersionId,
        price: checkout.offer.price,
        status: trial ? 'trial' : 'active',
        periodStart: start,
        periodEnd:
          start + (trial ? (checkout.offer.trialDays ?? DEFAULT_TRIAL_DAYS) * DAY_MS : PERIOD_MS),
      };
      subs.set(s.providerRef, s);
      checkout.providerRef = s.providerRef;
      if (!trial) checkout.paymentRef = pay(s, s.price);
      return completeOptions.trial === true
        ? { providerRef: s.providerRef }
        : { providerRef: s.providerRef, paymentRef: checkout.paymentRef as string };
    },

    charge(providerRef) {
      const s = live(sub(providerRef));
      return pay(s, s.price);
    },

    scheduleResume(providerRef, at) {
      const s = sub(providerRef);
      if (s.status !== 'paused') throw new PaymentsError('conflict');
      s.scheduled = { change: 'resume', at };
    },

    failNext(op, failure) {
      failures.set(op, [...(failures.get(op) ?? []), failure]);
    },

    charges(providerRef) {
      return [...payments.values()]
        .filter((p) => p.providerRef === providerRef)
        .map((p) => ({ ...p.amount }));
    },

    emit(event, signOptions) {
      const { type, data } = emitData(event);
      return emitRaw(
        {
          event_id: nextRef('evt'),
          event_type: type,
          occurred_at: options.now().toISOString(),
          data,
        },
        signOptions,
      );
    },

    emitRaw,
    sign,
    subscriptionBody,
  };
  return fake;
}
