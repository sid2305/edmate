// Task 13.4b: `route.ts` exports GET guarded for students only, matching the `/api/me/**` GET
// ROUTE_POLICY row.
import { describe, expect, it } from 'vitest';
import { GUARD } from '../../../../src/auth/guard';

describe('route.ts', () => {
  it('exports GET guarded for students only', async () => {
    const route = await import('./route');
    expect((route.GET as unknown as Record<symbol, unknown>)[GUARD]).toEqual(['student']);
    expect(route.dynamic).toBe('force-dynamic');
  });
});
