// In-memory RetrievalIndex for pipeline tests (3.4; reused by 5.3/5.4). Synthetic data only.
// `search` only ever looks at the scope's teacher and allowed modules, and `probe` returns only
// `{ hit, score }`, so a test can put locked and other-teacher chunks in the same index and prove
// that nothing outside the scope comes back.
import type { Chunk, RetrievalIndex } from '@edmate/contracts';
import { demoChunk } from '@edmate/contracts/fixtures';

type SearchScope = Parameters<RetrievalIndex['search']>[1];
type ProbeScope = Parameters<RetrievalIndex['probe']>[1];

export interface MemoryRetrieval extends RetrievalIndex {
  readonly searches: { q: string; scope: SearchScope; k: number }[];
  readonly probes: { q: string; scope: ProbeScope }[];
}

/** Marks text that must never reach a TurnContext (locked or another teacher's). */
export const OUT_OF_SCOPE_TEXT = 'OUT_OF_SCOPE_MARKER';

const words = (t: string) =>
  new Set(
    t
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w !== ''),
  );

/** Share of the query's words found in the text, 0..1. */
function overlap(q: Set<string>, text: string): number {
  if (q.size === 0) return 0;
  const t = words(text);
  let n = 0;
  for (const w of q) if (t.has(w)) n++;
  return n / q.size;
}

const copy = (c: Chunk): Chunk => ({ ...c, source: { ...c.source } });

const isIds = (x: unknown): x is string[] =>
  Array.isArray(x) && x.every((v) => typeof v === 'string');

function scopeError(method: string): Error {
  return new Error(`memoryRetrieval.${method}: a teacherId and module id list scope is required`);
}

export function memoryRetrieval(opts: {
  chunks: readonly Chunk[];
  /** A fixed probe result, instead of the computed one. */
  probe?: { hit: boolean; score: number };
}): MemoryRetrieval {
  const chunks = opts.chunks.map(copy);
  const searches: MemoryRetrieval['searches'] = [];
  const probes: MemoryRetrieval['probes'] = [];
  return {
    searches,
    probes,
    search(q, scope, k) {
      const s = scope as Partial<SearchScope> | undefined;
      if (typeof s?.teacherId !== 'string' || !isIds(s.allowedModuleIds)) {
        return Promise.reject(scopeError('search'));
      }
      searches.push({
        q,
        scope: { teacherId: s.teacherId, allowedModuleIds: [...s.allowedModuleIds] },
        k,
      });
      const allowed = new Set(s.allowedModuleIds);
      const qw = words(q);
      const hits = chunks
        .filter((c) => c.teacherId === s.teacherId && allowed.has(c.moduleId))
        .map((c) => ({ c, score: overlap(qw, c.text) }))
        .filter((h) => h.score > 0)
        .sort((a, b) => b.score - a.score || (a.c.id < b.c.id ? -1 : 1))
        .slice(0, Math.max(0, k))
        .map((h) => ({ ...copy(h.c), score: h.score }));
      return Promise.resolve(hits);
    },
    probe(q, scope) {
      const s = scope as Partial<ProbeScope> | undefined;
      if (typeof s?.teacherId !== 'string' || !isIds(s.moduleIds)) {
        return Promise.reject(scopeError('probe'));
      }
      probes.push({ q, scope: { teacherId: s.teacherId, moduleIds: [...s.moduleIds] } });
      if (opts.probe !== undefined) return Promise.resolve({ ...opts.probe });
      const ids = new Set(s.moduleIds);
      const qw = words(q);
      let score = 0;
      for (const c of chunks) {
        if (c.teacherId === s.teacherId && ids.has(c.moduleId)) {
          score = Math.max(score, overlap(qw, c.text));
        }
      }
      return Promise.resolve({ hit: score > 0, score });
    },
  };
}

/**
 * Teacher tch_test_01's material across allowed (mod_test_01..03) and locked (mod_test_04)
 * modules, plus another teacher's chunk in a module with the same id. Out-of-scope text carries
 * OUT_OF_SCOPE_TEXT for the demo entitlement (allowed mod_test_01..03, locked mod_test_04).
 */
export function retrievalWorld(): Chunk[] {
  return [
    demoChunk,
    { ...demoChunk, id: 'chk_world_02', text: 'Fractions name equal parts of a whole.' },
    {
      ...demoChunk,
      id: 'chk_world_03',
      moduleId: 'mod_test_02',
      text: 'A common denominator is a shared multiple of both denominators.',
    },
    {
      ...demoChunk,
      id: 'chk_world_04',
      moduleId: 'mod_test_04',
      text: `${OUT_OF_SCOPE_TEXT} Integration by parts: choose u and dv, then integrate.`,
    },
    {
      ...demoChunk,
      id: 'chk_world_05',
      teacherId: 'tch_test_02',
      text: `${OUT_OF_SCOPE_TEXT} Another teacher: fractions with a common denominator.`,
    },
  ];
}
