// Data model rows: subscriptions; payments / ledger_entries / payouts / invoices; webhook_events.
// Money is integer minor units (bigint) plus an ISO 4217 currency; one currency per row.
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  check,
  index,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { ledgerDirection, id, subscriptionStatus, timestamps, tstz } from './_shared.js';
import { packageVersions } from './agents.js';
import { studentId, teacherId, users } from './users.js';

const amountMinor = () => bigint('amount_minor', { mode: 'number' }).notNull();
const currency = () => text('currency').notNull();
const currencyCheck = (name: string, col: AnyPgColumn) => check(name, sql`${col} ~ '^[A-Z]{3}$'`);

/** One live (not ended) subscription per student x teacher. */
export const subscriptions = pgTable(
  'subscriptions',
  {
    id: id(),
    studentId: studentId(),
    teacherId: teacherId(),
    packageVersionId: text('package_version_id')
      .notNull()
      .references(() => packageVersions.id),
    status: subscriptionStatus('status').notNull(),
    periodEnd: tstz('period_end').notNull(),
    providerRef: text('provider_ref'),
    ...timestamps(),
  },
  (t) => [
    index('subscriptions_teacher_id_student_id_idx').on(t.teacherId, t.studentId),
    index('subscriptions_student_id_idx').on(t.studentId),
    index('subscriptions_package_version_id_idx').on(t.packageVersionId),
    uniqueIndex('subscriptions_one_live_per_pair_key')
      .on(t.studentId, t.teacherId)
      .where(sql`${t.status} <> 'ended'`),
    uniqueIndex('subscriptions_provider_ref_key').on(t.providerRef),
  ],
);

export const payments = pgTable(
  'payments',
  {
    id: id(),
    teacherId: teacherId(),
    studentId: studentId(),
    subscriptionId: text('subscription_id').references(() => subscriptions.id),
    amountMinor: amountMinor(),
    currency: currency(),
    market: text('market').notNull(),
    provider: text('provider').notNull(),
    providerRef: text('provider_ref'),
    status: text('status').notNull(),
    ...timestamps(),
  },
  (t) => [
    index('payments_teacher_id_idx').on(t.teacherId),
    index('payments_student_id_idx').on(t.studentId),
    index('payments_subscription_id_idx').on(t.subscriptionId),
    uniqueIndex('payments_provider_provider_ref_key').on(t.provider, t.providerRef),
    check('payments_amount_minor_check', sql`${t.amountMinor} >= 0`),
    currencyCheck('payments_currency_check', t.currency),
  ],
);

export const payouts = pgTable(
  'payouts',
  {
    id: id(),
    teacherId: teacherId(),
    amountMinor: amountMinor(),
    currency: currency(),
    market: text('market').notNull(),
    provider: text('provider').notNull(),
    providerRef: text('provider_ref'),
    status: text('status').notNull(),
    periodStart: tstz('period_start').notNull(),
    periodEnd: tstz('period_end').notNull(),
    ...timestamps(),
  },
  (t) => [
    index('payouts_teacher_id_idx').on(t.teacherId),
    uniqueIndex('payouts_provider_provider_ref_key').on(t.provider, t.providerRef),
    check('payouts_amount_minor_check', sql`${t.amountMinor} >= 0`),
    currencyCheck('payouts_currency_check', t.currency),
  ],
);

/**
 * Double-entry ledger: every money movement is a `transaction_id` whose debit and credit entries
 * sum to the same amount in one currency. `teacher_id` is null for platform and provider accounts.
 */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: id(),
    transactionId: text('transaction_id').notNull(),
    account: text('account').notNull(),
    direction: ledgerDirection('direction').notNull(),
    teacherId: text('teacher_id').references(() => users.id),
    paymentId: text('payment_id').references(() => payments.id),
    payoutId: text('payout_id').references(() => payouts.id),
    amountMinor: amountMinor(),
    currency: currency(),
    market: text('market').notNull(),
    ...timestamps(),
  },
  (t) => [
    index('ledger_entries_teacher_id_idx').on(t.teacherId),
    index('ledger_entries_transaction_id_idx').on(t.transactionId),
    index('ledger_entries_account_idx').on(t.account),
    index('ledger_entries_payment_id_idx').on(t.paymentId),
    index('ledger_entries_payout_id_idx').on(t.payoutId),
    check('ledger_entries_amount_minor_check', sql`${t.amountMinor} > 0`),
    currencyCheck('ledger_entries_currency_check', t.currency),
  ],
);

export const invoices = pgTable(
  'invoices',
  {
    id: id(),
    teacherId: teacherId(),
    studentId: studentId(),
    paymentId: text('payment_id').references(() => payments.id),
    number: text('number').notNull(),
    amountMinor: amountMinor(),
    currency: currency(),
    market: text('market').notNull(),
    provider: text('provider').notNull(),
    providerRef: text('provider_ref'),
    issuedAt: tstz('issued_at').notNull(),
    ...timestamps(),
  },
  (t) => [
    index('invoices_teacher_id_idx').on(t.teacherId),
    index('invoices_student_id_idx').on(t.studentId),
    index('invoices_payment_id_idx').on(t.paymentId),
    uniqueIndex('invoices_number_key').on(t.number),
    uniqueIndex('invoices_provider_provider_ref_key').on(t.provider, t.providerRef),
    check('invoices_amount_minor_check', sql`${t.amountMinor} >= 0`),
    currencyCheck('invoices_currency_check', t.currency),
  ],
);

/** Idempotency: a provider event is processed at most once. */
export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: id(),
    provider: text('provider').notNull(),
    providerEventId: text('provider_event_id').notNull(),
    payloadHash: text('payload_hash').notNull(),
    processedAt: tstz('processed_at'),
    ...timestamps(),
  },
  (t) => [uniqueIndex('webhook_events_provider_event_id_key').on(t.providerEventId)],
);
