import type { Chunk, Entitlement, RetrievalIndex } from '@edmate/contracts';
import { demoChunk, demoEntitlementSubscription } from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { RetrievalScopeError as ReExportedScopeError } from '../pipeline/steps/buildContext.js';
import {
  junkProbeRetrieval,
  textLeakingRetrieval,
  wideningRetrieval,
} from '../testing/hostileRetrieval.js';
import { memoryRetrieval, OUT_OF_SCOPE_TEXT, retrievalWorld } from '../testing/memoryRetrieval.js';
import { RetrievalScopeError, scopedRetrieval } from './scopedRetrieval.js';

const E: Entitlement = demoEntitlementSubscription;
const Q = 'common denominator fractions';

/** An index whose every call is recorded; `search`/`probe` answers are given per test. */
function stub(o: { search?: unknown; probe?: unknown } = {}) {
  const calls: string[] = [];
  const index: RetrievalIndex = {
    search: (q, scope, k) => {
      calls.push(`search:${q}:${scope.teacherId}:${scope.allowedModuleIds.join(',')}:${String(k)}`);
      return Promise.resolve(('search' in o ? o.search : []) as Chunk[]);
    },
    probe: (q, scope) => {
      calls.push(`probe:${q}:${scope.teacherId}:${scope.moduleIds.join(',')}`);
      return Promise.resolve(
        (o.probe ?? { hit: false, score: 0 }) as { hit: boolean; score: number },
      );
    },
    leakCheck: () => Promise.reject(new Error('not used by scopedRetrieval')),
  };
  return { calls, index };
}

describe('scopedRetrieval.search', () => {
  it('asks the index for the entitlement teacher and deduplicated allowed modules only', async () => {
    const s = stub({ search: [demoChunk] });
    const e = { ...E, allowedModuleIds: ['mod_test_01', 'mod_test_02', 'mod_test_01'] };
    await scopedRetrieval(s.index, e).search(Q, 5);
    expect(s.calls).toEqual([`search:${Q}:tch_test_01:mod_test_01,mod_test_02:5`]);
  });

  it('returns the honest in-scope results', async () => {
    const m = memoryRetrieval({ chunks: retrievalWorld() });
    const got = await scopedRetrieval(m, E).search(Q, 5);
    expect(got.length).toBeGreaterThan(0);
    for (const c of got) {
      expect(c.teacherId).toBe(E.teacherId);
      expect(E.allowedModuleIds).toContain(c.moduleId);
    }
    expect(JSON.stringify(got)).not.toContain(OUT_OF_SCOPE_TEXT);
  });

  it.each([
    ['another teacher', { ...demoChunk, id: 'chk_x', teacherId: 'tch_test_02' }],
    ['a module outside allowed', { ...demoChunk, id: 'chk_x', moduleId: 'mod_test_09' }],
    ['a locked module', { ...demoChunk, id: 'chk_x', moduleId: 'mod_test_04' }],
  ])('one stray chunk (%s) throws RetrievalScopeError naming ids only', async (_l, stray) => {
    const s = stub({ search: [demoChunk, { ...stray, text: OUT_OF_SCOPE_TEXT }] });
    const p = scopedRetrieval(s.index, E).search(Q, 5);
    await expect(p).rejects.toBeInstanceOf(RetrievalScopeError);
    await expect(p).rejects.toThrow(/chk_x/);
    await expect(p).rejects.not.toThrow(OUT_OF_SCOPE_TEXT);
  });

  it('a chunk in a module both allowed and locked (a corrupt entitlement) fails closed', async () => {
    const e = { ...E, lockedModuleIds: ['mod_test_01'] };
    const s = stub({ search: [demoChunk] });
    await expect(scopedRetrieval(s.index, e).search(Q, 5)).rejects.toBeInstanceOf(
      RetrievalScopeError,
    );
  });

  it('an answer that is not a list, or holds a non-object, fails closed', async () => {
    for (const bad of [null, { chunks: [] }, [null], ['text']]) {
      await expect(
        scopedRetrieval(stub({ search: bad }).index, E).search(Q, 5),
      ).rejects.toBeInstanceOf(RetrievalScopeError);
    }
  });

  it('a widening index is refused', async () => {
    const w = wideningRetrieval(retrievalWorld());
    await expect(scopedRetrieval(w, E).search('fractions', 10)).rejects.toBeInstanceOf(
      RetrievalScopeError,
    );
  });

  it('honours k even when the index returns more', async () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ ...demoChunk, id: `chk_m_${String(i)}` }));
    const got = await scopedRetrieval(stub({ search: many }).index, E).search(Q, 3);
    expect(got.map((c) => c.id)).toEqual(['chk_m_0', 'chk_m_1', 'chk_m_2']);
  });

  it.each([0, -1, Number.NaN, 0.5])('k = %s returns [] without calling the index', async (k) => {
    const s = stub({ search: [demoChunk] });
    expect(await scopedRetrieval(s.index, E).search(Q, k)).toEqual([]);
    expect(s.calls).toEqual([]);
  });

  it('an empty query or an empty allowed list returns [] without calling the index', async () => {
    const s = stub({ search: [demoChunk] });
    expect(await scopedRetrieval(s.index, E).search('', 5)).toEqual([]);
    expect(await scopedRetrieval(s.index, { ...E, allowedModuleIds: [] }).search(Q, 5)).toEqual([]);
    expect(s.calls).toEqual([]);
  });

  it('copies only the Chunk fields: extra keys an index adds are dropped', async () => {
    const leaky = textLeakingRetrieval(retrievalWorld());
    const got = await scopedRetrieval(leaky, E).search(Q, 5);
    expect(got.length).toBeGreaterThan(0);
    for (const c of got) {
      expect(Object.keys(c).sort()).toEqual(
        ['documentId', 'id', 'kind', 'moduleId', 'score', 'source', 'teacherId', 'text'].sort(),
      );
      expect(Object.keys(c.source).sort()).toEqual(['kind', 'locator', 'title']);
    }
    expect(JSON.stringify(got)).not.toContain(OUT_OF_SCOPE_TEXT);
  });

  it('a chunk without a score has no score key; results are copies', async () => {
    const original = { ...demoChunk, source: { ...demoChunk.source } };
    const got = await scopedRetrieval(stub({ search: [original] }).index, E).search(Q, 5);
    expect('score' in got[0]!).toBe(false);
    got[0]!.source.title = 'changed';
    expect(original.source.title).toBe(demoChunk.source.title);
  });
});

