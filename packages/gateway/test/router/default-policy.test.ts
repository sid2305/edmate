// Task 8.6a: the default model mix per tier (decision B-42).
import { ModelPolicySchema } from '@edmate/contracts';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL_POLICY, MODEL_MIX } from '../../src/router/index.js';
import type { DeepReadonly } from '../../src/router/default-policy.js';

// Type-only: never called. Proves MODEL_MIX is read-only at every nesting level, so a nested
// assignment fails typecheck (`tsc --noEmit`) if the mix ever becomes writable again.
function typeOnlyNestedAssignmentsAreRejected(): void {
  // @ts-expect-error MODEL_MIX is DeepReadonly: the tiers object is read-only too.
  MODEL_MIX.paid.tiers = MODEL_MIX.free.tiers;
  // @ts-expect-error one level deeper: a route inside tiers is read-only too.
  MODEL_MIX.paid.tiers.main = MODEL_MIX.free.tiers.main;
  // @ts-expect-error deeper still: a single field on a route is read-only too.
  MODEL_MIX.paid.tiers.main.model = 'claude-haiku-4-5';
}
void typeOnlyNestedAssignmentsAreRejected;

// Type-only: never called. Proves DeepReadonly recurses into array elements, not just the array
// itself, so `.push`, index assignment and a nested field inside an array element all fail
// typecheck (`tsc --noEmit`).
function typeOnlyArrayElementsAreDeeplyReadonly(): void {
  const strings: DeepReadonly<string[]> = ['a', 'b'];
  // @ts-expect-error DeepReadonly<string[]> is readonly: no mutating array methods.
  strings.push('c');
  // @ts-expect-error DeepReadonly<string[]> is readonly: no index assignment either.
  strings[0] = 'z';

  const nested: DeepReadonly<{ a: { b: number }[] }> = { a: [{ b: 1 }] };
  // @ts-expect-error a field on an element inside an array is read-only too.
  nested.a[0].b = 1;
}
void typeOnlyArrayElementsAreDeeplyReadonly;

describe('MODEL_MIX (B-42)', () => {
  it.each(['free', 'paid'] as const)('%s: Haiku 4.5 on the small tier, Sonnet 5 on main', (t) => {
    expect(MODEL_MIX[t]).toEqual({
      tiers: {
        small: { provider: 'anthropic', model: 'claude-haiku-4-5' },
        main: { provider: 'anthropic', model: 'claude-sonnet-5' },
      },
    });
    expect(ModelPolicySchema.parse(MODEL_MIX[t])).toEqual(MODEL_MIX[t]);
  });

  it('names exactly the free and paid package tiers', () => {
    expect(Object.keys(MODEL_MIX).sort()).toEqual(['free', 'paid']);
  });

  it('is frozen all the way down, so no caller can change the mix at runtime', () => {
    expect(Object.isFrozen(MODEL_MIX)).toBe(true);
    for (const policy of Object.values(MODEL_MIX)) {
      expect(Object.isFrozen(policy)).toBe(true);
      expect(Object.isFrozen(policy.tiers)).toBe(true);
      for (const route of Object.values(policy.tiers)) expect(Object.isFrozen(route)).toBe(true);
    }
  });

  it('DEFAULT_MODEL_POLICY is the paid mix', () => {
    expect(DEFAULT_MODEL_POLICY).toBe(MODEL_MIX.paid);
  });
});
