import { describe, expect, it } from 'vitest';
import { EMBEDDING_DIMENSIONS } from '../../src/index/indexDocument.js';
import { hashedEmbedder, hashedEmbedding } from '../../src/testing/hashedEmbedder.js';

const cosine = (a: number[], b: number[]): number => a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);
const norm = (a: number[]): number => Math.sqrt(cosine(a, a));

describe('hashedEmbedding', () => {
  it('is deterministic, 1536 finite numbers of unit length', () => {
    const v = hashedEmbedding('Plants make food from light.');
    expect(v).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(v.every(Number.isFinite)).toBe(true);
    expect(norm(v)).toBeCloseTo(1, 10);
    expect(hashedEmbedding('Plants make food from light.')).toEqual(v);
  });

  it('puts texts sharing words closer than unrelated texts, ignoring case', () => {
    const q = hashedEmbedding('how do plants make food');
    const near = hashedEmbedding('Plants make their FOOD using sunlight.');
    const far = hashedEmbedding('Rivers erode rocks over centuries.');
    expect(cosine(q, near)).toBeGreaterThan(cosine(q, far));
    expect(cosine(hashedEmbedding('ABC'), hashedEmbedding('abc'))).toBeCloseTo(1, 10);
  });

  it('gives a fixed unit vector for text with no letters or digits (never a zero vector)', () => {
    for (const t of ['', '  ', '?!']) {
      const v = hashedEmbedding(t);
      expect(norm(v)).toBeCloseTo(1, 10);
      expect(v).toEqual(hashedEmbedding(''));
    }
  });

  it('handles accents and non-Latin scripts', () => {
    const v = hashedEmbedding('café naïve 光合作用 प्रकाश');
    expect(norm(v)).toBeCloseTo(1, 10);
    expect(v).not.toEqual(hashedEmbedding(''));
  });
});

describe('hashedEmbedder', () => {
  it('embeds every text, in order, as a gateway would', async () => {
    const vs = await hashedEmbedder().embed(['a b', 'c d']);
    expect(vs).toEqual([hashedEmbedding('a b'), hashedEmbedding('c d')]);
  });
});
