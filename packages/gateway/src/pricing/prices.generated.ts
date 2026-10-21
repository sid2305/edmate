// GENERATED FILE. Do not edit by hand -- edit prices.yaml and regenerate.
// Regenerate with `node scripts/generate-prices.mjs` (packages/gateway "generate:prices" script)
// after editing prices.yaml. test/pricing/generated.test.ts fails if this file drifts from it.
//
// Why generated instead of read at runtime (fix round 9.4e): loadBundledPrices used to do
// `readFileSync(new URL('./prices.yaml', import.meta.url))`, which cannot find the file once
// webpack bundles this module (`next build --webpack`), 503-ing every POST /api/sessions in
// production. A statically imported TS module is bundler-safe.

/** The raw text of prices.yaml, embedded so loadBundledPrices needs no runtime file read. */
export const PRICES_YAML = `# Model prices in plain USD per 1,000,000 tokens (build plan, Model gateway). Task 2.4.
#
# One entry per model id, exactly as the adapters report it in a usage chunk. Metering turns a
# call's token counts into integer micro-USD with these prices (src/pricing/cost.ts). A model that
# is missing here is still metered: its row keeps the real token counts, has no cost, and is
# flagged \`unpriced\` with a loud log line, so add the price before routing traffic to it.
#
# Each price: a non-negative number with at most 6 decimal places. No other keys.
# Values are list prices at the time of writing; check them against the provider's price page
# when a model is added or the default model mix changes (task 7.6).

claude-haiku-4-5:
  inputUsdPerMillion: 1
  outputUsdPerMillion: 5

claude-sonnet-4-5:
  inputUsdPerMillion: 3
  outputUsdPerMillion: 15
`;
