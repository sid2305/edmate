// Task 13.4b: `route.ts` exports DELETE guarded for students only, matching the already-reserved
// ROUTE_POLICY row (`apps/web/src/auth/policy.ts:47`).
import { describe, expect, it } from 'vitest';
import { GUARD } from '../../../src/auth/guard';

describe('route.ts', () => {
  it('exports DELETE guarded for students only', async () => {
    const route = await import('./route');
    expect((route.DELETE as unknown as Record<symbol, unknown>)[GUARD]).toEqual(['student']);
    expect(route.dynamic).toBe('force-dynamic');
  });
});
