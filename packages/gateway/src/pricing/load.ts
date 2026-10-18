// Loads prices.yaml (task 2.4). A malformed file fails fast at load time, naming the bad model and
// field, like keys/load.ts. The bundled file sits next to this module in both src/ (tests) and
// dist/ (the build script copies it).
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
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
  return parsePriceTable(readFileSync(new URL('./prices.yaml', import.meta.url), 'utf8'));
}
