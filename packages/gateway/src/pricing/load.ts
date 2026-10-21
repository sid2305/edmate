// Loads prices.yaml (task 2.4). A malformed file fails fast at load time, naming the bad model and
// field, like keys/load.ts.
//
// loadBundledPrices parses PRICES_YAML, a TS module generated from prices.yaml and imported
// statically (fix round 9.4e), instead of reading prices.yaml off disk at runtime. The earlier
// `readFileSync(new URL('./prices.yaml', import.meta.url))` could not find the file once webpack
// bundled this module (`next build --webpack`), 503-ing every POST /api/sessions in production.
// Regenerate prices.generated.ts with `node scripts/generate-prices.mjs` after editing
// prices.yaml; test/pricing/generated.test.ts fails if the two drift apart.
import { load } from 'js-yaml';
import { PRICES_YAML } from './prices.generated.js';
import { ModelPriceSchema, PriceFileSchema, toMicroUsdPerMillion } from './schema.js';

export class PriceTableError extends Error {
  override readonly name = 'PriceTableError';
}

/** A model's prices as integer micro-USD per 1,000,000 tokens. */
export interface ScaledPrice {
  readonly input: bigint;
  readonly output: bigint;
}

/** Prices per model. Read-only; built only by parsePriceTable. */
export interface PriceTable {
  has(model: string): boolean;
  models(): readonly string[];
  /** The model's scaled prices, or undefined when it has none. Used by computeCostMicroUsd. */
  scaled(model: string): ScaledPrice | undefined;
}

/** Parses the text of a prices.yaml file. Throws PriceTableError naming the first bad entry. */
export function parsePriceTable(text: string): PriceTable {
  let doc: unknown;
  try {
    doc = load(text);
  } catch {
    throw new PriceTableError('prices.yaml is not valid YAML');
  }
  const file = PriceFileSchema.safeParse(doc);
  if (!file.success) {
    throw new PriceTableError('prices.yaml must be a mapping of model id to prices');
  }
  const entries = new Map<string, ScaledPrice>();
  for (const [model, raw] of Object.entries(file.data)) {
    const price = ModelPriceSchema.safeParse(raw);
    if (!price.success) {
      const problems = price.error.issues.map(
        (i) => `${[model, ...i.path.map(String)].join('.')}: ${i.message}`,
      );
      throw new PriceTableError(`prices.yaml: ${problems.join('; ')}`);
    }
    entries.set(
      model,
      Object.freeze({
        input: toMicroUsdPerMillion(price.data.inputUsdPerMillion),
        output: toMicroUsdPerMillion(price.data.outputUsdPerMillion),
      }),
    );
  }
  return Object.freeze({
    has: (model: string) => entries.has(model),
    models: () => [...entries.keys()],
    scaled: (model: string) => entries.get(model),
  });
}

/** The prices.yaml shipped with this package. */
export function loadBundledPrices(): PriceTable {
  return parsePriceTable(PRICES_YAML);
}
