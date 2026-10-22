// Property: for a fixed allowed-tags list and adversarial candidate tags (unicode, empty, very
// long, duplicates), every known-output tag is on the allowed list and every tag not on the list
// lands only in proposed, never known. Seeded PRNG, no fast-check (1.2 decision). Task 6.3; see
// docs/tasks/6.3/plan.md.
import { describe, expect, it } from 'vitest';
import { classifyMistakeTags, type MistakeTagCandidate } from './mistakeTags.js';
import { prng, type Prng } from '../testing/prng.js';

const SEED = 20261021;
const ITERATIONS = 2_000;

const ALLOWED_TAGS = ['string-number-mix', 'off-by-one-range', 'integer-division'] as const;

/** A pool of candidate tag strings: allowed ones, unseen ones, and adversarial edge cases. */
const TAG_POOL: readonly string[] = [
  ...ALLOWED_TAGS,
  '',
  'foo-bar',
  'unseen-tag',
  '🦄-emoji-tag',
  'über-naïve-tag',
  'a'.repeat(5000),
  ' string-number-mix ', // whitespace padding — not an exact match
  'STRING-NUMBER-MIX', // case differs — not an exact match
];

function randomCandidate(r: Prng): MistakeTagCandidate {
  const day = String(r.int(28) + 1).padStart(2, '0');
  return {
    tag: r.pick(TAG_POOL),
    ts: `2026-10-${day}T10:00:00.000Z`,
  };
}

describe('classifyMistakeTags', () => {
  it(`never emits a tag outside the allowed list, across ${ITERATIONS} random inputs (seed ${SEED})`, () => {
    const r = prng(SEED);
    for (let i = 0; i < ITERATIONS; i++) {
      const count = r.int(12);
      const candidates = Array.from({ length: count }, () => randomCandidate(r));
      const { known, proposed } = classifyMistakeTags(candidates, ALLOWED_TAGS);

      for (const entry of known) {
        expect(
          (ALLOWED_TAGS as readonly string[]).includes(entry.tag),
          `seed ${SEED}, iteration ${i}: known tag ${JSON.stringify(entry.tag)} is not on the allowed list`,
        ).toBe(true);
      }
      for (const entry of proposed) {
        expect(
          (ALLOWED_TAGS as readonly string[]).includes(entry.tag),
          `seed ${SEED}, iteration ${i}: proposed tag ${JSON.stringify(entry.tag)} is on the allowed list`,
        ).toBe(false);
      }

      // Every candidate tag not on the allowed list must appear in proposed, never in known.
      const candidateTags = new Set(candidates.map((c) => c.tag));
      for (const tag of candidateTags) {
        if ((ALLOWED_TAGS as readonly string[]).includes(tag)) {
          expect(known.some((e) => e.tag === tag)).toBe(true);
          expect(proposed.some((e) => e.tag === tag)).toBe(false);
        } else {
          expect(proposed.some((e) => e.tag === tag)).toBe(true);
          expect(known.some((e) => e.tag === tag)).toBe(false);
        }
      }

      // No duplicate tags within known or within proposed (fully aggregated).
      expect(new Set(known.map((e) => e.tag)).size).toBe(known.length);
      expect(new Set(proposed.map((e) => e.tag)).size).toBe(proposed.length);
    }
  });

  it('splits the demo teacher\'s real tags exactly, aggregating duplicates and taking the later lastSeen', () => {
    const candidates: MistakeTagCandidate[] = [
      { tag: 'off-by-one-range', ts: '2026-10-19T09:00:00.000Z' },
      { tag: 'string-number-mix', ts: '2026-10-19T10:00:00.000Z' },
      { tag: 'off-by-one-range', ts: '2026-10-20T09:00:00.000Z' },
      { tag: 'foo-bar', ts: '2026-10-19T11:00:00.000Z' },
    ];
    const { known, proposed } = classifyMistakeTags(candidates, ALLOWED_TAGS);

    expect(known).toEqual(
      expect.arrayContaining([
        { tag: 'off-by-one-range', count: 2, lastSeen: '2026-10-20T09:00:00.000Z' },
        { tag: 'string-number-mix', count: 1, lastSeen: '2026-10-19T10:00:00.000Z' },
      ]),
    );
    expect(known).toHaveLength(2);
    expect(proposed).toEqual([
      { tag: 'foo-bar', count: 1, lastSeen: '2026-10-19T11:00:00.000Z' },
    ]);
  });

  it('is a no-op (empty known and proposed) for no candidates', () => {
    expect(classifyMistakeTags([], ALLOWED_TAGS)).toEqual({ known: [], proposed: [] });
  });
});
