// The shared contract suite catches broken adapters (10.1b review MEDIUM). Each mutant is the fake
// with one ADR-0015 rule broken; the cases listed must fail (they run as `it.fails`), and every
// other case must still pass. A correct adapter that can't do some operations natively passes
// the suite by throwing `unsupported` for them.
import type { ContractSuiteOptions } from './contract/suite.js';
import { describePaymentsContract } from './contract/suite.js';
import {
  doubleRefund,
  emptySecretAccepted,
  keyNotHonoured,
  quiet,
  reserialisedJson,
  signatureSkipped,
  timestampNotSigned,
  unknownStatusActive,
  unsupportedSetup,
} from './helpers/mutants.js';

const timestamped = { signsTimestamp: true, scheduledResume: true };

describePaymentsContract({
  name: 'fake that cannot pause at period end (declared unsupported)',
  setup: () => unsupportedSetup(['pause.period_end']),
  capabilities: { ...timestamped, unsupported: ['pause.period_end'] },
});

const ALL = [
  'changePlan.period_end',
  'changePlan.proration_none',
  'pause.period_end',
  'cancel.period_end',
  'refund',
] as const;
describePaymentsContract({
  name: 'fake with every optional operation unsupported',
  setup: () => unsupportedSetup(ALL),
  capabilities: { ...timestamped, unsupported: ALL },
});

const LEAK = 'no key or secret fragment reaches any output or error';
const SAME_KEY = 'the same key with different input is a conflict on every write';
const OTHER_BYTES = 'refuses the same JSON value in other bytes than were signed';
const RESTAMPED = 'refuses a delivery whose signed timestamp was rewritten, signature unchanged';
const EMPTY_SECRET = 'refuses a delivery signed with an empty secret';

const mutants: Omit<ContractSuiteOptions, 'capabilities'>[] = [
  {
    name: 'mutant (a): unknown provider status mapped to active',
    setup: unknownStatusActive,
    expectFailing: ['a signed body with unknown_status is malformed_event, never active', LEAK],
  },
  {
    name: 'mutant (b): a reused idempotency key is not honoured',
    setup: keyNotHonoured,
    expectFailing: ['returns the hosted https page, and the same result for the same key', SAME_KEY],
  },
  {
    name: 'mutant (c): a refund retry refunds twice',
    setup: doubleRefund,
    expectFailing: [
      'refund: the retry returns the first refund and nothing is refunded twice',
      'full refund (amount omitted): the retry returns the same refund, paid out once',
      'same key returns the same refund; a different amount under it is a conflict; too much is validation',
      SAME_KEY,
    ],
  },
  {
    name: 'mutant (d): the signature check is skipped',
    setup: signatureSkipped,
    expectFailing: [
      'refuses a missing header, a bad signature and a tampered body',
      EMPTY_SECRET,
      OTHER_BYTES,
      RESTAMPED,
      'a body with unknown_status signed with a foreign secret is invalid_signature (signature first)',
      'a body with missing_subscription_id signed with a foreign secret is invalid_signature (signature first)',
      LEAK,
    ],
  },
  {
    name: 'mutant (e): the timestamp is not signed',
    setup: timestampNotSigned,
    expectFailing: [RESTAMPED],
  },
  {
    name: 'mutant (f): the JSON is re-serialised before the check',
    setup: reserialisedJson,
    expectFailing: [
      'verifies the exact bytes: extra whitespace and unsorted keys, signed as sent, are accepted',
      OTHER_BYTES,
      'refuses a correctly signed body over 1 MiB; exactly 1 MiB is read',
    ],
  },
  {
    name: 'mutant (g): an empty webhook secret is accepted',
    setup: emptySecretAccepted,
    expectFailing: [EMPTY_SECRET],
  },
];

for (const m of mutants) {
  describePaymentsContract({ ...m, setup: quiet(m.setup), capabilities: timestamped });
}