describe('scopedRetrieval.probeLocked', () => {
  it('asks only for the locked modules and returns { hit, score }', async () => {
    const s = stub({ probe: { hit: true, score: 0.7 } });
    expect(await scopedRetrieval(s.index, E).probeLocked(Q)).toEqual({ hit: true, score: 0.7 });
    expect(s.calls).toEqual([`probe:${Q}:tch_test_01:mod_test_04`]);
  });

  it('no locked modules or an empty query: { hit: false, score: 0 } and no call', async () => {
    const s = stub({ probe: { hit: true, score: 1 } });
    expect(await scopedRetrieval(s.index, { ...E, lockedModuleIds: [] }).probeLocked(Q)).toEqual({
      hit: false,
      score: 0,
    });
    expect(await scopedRetrieval(s.index, E).probeLocked('')).toEqual({ hit: false, score: 0 });
    expect(s.calls).toEqual([]);
  });

  it.each([
    [
      { hit: true, score: 0.5, text: OUT_OF_SCOPE_TEXT },
      { hit: true, score: 0.5 },
    ],
    [
      { hit: true, score: Number.NaN, marker: OUT_OF_SCOPE_TEXT },
      { hit: true, score: 0 },
    ],
    [
      { hit: 'true', score: 2 },
      { hit: false, score: 1 },
    ],
    [
      { hit: 1, score: -3 },
      { hit: false, score: 0 },
    ],
    [
      { hit: true, score: Number.POSITIVE_INFINITY },
      { hit: true, score: 0 },
    ],
    [
      { hit: true, score: '0.9' },
      { hit: true, score: 0 },
    ],
    [null, { hit: false, score: 0 }],
    [OUT_OF_SCOPE_TEXT, { hit: false, score: 0 }],
  ])('a junk probe answer %j passes on only %j', async (raw, want) => {
    const got = await scopedRetrieval(junkProbeRetrieval(retrievalWorld(), raw), E).probeLocked(Q);
    expect(got).toEqual(want);
    expect(Object.keys(got)).toEqual(['hit', 'score']);
    expect(JSON.stringify(got)).not.toContain(OUT_OF_SCOPE_TEXT);
  });

  it('a text-leaking probe passes no text on', async () => {
    const got = await scopedRetrieval(textLeakingRetrieval(retrievalWorld()), E).probeLocked(
      'integration parts',
    );
    expect(got.hit).toBe(true);
    expect(Object.keys(got)).toEqual(['hit', 'score']);
  });
});

describe('scopedRetrieval: types', () => {
  it('the scope cannot be left out or widened at compile time', () => {
    const m = memoryRetrieval({ chunks: [] });
    const s = scopedRetrieval(m, E);
    const compileOnly = () => {
      // @ts-expect-error the contract's search has no unscoped form
      void m.search(Q, 5);
      // @ts-expect-error the scope comes from the entitlement, never from the caller
      void s.search(Q, 5, { teacherId: 'tch_test_02', allowedModuleIds: ['mod_test_04'] });
      // @ts-expect-error probeLocked takes no module list
      void s.probeLocked(Q, ['mod_test_01']);
      void s.probeLocked(Q).then((p) => {
        // @ts-expect-error a probe result has no text
        void p.text;
      });
    };
    expect(typeof compileOnly).toBe('function');
  });

  it('buildContext still exports the same RetrievalScopeError', () => {
    expect(ReExportedScopeError).toBe(RetrievalScopeError);
  });
});
