// Task 5.3 Phase B: the leakCheck index cache (ADR-0007 point 7). Pure, no database.
import { describe, expect, it } from 'vitest';
import { LEAK_CACHE_MAX, LeakIndexCache, leakCacheKey } from '../src/repositories/leakCache.js';

const key = (teacherId: string, revision: number, ids: string[] = ['m1']) =>
  leakCacheKey(teacherId, revision, ids);

describe('leakCacheKey', () => {
  it('sorts and dedupes the allowed ids and is unambiguous', () => {
    expect(key('t', 1, ['b', 'a', 'b'])).toEqual(key('t', 1, ['a', 'b']));
    expect(key('t', 1, ['a,b'])).not.toEqual(key('t', 1, ['a', 'b']));
    expect(key('t', 1)).not.toEqual(key('t', 2));
    expect(key('t', 1)).not.toEqual(key('u', 1));
  });
});

describe('LeakIndexCache', () => {
  it('builds once per key, then serves the stored value', async () => {
    const cache = new LeakIndexCache<string>();
    let builds = 0;
    const load = () => Promise.resolve(`v${++builds}`);
    expect(await cache.get(key('t', 1), load)).toBe('v1');
    expect(await cache.get(key('t', 1), load)).toBe('v1');
    expect(builds).toBe(1);
    expect(cache.size).toBe(1);
  });

  it('shares one build between concurrent callers', async () => {
    const cache = new LeakIndexCache<string>();
    let builds = 0;
    let release!: (v: string) => void;
    const load = () => {
      builds += 1;
      return new Promise<string>((r) => (release = r));
    };
    const a = cache.get(key('t', 1), load);
    const b = cache.get(key('t', 1), load);
    release('shared');
    expect(await Promise.all([a, b])).toEqual(['shared', 'shared']);
    expect(builds).toBe(1);
  });

  it('never stores a failed build: the next call tries again', async () => {
    const cache = new LeakIndexCache<string>();
    await expect(cache.get(key('t', 1), () => Promise.reject(new Error('down')))).rejects.toThrow(
      'down',
    );
    expect(cache.size).toBe(0);
    expect(await cache.get(key('t', 1), () => Promise.resolve('ok'))).toBe('ok');
  });

  it('a build that outlives the build timeout is dropped and rejects; a later call rebuilds', async () => {
    const cache = new LeakIndexCache<string>({ buildTimeoutMs: 20 });
    const hung = cache.get(key('t', 1), () => new Promise<string>(() => undefined));
    await expect(hung).rejects.toThrow('leak index build timed out');
    expect(await cache.get(key('t', 1), () => Promise.resolve('fresh'))).toBe('fresh');
  });

  it('a newer revision clears every older entry of that teacher, not other teachers', async () => {
    const cache = new LeakIndexCache<string>();
    await cache.get(key('t', 1, ['a']), () => Promise.resolve('t1a'));
    await cache.get(key('t', 1, ['b']), () => Promise.resolve('t1b'));
    await cache.get(key('u', 1), () => Promise.resolve('u1'));
    await cache.get(key('t', 2, ['a']), () => Promise.resolve('t2a'));
    expect(cache.size).toBe(2);
    let rebuilt = false;
    await cache.get(key('u', 1), () => {
      rebuilt = true;
      return Promise.resolve('again');
    });
    expect(rebuilt).toBe(false);
  });

  it('a late build of an older revision does not evict or replace a newer one', async () => {
    const cache = new LeakIndexCache<string>();
    let release!: (v: string) => void;
    const old = cache.get(key('t', 1), () => new Promise<string>((r) => (release = r)));
    await cache.get(key('t', 2), () => Promise.resolve('new'));
    release('old');
    expect(await old).toBe('old');
    expect(cache.size).toBe(1);
    expect(await cache.get(key('t', 2), () => Promise.resolve('rebuilt'))).toBe('new');
  });

  it('evicts the least recently used entry beyond the limit', async () => {
    const cache = new LeakIndexCache<string>({ max: 2 });
    await cache.get(key('a', 1), () => Promise.resolve('a'));
    await cache.get(key('b', 1), () => Promise.resolve('b'));
    await cache.get(key('a', 1), () => Promise.resolve('a again')); // a is now most recent
    await cache.get(key('c', 1), () => Promise.resolve('c'));
    expect(cache.size).toBe(2);
    expect(await cache.get(key('a', 1), () => Promise.resolve('rebuilt'))).toBe('a');
    expect(await cache.get(key('b', 1), () => Promise.resolve('rebuilt'))).toBe('rebuilt');
  });

  it('defaults to 64 entries', () => {
    expect(LEAK_CACHE_MAX).toBe(64);
  });
});
