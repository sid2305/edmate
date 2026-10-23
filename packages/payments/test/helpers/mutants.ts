// Deliberately broken adapters, each a thin wrapper around the fake, used to prove the shared
// contract suite catches them (10.1b review MEDIUM), plus a correct wrapper that can't do some
// operations natively and throws `unsupported` for them (ADR-0015 §3, §4).
import type { Payments } from '@edmate/contracts';
import { isPaymentsError, PaymentsError } from '../../src/errors.js';
import { checkPortInput, type PortOperation } from '../../src/input.js';
import type { Secret } from '../../src/secret.js';
import type { FakePayments } from '../../src/testing/index.js';
import { checkSignedTimestamp } from '../../src/webhook/hmac.js';
import type { SignedDelivery, UnsupportedOperation } from '../contract/suite.js';
import { fakeSetup, type FakeSetup } from './fake-driver.js';

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);
const text = (b: Uint8Array): string => new TextDecoder().decode(b);

/** A Payments that forwards every call to `inner`, except the ones in `over`. */
function forward(inner: Payments, over: Partial<Payments>): Payments {
  return {
    provider: inner.provider,
    startCheckout: (x) => inner.startCheckout(x),
    changePlan: (x) => inner.changePlan(x),
    pause: (x) => inner.pause(x),
    resume: (x) => inner.resume(x),
    cancel: (x) => inner.cancel(x),
    clearScheduled: (x) => inner.clearScheduled(x),
    getSubscription: (x) => inner.getSubscription(x),
    refund: (x) => inner.refund(x),
    parseWebhook: (x) => inner.parseWebhook(x),
    ...over,
  };
}

function withPayments(base: FakeSetup, payments: Payments): FakeSetup {
  return { ...base, payments: payments as FakePayments };
}

/** The signed time in a timestamped fake header, so a re-signed delivery keeps its age. */
function signedAtOf(fake: FakePayments, headers: Readonly<Record<string, string>>): Date {
  const ts = /ts=(\d+)/.exec(headers[fake.signatureHeader] ?? '')?.[1];
  return ts === undefined ? new Date(Date.now()) : new Date(Number(ts) * 1000);
}

/**
 * A correct adapter for a provider that can't do the listed operations natively: after the
 * shared input check it throws `unsupported` for them and never emulates them.
 */
export function unsupportedSetup(ops: readonly UnsupportedOperation[]): FakeSetup {
  const base = fakeSetup();
  const inner = base.payments;
  const refuse = (op: UnsupportedOperation): void => {
    if (ops.includes(op)) throw new PaymentsError('unsupported');
  };
  return withPayments(
    base,
    forward(inner, {
      async changePlan(x) {
        const c = checkPortInput('changePlan', x);
        if (c.when === 'period_end') refuse('changePlan.period_end');
        else if (c.proration === 'none') refuse('changePlan.proration_none');
        return inner.changePlan(x);
      },
      async pause(x) {
        if (checkPortInput('pause', x).when === 'period_end') refuse('pause.period_end');
        return inner.pause(x);
      },
      async cancel(x) {
        if (checkPortInput('cancel', x).when === 'period_end') refuse('cancel.period_end');
        return inner.cancel(x);
      },
      async refund(x) {
        checkPortInput('refund', x);
        refuse('refund');
        return inner.refund(x);
      },
    }),
  );
}

/**
 * The same setup, with every port promise marked handled. A mutant fails some cases on purpose
 * (`it.fails`); the calls such a case still had in flight when its assertion threw would
 * otherwise reject unhandled. Each caller that awaits still sees the rejection.
 */
export function quiet<S extends { payments: Payments }>(setup: () => S): () => S {
  return () => {
    const base = setup();
    const p = base.payments;
    const h = <T>(r: Promise<T>): Promise<T> => {
      r.catch(() => undefined);
      return r;
    };
    return {
      ...base,
      payments: forward(p, {
        startCheckout: (x) => h(p.startCheckout(x)),
        changePlan: (x) => h(p.changePlan(x)),
        pause: (x) => h(p.pause(x)),
        resume: (x) => h(p.resume(x)),
        cancel: (x) => h(p.cancel(x)),
        clearScheduled: (x) => h(p.clearScheduled(x)),
        getSubscription: (x) => h(p.getSubscription(x)),
        refund: (x) => h(p.refund(x)),
        parseWebhook: (x) => h(p.parseWebhook(x)),
      }),
    };
  };
}

const KNOWN_WORDS = new Set(['trialing', 'active', 'past_due', 'paused', 'canceled']);

/** (a) An unknown provider status is mapped to `active` instead of `malformed_event`. */
export function unknownStatusActive(): FakeSetup {
  const base = fakeSetup();
  const fake = base.payments;
  return withPayments(
    base,
    forward(fake, {
      async parseWebhook(x) {
        try {
          return await fake.parseWebhook(x);
        } catch (err) {
          if (!isPaymentsError(err, 'malformed_event')) throw err;
          let body: { data?: { status?: unknown } };
          try {
            body = JSON.parse(text(x.rawBody)) as typeof body;
          } catch {
            throw err;
          }
          // Only the broken rule: a status word the fake does not know becomes `active`.
          const status = body.data?.status;
          if (typeof status !== 'string' || KNOWN_WORDS.has(status) || body.data === undefined) {
            throw err;
          }
          body.data.status = 'active';
          const rawBody = bytes(JSON.stringify(body));
          const headers = fake.sign(rawBody, { signedAt: signedAtOf(fake, x.headers) });
          return fake.parseWebhook({ ...x, rawBody, headers });
        }
      },
    }),
  );
}

