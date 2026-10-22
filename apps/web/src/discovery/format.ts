// Task 9.2 Phase C (scope decision 6): price formatting for the public teacher page. The amount is
// in the currency's minor unit, so it is scaled by that currency's own fraction digits (2 for USD,
// 0 for JPY, 3 for KWD) from `Intl.NumberFormat`'s defaults, never a hardcoded `/ 100`.
import type { PackageOffer } from '@edmate/db';

/** A next-intl translator narrowed to what the discovery components need. */
export type Translate = (key: string, values?: Record<string, string | number>) => string;

export function formatPrice(
  price: PackageOffer['pricePerMonth'],
  freeLabel: string,
  locale = 'en-US',
): string {
  if (price.amountMinor === 0) return freeLabel;
  const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency: price.currency });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(price.amountMinor / 10 ** digits);
}
