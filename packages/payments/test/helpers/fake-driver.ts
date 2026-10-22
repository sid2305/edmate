// Wires the fake adapter into the shared contract suite: a moving clock, runtime-built secrets
// and the scenario driver.
import { Secret } from '../../src/secret.js';
import {
  createFakePayments,
  type FakePayments,
  type FakePaymentsOptions,
} from '../../src/testing/index.js';
import type { ContractSetup } from '../contract/suite.js';
import { fakeSecret } from './fake-secret.js';

export const START = Date.parse('2026-10-22T10:00:00.000Z');

export interface FakeSetup extends ContractSetup {
  payments: FakePayments;
  clock: { ms: number };
}

export function fakeSetup(
  options: Omit<FakePaymentsOptions, 'webhookSecrets' | 'now'> = {},
): FakeSetup {
  const clock = { ms: START };
  const current = fakeSecret();
  const previous = fakeSecret();
  const payments = createFakePayments({
    ...options,
    // Rotation: the fake signs with the first and accepts both.
    webhookSecrets: [Secret.of(current), Secret.of(previous)],
    now: () => new Date(clock.ms),
  });
  const at = (skewSeconds = 0) => ({ signedAt: new Date(clock.ms + skewSeconds * 1000) });
  return {
    payments,
    clock,
    receivedAt: () => new Date(clock.ms).toISOString(),
    secretValues: [current, previous],
    driver: {
      completeCheckout: (checkoutRef, o) =>
        Promise.resolve(payments.completeCheckout(checkoutRef, o)),
      charges: (providerRef) => Promise.resolve(payments.charges(providerRef)),
      delivery(event, o = {}) {
        const sign = {
          ...at(o.skewSeconds),
          ...(o.foreignSecret === true ? { secret: Secret.of(fakeSecret()) } : {}),
        };
        switch (event.kind) {
          case 'checkout_completed':
            return Promise.resolve(
              payments.emit(
                {
                  kind: 'subscription',
                  providerRef: event.providerRef,
                  providerType: 'checkout.completed',
                },
                sign,
              ),
            );
          case 'unused':
            return Promise.resolve(
              payments.emit({ kind: 'other', providerType: 'customer.updated' }, sign),
            );
          default:
            return Promise.resolve(payments.emit(event, sign));
        }
      },
      malformed(kind, providerRef) {
        if (kind === 'bad_json') {
          const rawBody = new TextEncoder().encode('{"event_id":"evt_1",');
          return Promise.resolve({ rawBody, headers: payments.sign(rawBody) });
        }
        const data = payments.subscriptionBody(providerRef);
        if (kind === 'unknown_status') data.status = 'mystery_state';
        else data.custom_data = { package_version_id: 'pkv_basic' };
        return Promise.resolve(
          payments.emitRaw({
            event_id: 'evt_bad_1',
            event_type: 'subscription.updated',
            occurred_at: new Date(clock.ms).toISOString(),
            data,
          }),
        );
      },
      scheduleResume(providerRef) {
        payments.scheduleResume(providerRef, new Date(clock.ms + 86_400_000).toISOString());
        return Promise.resolve();
      },
      timeoutAfterApply(op) {
        payments.failNext(op, { code: 'provider_error', retryable: true, afterApply: true });
      },
    },
  };
}
