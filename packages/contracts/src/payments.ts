// Payments data (ADR-0015). These cross process boundaries (webhook route -> worker queue in 10.2),
// so they are strict Zod schemas. The `Payments` port itself is type-only, in ports.ts.
import { z } from 'zod';
import { EntitlementSchema } from './access.js';
import { httpsUrl, id, timestamp } from './formats.js';
import { countChars } from './limits.js';
import { MoneySchema } from './shared.js';

/** Caps from ADR-0015. */
export const PAYMENT_LIMITS = {
  /** PaymentOffer.name: 1 to 120 characters (code points), one line. */
  offerNameMaxChars: 120,
  /** PaymentOffer.trialDays: 1 to 90. */
  trialDaysMin: 1,
  trialDaysMax: 90,
  /** PaymentEvent.providerType: 1 to 64 characters. */
  providerTypeMaxLength: 64,
  /** PaymentEvent.facts: at most 4 per delivery. */
  factsMax: 4,
} as const;

/** The placeholder a locale pack uses before a provider is wired; it never names an adapter. */
const UNWIRED_PROVIDER = 'tbd';

/** Equals LocalePack.payments.provider: lower-case, 2 to 32 characters; never `tbd`. */
const providerId = () =>
  z
    .string()
    .regex(/^[a-z][a-z0-9_-]{1,31}$/, 'lower-case provider id, 2 to 32 characters')
    .refine((p) => p !== UNWIRED_PROVIDER, '"tbd" never names a provider');
/**
 * Helper schemas (ADR-0015 §3, §9): exported for the adapters, the fake and the shared contract
 * suite to parse port inputs and outputs. Not in the fixture registry, so the count stays 39.
 */

/** A write's idempotency key: built from Edmate ids, never personal data. */
export const IdempotencyKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,128}$/, 'letters, digits, _ or -, 8 to 128 characters');

/**
 * A provider's own id for a subscription, payment, refund, checkout or event. At least one letter
 * or digit, so a dot-only value ('.', '..') can never become a URL path segment.
 */
export const ProviderRefSchema = z
  .string()
  .regex(
    /^(?=.*[A-Za-z0-9])[A-Za-z0-9_.:-]{1,128}$/,
    'letters, digits, _ . : or -, 1 to 128 characters, at least one letter or digit',
  );
const providerRef = () => ProviderRefSchema;

/** What `startCheckout` returns: the provider's hosted https page. */
export const CheckoutResultSchema = z.strictObject({
  checkoutRef: ProviderRefSchema,
  url: httpsUrl(),
  providerRef: ProviderRefSchema.exactOptional(),
});
export type CheckoutResult = z.infer<typeof CheckoutResultSchema>;

/** What `refund` returns. */
export const RefundResultSchema = z.strictObject({
  refundRef: ProviderRefSchema,
  status: z.enum(['pending', 'succeeded']),
});
export type RefundResult = z.infer<typeof RefundResultSchema>;

/**
 * Control, format (bidi, zero-width, BOM, so also the ZWJ inside emoji sequences), line and
 * paragraph separator characters, lone surrogates, private-use characters and the Hangul fillers
 * (U+115F, U+1160, U+3164, U+FFA0) that render as blanks.
 */
const NOT_ONE_LINE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}\p{Co}\u115F\u1160\u3164\uFFA0]/u;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

export type ProviderId = string;
export type ProviderRef = z.infer<typeof ProviderRefSchema>;

/** Built server-side from the package version; never from the client. */
export const PaymentOfferSchema = z.strictObject({
  packageVersionId: id(),
  name: z
    .string()
    .refine((n) => !NOT_ONE_LINE.test(n), 'one line: no control, format or separator characters')
    .refine((n) => LETTER_OR_DIGIT.test(n), 'at least one letter or digit')
    .refine(
      (n) => countChars(n) <= PAYMENT_LIMITS.offerNameMaxChars,
      `at most ${PAYMENT_LIMITS.offerNameMaxChars} characters`,
    ),
  price: MoneySchema.refine((m) => m.amountMinor > 0, {
    message: 'a paid offer: amountMinor > 0',
    path: ['amountMinor'],
  }),
  interval: z.literal('month'),
  trialDays: z
    .int()
    .min(PAYMENT_LIMITS.trialDaysMin)
    .max(PAYMENT_LIMITS.trialDaysMax)
    .exactOptional(),
});
export type PaymentOffer = z.infer<typeof PaymentOfferSchema>;

