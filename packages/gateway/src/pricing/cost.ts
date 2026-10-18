// Token counts -> integer micro-USD (task 2.4). All arithmetic is BigInt, so the stored cost is
// exact: price (micro-USD per 1M tokens) x tokens, summed over input and output, divided by 1M and
// rounded half up once.
import type { PriceTable } from './load.js';

const MILLION = 1_000_000n;
const HALF = MILLION / 2n;
const MAX = BigInt(Number.MAX_SAFE_INTEGER);

function tokens(n: number, field: string): bigint {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new RangeError(`${field} must be a non-negative safe integer`);
  }
  return BigInt(n);
}

/**
 * The call's cost in integer micro-USD, or `undefined` when the model has no price (the caller
 * records that as unpriced, never as free).
 */
export function computeCostMicroUsd(
  table: PriceTable,
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | undefined {
  const inT = tokens(inputTokens, 'inputTokens');
  const outT = tokens(outputTokens, 'outputTokens');
  const price = table.scaled(model);
  if (price === undefined) return undefined;
  const cost = (inT * price.input + outT * price.output + HALF) / MILLION;
  if (cost > MAX) throw new RangeError('cost is too large to store exactly');
  return Number(cost);
}
