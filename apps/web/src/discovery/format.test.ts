// Task 9.2 Phase C. Written and red before format.ts exists (TDD).
import { describe, expect, it } from 'vitest';
import { formatPrice } from './format';

describe('formatPrice', () => {
  it('formats USD cents with two fraction digits', () => {
    expect(formatPrice({ amountMinor: 1999, currency: 'USD' }, 'Free')).toBe('$19.99');
    expect(formatPrice({ amountMinor: 500, currency: 'USD' }, 'Free')).toBe('$5.00');
  });

  it("uses a zero-decimal currency's own fraction digits (JPY minor unit = yen)", () => {
    expect(formatPrice({ amountMinor: 500, currency: 'JPY' }, 'Free')).toBe('¥500');
  });

  it('uses a three-decimal currency correctly (KWD)', () => {
    expect(formatPrice({ amountMinor: 1500, currency: 'KWD' }, 'Free')).toMatch(/1\.500/);
  });

  it('returns the free label at 0, whatever the currency', () => {
    expect(formatPrice({ amountMinor: 0, currency: 'USD' }, 'Free')).toBe('Free');
    expect(formatPrice({ amountMinor: 0, currency: 'JPY' }, 'Gratis')).toBe('Gratis');
  });
});