const ScheduledSchema = z
  .strictObject({
    change: z.enum(['plan', 'cancel', 'pause', 'resume']),
    at: timestamp(),
    packageVersionId: id().exactOptional(),
  })
  .superRefine((s, ctx) => {
    // packageVersionId is present exactly when change = 'plan'.
    if (s.change === 'plan' && s.packageVersionId === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['packageVersionId'],
        message: 'required when change is "plan"',
      });
    }
    if (s.change !== 'plan' && s.packageVersionId !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['packageVersionId'],
        message: 'only allowed when change is "plan"',
      });
    }
  });

/** The provider's view; 10.3's state machine decides the entitlement. */
export const ProviderSubscriptionSchema = z.strictObject({
  provider: providerId(),
  providerRef: providerRef(),
  /** Edmate's subscriptions.id, carried as provider metadata; required. */
  subscriptionId: id(),
  /** The same enum as Entitlement.status, by reference. */
  status: EntitlementSchema.shape.status,
  packageVersionId: id(),
  /** Trial end in trial; end of the last paid period when paused or ended. */
  periodEnd: timestamp(),
  scheduled: ScheduledSchema.exactOptional(),
});
export type ProviderSubscription = z.infer<typeof ProviderSubscriptionSchema>;

const PaymentSucceededSchema = z
  .strictObject({
    type: z.literal('payment_succeeded'),
    paymentRef: providerRef(),
    providerRef: providerRef(),
    subscriptionId: id(),
    amount: MoneySchema,
    tax: MoneySchema,
    fee: MoneySchema,
    /** May be in the payout currency. */
    net: MoneySchema.exactOptional(),
  })
  .superRefine((p, ctx) => {
    for (const key of ['tax', 'fee'] as const) {
      if (p[key].currency !== p.amount.currency) {
        ctx.addIssue({
          code: 'custom',
          path: [key, 'currency'],
          message: 'must equal the amount currency',
        });
      } else if (p[key].amountMinor > p.amount.amountMinor) {
        ctx.addIssue({
          code: 'custom',
          path: [key, 'amountMinor'],
          message: 'must not exceed the amount',
        });
      }
    }
  });

/** One fact in a delivery; exported so 10.2's worker can parse a single queued fact. */
export const PaymentFactSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('subscription'), subscription: ProviderSubscriptionSchema }),
  PaymentSucceededSchema,
  z.strictObject({
    type: z.literal('payment_failed'),
    paymentRef: providerRef(),
    providerRef: providerRef(),
    subscriptionId: id(),
  }),
  z.strictObject({
    type: z.literal('refund'),
    refundRef: providerRef(),
    paymentRef: providerRef(),
    subscriptionId: id(),
    amount: MoneySchema.refine((m) => m.amountMinor > 0, {
      message: 'a refund: amountMinor > 0',
      path: ['amountMinor'],
    }),
    status: z.enum(['pending', 'succeeded', 'failed']),
  }),
]);
export type PaymentFact = z.infer<typeof PaymentFactSchema>;

/** One verified webhook delivery; (provider, eventId) is 10.2's idempotency key. */
export const PaymentEventSchema = z
  .strictObject({
    provider: providerId(),
    eventId: providerRef(),
    /** The provider's event name; never payload text, so a narrow charset. */
    providerType: z
      .string()
      .regex(
        new RegExp(`^[A-Za-z0-9_.:-]{1,${PAYMENT_LIMITS.providerTypeMaxLength}}$`),
        `an event name: letters, digits, _ . : or -, 1 to ${PAYMENT_LIMITS.providerTypeMaxLength} characters`,
      ),
    occurredAt: timestamp(),
    /** Empty = verified, but nothing Edmate uses. */
    facts: z.array(PaymentFactSchema).max(PAYMENT_LIMITS.factsMax),
  })
  .superRefine((e, ctx) => {
    // A snapshot from another provider in this delivery is a mapping bug: fail closed.
    e.facts.forEach((f, i) => {
      if (f.type === 'subscription' && f.subscription.provider !== e.provider) {
        ctx.addIssue({
          code: 'custom',
          path: ['facts', i, 'subscription', 'provider'],
          message: 'must equal the event provider',
        });
      }
    });
  });
export type PaymentEvent = z.infer<typeof PaymentEventSchema>;
