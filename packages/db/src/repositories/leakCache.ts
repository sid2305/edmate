// Task 5.3 Phase B: the cache behind leakCheck (ADR-0007 point 7). A built locked index is kept
// per (teacher, material revision, allowed module ids). Any chunk write bumps the teacher's
// revision, so a stale entry can't be reached again; storing a newer revision also drops every
// older entry of that teacher at once. Builds are shared between concurrent callers, a failed or
// overrunning build is never stored, and the cache holds at most `max` entries (least recently
// used out first). It holds built indexes only; nothing here logs. (Entries are removed by
// rebuilding the small maps: scope.test.ts bans any delete call in the repositories source.)

/** Most cached indexes (ADR-0007: an LRU of 64). */
export const LEAK_CACHE_MAX = 64;
/** How long one build may run before it is dropped, so a hung query can't pin the key. */
export const LEAK_BUILD_TIMEOUT_MS = 30_000;

export interface LeakCacheKey {
  teacherId: string;
  revision: number;
  /** The whole key as one unambiguous string. */
  id: string;
}

/** The key for a teacher's material at `revision`, seen with `allowedModuleIds` allowed. */
export function leakCacheKey(
  teacherId: string,
  revision: number,
  allowedModuleIds: readonly string[],
): LeakCacheKey {
  const ids = [...new Set(allowedModuleIds)].sort();
  return { teacherId, revision, id: JSON.stringify([teacherId, revision, ids]) };
}

interface Entry<V> {
  key: LeakCacheKey;
  value: V;
  /** When it was last stored or read (a counter): the lowest goes first. */
  used: number;
}

/** `map` without the entries `drop` picks. */
function without<K, T>(map: Map<K, T>, drop: (k: K, v: T) => boolean): Map<K, T> {
  return new Map([...map].filter(([k, v]) => !drop(k, v)));
}

export class LeakIndexCache<V> {
  private entries = new Map<string, Entry<V>>();
  private building = new Map<string, Promise<V>>();
  private clock = 0;
  private readonly max: number;
  private readonly buildTimeoutMs: number;

  constructor(opts: { max?: number; buildTimeoutMs?: number } = {}) {
    this.max = opts.max ?? LEAK_CACHE_MAX;
    this.buildTimeoutMs = opts.buildTimeoutMs ?? LEAK_BUILD_TIMEOUT_MS;
  }

  get size(): number {
    return this.entries.size;
  }

  /** The stored value for `key`, or the shared build of it (stored once it succeeds). */
  get(key: LeakCacheKey, load: () => Promise<V>): Promise<V> {
    const hit = this.entries.get(key.id);
    if (hit !== undefined) {
      hit.used = ++this.clock;
      return Promise.resolve(hit.value);
    }
    const pending = this.building.get(key.id);
    if (pending !== undefined) return pending;
    const build = this.build(key, load);
    this.building.set(key.id, build);
    return build;
  }

  private async build(key: LeakCacheKey, load: () => Promise<V>): Promise<V> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const overrun = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('leak index build timed out')), this.buildTimeoutMs);
      timer.unref();
    });
    try {
      const value = await Promise.race([load(), overrun]);
      this.store(key, value);
      return value;
    } finally {
      clearTimeout(timer);
      this.building = without(this.building, (id) => id === key.id);
    }
  }

  private store(key: LeakCacheKey, value: V): void {
    const same = (e: Entry<V>) => e.key.teacherId === key.teacherId;
    // A newer revision is already in: this build read older material, so it is not kept.
    if ([...this.entries.values()].some((e) => same(e) && e.key.revision > key.revision)) return;
    this.entries = without(this.entries, (_, e) => same(e) && e.key.revision < key.revision);
    this.entries.set(key.id, { key, value, used: ++this.clock });
    if (this.entries.size > this.max) {
      const oldest = Math.min(...[...this.entries.values()].map((e) => e.used));
      this.entries = without(this.entries, (_, e) => e.used === oldest);
    }
  }
}
