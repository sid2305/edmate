// The one input check every adapter calls first (ADR-0015 §3, §6, §9; 10.1a review LOW). It
// parses a port call's input with the contracts helper schemas, so every adapter refuses the same
// things the same way: a malformed idempotency key, a non-https return URL, an invalid offer or
// ref, a refund amount of zero, or an unknown key. Any failure is `validation`, with fixed words.
import {
  CheckoutResultSchema,
  IdempotencyKeySchema,
  MoneySchema,
  PaymentOfferSchema,
  ProviderRefSchema,
  ProviderSubscriptionSchema,
} from '@edmate/contracts';
import { z } from 'zod';
import { PaymentsError } from './errors.js';

/** https only: the same rule as the checkout URL a provider returns. Built server-side from config. */
const ReturnUrlSchema = CheckoutResultSchema.shape.url;
const SubscriptionIdSchema = ProviderSubscriptionSchema.shape.subscriptionId;

const write = { providerRef: ProviderRefSchema, idempotencyKey: IdempotencyKeySchema };
const when = z.enum(['now', 'period_end']);

export const PortInputSchemas = {
  startCheckout: z.strictObject({
    subscriptionId: SubscriptionIdSchema,
    offer: PaymentOfferSchema,
    returnUrl: ReturnUrlSchema,
    idempotencyKey: IdempotencyKeySchema,
  }),
  changePlan: z.discriminatedUnion('when', [
    z.strictObject({
      ...write,
      offer: PaymentOfferSchema,
      when: z.literal('now'),
      proration: z.enum(['prorate', 'none']),
    }),
    z.strictObject({ ...write, offer: PaymentOfferSchema, when: z.literal('period_end') }),
  ]),
  pause: z.strictObject({ ...write, when }),
  resume: z.strictObject(write),
  cancel: z.strictObject({ ...write, when }),
  clearScheduled: z.strictObject(write),
  getSubscription: ProviderRefSchema,
  refund: z.strictObject({
    paymentRef: ProviderRefSchema,
    /** Omitted = a full refund of what is left on the payment. Present as undefined: validation. */
    amount: MoneySchema.refine((m) => m.amountMinor > 0).exactOptional(),
    idempotencyKey: IdempotencyKeySchema,
  }),
} as const;

export type PortOperation = keyof typeof PortInputSchemas;
export type PortInput<K extends PortOperation> = z.infer<(typeof PortInputSchemas)[K]>;

/** Parses a port call's input; throws `validation` (never the zod issues, which echo input). */
export function checkPortInput<K extends PortOperation>(op: K, input: unknown): PortInput<K> {
  const parsed = PortInputSchemas[op].safeParse(input);
  if (!parsed.success) throw new PaymentsError('validation');
  return parsed.data as PortInput<K>;
}
