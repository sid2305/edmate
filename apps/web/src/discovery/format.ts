// Task 9.2 Phase C (scope decision 6): price formatting for the public teacher page. The amount is
// in the currency's minor unit, so it is scaled by that currency's own fraction digits (2 for USD,
// 0 for JPY, 3 for KWD) from `Intl.NumberFormat`'s defaults, never a hardcoded `/ 100`.
import type { PackageOffer } from '@edmate/db';
import type { getTranslations } from 'next-intl/server';

/**
 * The real next-intl translator for the `teacherPage` namespace, as `getTranslations` returns it.
 * Assignable without a cast everywhere a static key is used (`t('packagesHeading')`, etc.).
 */
export type Translate = Awaited<ReturnType<typeof getTranslations<'teacherPage'>>>;

/**
 * The one cast in this module: a message key built at runtime (a skill id, a scorecard category
 * key) is not a literal `Translate` accepts, but it is always one of a known, locale-checked set.
 */
export function dynamicLabel(t: Translate, key: string): string {
  return (t as unknown as (key: string) => string)(key);
}

export function formatPrice(
  price: PackageOffer['pricePerMonth'],
  freeLabel: string,
  locale = 'en-US',
): string {
  if (price.amountMinor === 0) return freeLabel;
  const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency: price.currency });
  // `maximumFractionDigits` is always defined by `resolvedOptions()` for `style: 'currency'`
  // (Intl always resolves a currency's own fraction digits); the type is loose only because
  // other `Intl.NumberFormat` styles can omit it. A silent `?? 2` would be the wrong digits for
  // a currency that isn't 2 (e.g. JPY, KWD), so this throws instead of guessing.
  const digits = formatter.resolvedOptions().maximumFractionDigits;
  if (digits === undefined) {
    throw new Error(`no resolved fraction digits for currency ${price.currency}`);
  }
  return formatter.format(price.amountMinor / 10 ** digits);
}
