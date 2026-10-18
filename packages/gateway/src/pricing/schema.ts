// The shape of prices.yaml (task 2.4): model id -> USD per 1,000,000 input and output tokens.
import { z } from 'zod';

/** At most 6 decimal places, so a price is an exact integer number of micro-USD per 1M tokens. */
const SCALE = 1_000_000;

function hasAtMostSixDecimals(n: number): boolean {
  const scaled = n * SCALE;
  const whole = Math.round(scaled);
  return Number.isSafeInteger(whole) && Math.abs(scaled - whole) < 1e-6;
}

const UsdPerMillion = z
  .number()
  .refine((n) => n >= 0, 'must not be negative')
  .refine(hasAtMostSixDecimals, 'must have at most 6 decimal places');

export const ModelPriceSchema = z.strictObject({
  inputUsdPerMillion: UsdPerMillion,
  outputUsdPerMillion: UsdPerMillion,
});
export type ModelPrice = z.infer<typeof ModelPriceSchema>;

/** The whole file: a mapping of non-empty model ids; each entry is checked on its own. */
export const PriceFileSchema = z.record(z.string().min(1), z.unknown());

/** USD per 1M tokens -> integer micro-USD per 1M tokens (exact after the 6-decimal check). */
export function toMicroUsdPerMillion(usdPerMillion: number): bigint {
  return BigInt(Math.round(usdPerMillion * SCALE));
}