/** Wraps every listed write so each call reaches the provider under a brand-new key. */
function freshKeys(ops: readonly PortOperation[]): FakeSetup {
  const base = fakeSetup();
  const fake = base.payments;
  let n = 0;
  const fresh = <T extends { idempotencyKey: string }>(op: PortOperation, x: T): T => {
    checkPortInput(op, x);
    return ops.includes(op) ? { ...x, idempotencyKey: `${x.idempotencyKey.slice(0, 100)}-m${(n += 1)}` } : x;
  };
  return withPayments(
    base,
    forward(fake, {
      startCheckout: async (x) => fake.startCheckout(fresh('startCheckout', x)),
      changePlan: async (x) => fake.changePlan(fresh('changePlan', x)),
      pause: async (x) => fake.pause(fresh('pause', x)),
      resume: async (x) => fake.resume(fresh('resume', x)),
      cancel: async (x) => fake.cancel(fresh('cancel', x)),
      clearScheduled: async (x) => fake.clearScheduled(fresh('clearScheduled', x)),
      refund: async (x) => fake.refund(fresh('refund', x)),
    }),
  );
}

/** (b) A reused idempotency key is not honoured: every write is sent as new. */
export const keyNotHonoured = (): FakeSetup =>
  freshKeys(['startCheckout', 'changePlan', 'pause', 'resume', 'cancel', 'clearScheduled']);

/** (c) A refund retry is sent as a new refund (no refund safeguard): a double refund. */
export const doubleRefund = (): FakeSetup => freshKeys(['refund']);

/** (d) The signature check is skipped: every delivery is treated as correctly signed. */
export function signatureSkipped(): FakeSetup {
  const base = fakeSetup();
  const fake = base.payments;
  return withPayments(
    base,
    forward(fake, {
      parseWebhook: async (x) =>
        fake.parseWebhook({
          ...x,
          headers: fake.sign(x.rawBody, { signedAt: signedAtOf(fake, x.headers) }),
        }),
    }),
  );
}

/**
 * (e) The timestamp is not signed: the HMAC covers the body only (a body-only fake), and the
 * timestamp travels in its own `x-ts` header, checked for age but bound to nothing.
 */
export function timestampNotSigned(): FakeSetup {
  const base = fakeSetup({ signatureStyle: 'body-only' });
  const fake = base.payments;
  const stamp = (d: SignedDelivery, skewSeconds = 0): SignedDelivery => ({
    rawBody: d.rawBody,
    headers: { ...d.headers, 'x-ts': String(Math.floor(base.clock.ms / 1000) + skewSeconds) },
  });
  return {
    ...withPayments(
      base,
      forward(fake, {
        async parseWebhook(x) {
          const { 'x-ts': ts, ...headers } = x.headers;
          if (ts === undefined || !/^\d+$/.test(ts)) throw new PaymentsError('invalid_signature');
          checkSignedTimestamp({ signedAtSeconds: Number(ts), receivedAt: x.receivedAt });
          return fake.parseWebhook({ ...x, headers });
        },
      }),
    ),
    driver: {
      ...base.driver,
      async delivery(event, o = {}) {
        const d = await base.driver.delivery(
          event,
          o.foreignSecret === true ? { foreignSecret: true } : {},
        );
        return stamp(d, o.restamp?.headerSkewSeconds ?? o.skewSeconds);
      },
      signed: async (rawBody, o) => stamp(await base.driver.signed(rawBody, o)),
      malformed: async (kind, ref) => stamp(await base.driver.malformed(kind, ref)),
    },
  };
}

/** (f) The JSON is re-serialised before the signature check, so the exact bytes are lost. */
export function reserialisedJson(): FakeSetup {
  const base = fakeSetup();
  const fake = base.payments;
  return withPayments(
    base,
    forward(fake, {
      async parseWebhook(x) {
        let rawBody = x.rawBody;
        try {
          rawBody = bytes(JSON.stringify(JSON.parse(text(x.rawBody))));
        } catch {
          // Not JSON: verify the bytes as they came.
        }
        return fake.parseWebhook({ ...x, rawBody });
      },
    }),
  );
}

/** (g) An empty webhook secret is accepted next to the configured ones. */
export function emptySecretAccepted(): FakeSetup {
  const base = fakeSetup();
  const fake = base.payments;
  const empty = { reveal: () => '' } as unknown as Secret;
  return withPayments(
    base,
    forward(fake, {
      async parseWebhook(x) {
        try {
          return await fake.parseWebhook(x);
        } catch (err) {
          if (!isPaymentsError(err, 'invalid_signature')) throw err;
          const signedAt = signedAtOf(fake, x.headers);
          const underEmpty = fake.sign(x.rawBody, { secret: empty, signedAt });
          const header = fake.signatureHeader;
          if (x.headers[header] !== underEmpty[header]) throw err;
          return fake.parseWebhook({ ...x, headers: fake.sign(x.rawBody, { signedAt }) });
        }
      },
    }),
  );
}
