// Pins the shared input schemas to the Payments port (10.1b review LOW): if the port's parameter
// types and PortInputSchemas drift apart, typecheck fails here.
import type { Payments } from '@edmate/contracts';
import { describe, expectTypeOf, it } from 'vitest';
import type { PortInput, PortOperation } from '../src/input.js';

/**
 * True when each type is assignable to the other. The schemas infer the same values as the port,
 * but zod writes changePlan as one object type per `when` and an optional field as `T | undefined`,
 * so a strict identity check would fail on spelling, not on meaning.
 */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type PortParam<K extends PortOperation> = Parameters<Payments[K]>[0];
type AllSame = { [K in PortOperation]: Same<PortInput<K>, PortParam<K>> };

describe('PortInput matches the port', () => {
  it('has one schema per port method that takes input, and nothing else', () => {
    expectTypeOf<PortOperation>().toEqualTypeOf<
      Exclude<keyof Payments, 'provider' | 'parseWebhook'>
    >();
  });

  it('PortInput<K> equals Parameters<Payments[K]>[0] for every K', () => {
    expectTypeOf<AllSame>().toEqualTypeOf<{ [K in PortOperation]: true }>();
    // A drift is caught: refund's input is not changePlan's.
    expectTypeOf<Same<PortInput<'refund'>, PortParam<'changePlan'>>>().toEqualTypeOf<false>();
  });
});
