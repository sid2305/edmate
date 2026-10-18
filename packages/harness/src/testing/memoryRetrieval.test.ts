import type { RetrievalIndex } from '@edmate/contracts';
import { describe, expect, it } from 'vitest';
import { memoryRetrieval, OUT_OF_SCOPE_TEXT, retrievalWorld } from './memoryRetrieval.js';

const SCOPE = { teacherId: 'tch_test_01', allowedModuleIds: ['mod_test_01'] };

describe('memoryRetrieval.search: only the scope, by construction', () => {
  it('returns only the scoped teacher and modules, never the rest of the world', async () => {
    const r = memoryRetrieval({ chunks: retrievalWorld() });
    const out = await r.search('fractions denominator', SCOPE, 10);
    expect(out.length).toBeGreaterThan(0);
    for (const c of out) {
      expect(c.teacherId).toBe('tch_test_01');
      expect(c.moduleId).toBe('mod_test_01');
      expect(c.text).not.toContain(OUT_OF_SCOPE_TEXT);
    }
    expect(r.searches).toEqual([{ q: 'fractions denominator', scope: SCOPE, k: 10 }]);
  });

  it('ranks by word overlap (ties by id), returns at most k, with a score', async () => {
    const r = memoryRetrieval({ chunks: retrievalWorld() });
    const scope = { teacherId: 'tch_test_01', allowedModuleIds: ['mod_test_01', 'mod_test_02'] };
    const out = await r.search('common denominator', scope, 1);
    expect(out).toHaveLength(1);
    expect(out[0]?.text).toContain('common denominator');
    expect(out[0]?.score).toBeGreaterThan(0);
    const all = await r.search('common denominator', scope, 10);
    const scores = all.map((c) => c.score ?? 0);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('returns nothing for an empty allow-list, a zero k, or a query with no overlap', async () => {
    const r = memoryRetrieval({ chunks: retrievalWorld() });
    expect(await r.search('fractions', { ...SCOPE, allowedModuleIds: [] }, 5)).toEqual([]);
    expect(await r.search('fractions', SCOPE, 0)).toEqual([]);
    expect(await r.search('zebra', SCOPE, 5)).toEqual([]);
  });

  it('returns copies, so a caller cannot edit the index', async () => {
    const r = memoryRetrieval({ chunks: retrievalWorld() });
    const [c] = await r.search('fractions', SCOPE, 1);
    if (c !== undefined) c.text = 'edited';
    const [again] = await r.search('fractions', SCOPE, 1);
    expect(again?.text).not.toBe('edited');
  });

  it('throws when called without a well-formed scope (the type already forbids it)', async () => {
    const r = memoryRetrieval({ chunks: retrievalWorld() });
    const search = r.search.bind(r) as (q: string, s: unknown, k: number) => Promise<unknown>;
    await expect(search('q', undefined, 5)).rejects.toThrow(/scope/);
    await expect(search('q', { teacherId: 'tch_test_01' }, 5)).rejects.toThrow(/scope/);
    await expect(search('q', { allowedModuleIds: ['mod_test_01'] }, 5)).rejects.toThrow(/scope/);
  });

  it('type-checks: search cannot be called without a scope', () => {
    const r: RetrievalIndex = memoryRetrieval({ chunks: [] });
    // @ts-expect-error the access filter is required (ADR-0003)
    void r.search('q', 5).catch(() => undefined);
    // @ts-expect-error allowedModuleIds is required
    void r.search('q', { teacherId: 't' }, 5).catch(() => undefined);
  });
});

describe('memoryRetrieval.probe: a hit and a score, never text', () => {
  it('reports a hit on matching locked modules, with only hit and score keys', async () => {
    const r = memoryRetrieval({ chunks: retrievalWorld() });
    const p = await r.probe('integration by parts', {
      teacherId: 'tch_test_01',
      moduleIds: ['mod_test_04'],
    });
    expect(Object.keys(p).sort()).toEqual(['hit', 'score']);
    expect(p.hit).toBe(true);
    expect(p.score).toBeGreaterThan(0);
    expect(JSON.stringify(p)).not.toContain(OUT_OF_SCOPE_TEXT);
    expect(r.probes).toEqual([
      {
        q: 'integration by parts',
        scope: { teacherId: 'tch_test_01', moduleIds: ['mod_test_04'] },
      },
    ]);
  });

  it('no hit for another teacher, other modules, or no overlap', async () => {
    const r = memoryRetrieval({ chunks: retrievalWorld() });
    const miss = { hit: false, score: 0 };
    expect(
      await r.probe('integration', { teacherId: 'tch_test_02', moduleIds: ['mod_test_04'] }),
    ).toEqual(miss);
    expect(
      await r.probe('integration', { teacherId: 'tch_test_01', moduleIds: ['mod_test_01'] }),
    ).toEqual(miss);
    expect(
      await r.probe('zebra', { teacherId: 'tch_test_01', moduleIds: ['mod_test_04'] }),
    ).toEqual(miss);
  });

  it('a configured result overrides the computed one', async () => {
    const r = memoryRetrieval({ chunks: [], probe: { hit: true, score: 0.9 } });
    expect(await r.probe('x', { teacherId: 't', moduleIds: ['m'] })).toEqual({
      hit: true,
      score: 0.9,
    });
  });

  it('throws when called without a well-formed scope', async () => {
    const r = memoryRetrieval({ chunks: [] });
    const probe = r.probe.bind(r) as (q: string, s: unknown) => Promise<unknown>;
    await expect(probe('q', undefined)).rejects.toThrow(/scope/);
    await expect(probe('q', { teacherId: 't', moduleIds: 'm' })).rejects.toThrow(/scope/);
  });
});
