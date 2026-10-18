// Live smoke test (`pnpm test:live` only, never `test` or CI): one real embeddings call with the
// platform embedding model. Needs EDMATE_OPENAI_API_KEY.
import { describe, expect, it } from 'vitest';
import { createEmbeddingAdapter, EMBEDDING_CONFIG } from '../../src/embedding/config.js';
import { loadProviderKeys } from '../../src/keys/load.js';
import { envKeySource } from '../../src/keys/source.js';

const env = process.env;
const live = env['EDMATE_LIVE_TESTS'] === '1' && env['EDMATE_OPENAI_API_KEY'] !== undefined;

describe.skipIf(!live)('live: platform embedding model', () => {
  it('returns one vector of the configured dimension per text, and similar texts sit closer', async () => {
    const keys = await loadProviderKeys({ source: envKeySource(env), required: ['openai'] });
    const adapter = createEmbeddingAdapter(keys.get('openai'));
    const [a, b, c] = await adapter.embed([
      'Compound interest grows exponentially.',
      'Interest that compounds grows faster every year.',
      'The mitochondria is the powerhouse of the cell.',
    ]);
    for (const v of [a, b, c]) expect(v?.length).toBe(EMBEDDING_CONFIG.dimension);
    const dot = (x: number[], y: number[]) => x.reduce((s, n, i) => s + n * y[i]!, 0);
    expect(dot(a!, b!) > dot(a!, c!)).toBe(true);
  });
});
