// A deterministic stand-in for the embedding model, for tests only (rule 4: no real model calls).
// Each word's character trigrams (with word-boundary marks) are hashed into one of 1536 buckets and
// the counts are L2-normalised, so texts that share words point the same way. It proves the
// plumbing, not semantic recall.
import type { ModelGateway } from '@edmate/contracts';
import { EMBEDDING_DIMENSIONS } from '../index/indexDocument.js';

/** FNV-1a, 32-bit. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function hashedEmbedding(text: string): number[] {
  const counts = new Map<number, number>();
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}\p{M}]+/gu) ?? []) {
    const padded = `^${word}$`;
    const chars = Array.from(padded);
    for (let i = 0; i + 3 <= chars.length; i++) {
      const idx = fnv1a(chars.slice(i, i + 3).join('')) % EMBEDDING_DIMENSIONS;
      counts.set(idx, (counts.get(idx) ?? 0) + 1);
    }
  }
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  for (const [idx, n] of counts) v[idx] = n;
  const len = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  // No word at all: a fixed unit vector, since pgvector's cosine distance is undefined for zero.
  if (len === 0) {
    v[0] = 1;
    return v;
  }
  return v.map((x) => x / len);
}

export function hashedEmbedder(): Pick<ModelGateway, 'embed'> {
  return { embed: (texts) => Promise.resolve(texts.map(hashedEmbedding)) };
}
