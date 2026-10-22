// Task 8.6 Phase C: the monthly AI-cost estimate a package card shows (scope decision 5). Pure and
// free of server imports, so the Phase D client form can import it for the live estimate.
//
// Per subscriber per month: typical = half the daily limit on 20 days; maximum = the full limit
// on 30 days. For a paid package the maximum is also given as a whole percent of the price
// (rounded up, so a warning is never understated). USD only: 1 cent = 10,000 micro-USD.

/** Days a month the estimate assumes: typical use and the most a subscriber can use. */
export const ESTIMATE_DAYS = Object.freeze({ typical: 20, max: 30 });

/** Above this share of the price (percent), the studio shows a plain cost warning (PRD cost check). */
export const COST_WARNING_SHARE_PERCENT = 25;

/**
 * The package form's MVP limits (8.6 plan Q4-Q6, lead answers 22 Oct 2026), shared by the API's
 * body schema and the Phase D client form. Price in US cents: 0 (free) or $1 to $1,000.
 */
export const PACKAGE_LIMITS = Object.freeze({
  nameMaxLength: 80,
  priceMinMinor: 100,
  priceMaxMinor: 100_000,
  trialDaysMax: 30,
  dailyMessagesMin: 1,
  dailyMessagesMax: 100,
  dailyMessagesDefault: 20,
  liveClassesMax: 8,
});

const MICRO_USD_PER_CENT = 10_000;

export interface MonthlyEstimate {
  typicalMicroUsd: number;
  maxMicroUsd: number;
  /** Paid packages only: the maximum as a whole percent of the monthly price, rounded up. */
  shareOfPrice?: number;
}

function wholeNumber(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
  return value;
}

/**
 * The monthly estimate for one subscriber. Throws `RangeError` for a negative, fractional or
 * non-finite input, or a result past `Number.MAX_SAFE_INTEGER`: a bad estimate is never shown as 0.
 */
export function monthlyEstimate(
  perTurnMicroUsd: number,
  dailyLimit: number,
  priceMinor: number,
): MonthlyEstimate {
  const turn = wholeNumber(perTurnMicroUsd, 'perTurnMicroUsd');
  const daily = wholeNumber(dailyLimit, 'dailyLimit');
  const price = wholeNumber(priceMinor, 'priceMinor');
  // Half the limit on 20 days = limit x 10 days: exact for an odd limit too.
  const typicalMicroUsd = wholeNumber(
    (turn * daily * ESTIMATE_DAYS.typical) / 2,
    'typicalMicroUsd',
  );
  const maxMicroUsd = wholeNumber(turn * daily * ESTIMATE_DAYS.max, 'maxMicroUsd');
  if (price === 0) return { typicalMicroUsd, maxMicroUsd };
  const priceMicroUsd = price * MICRO_USD_PER_CENT;
  const shareOfPrice = Math.ceil((maxMicroUsd * 100) / priceMicroUsd);
  return { typicalMicroUsd, maxMicroUsd, shareOfPrice };
}

/** Whether the card shows the cost warning: a paid package whose maximum is above 25% of its price. */
export function costWarning(estimate: MonthlyEstimate): boolean {
  return (estimate.shareOfPrice ?? 0) > COST_WARNING_SHARE_PERCENT;
}
