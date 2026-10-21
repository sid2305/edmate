// In-memory RetrievalIndex for pipeline tests (3.4; reused by 5.3/5.4). Synthetic data only.
// `search` only ever looks at the scope's teacher and allowed modules, and `probe` returns only
// `{ hit, score }`, so a test can put locked and other-teacher chunks in the same index and prove
// that nothing outside the scope comes back.
//
// `leakCheck` (ADR-0007, task 4.6) runs the shared matcher (guardrails/lockedMatch.ts) against the
// scope teacher's chunks outside `allowedModuleIds` (the complement: locked, draft and unpackaged
// modules), each module's chunks joined in order, ignoring spans also in an allowed chunk. It
// returns only `{ hit }` and records only the candidate count, never a candidate.
import { type Chunk, ChunkSchema, type RetrievalIndex } from '@edmate/contracts';
import { demoChunk } from '@edmate/contracts/fixtures';
import { lockedIndex } from '../guardrails/lockedMatch.js';

type SearchScope = Parameters<RetrievalIndex['search']>[1];
type ProbeScope = Parameters<RetrievalIndex['probe']>[1];
type LeakScope = Parameters<RetrievalIndex['leakCheck']>[1];

export interface MemoryRetrieval extends RetrievalIndex {
  readonly searches: { q: string; scope: SearchScope; k: number }[];
  readonly probes: { q: string; scope: ProbeScope }[];
  /** One entry per leakCheck call: how many candidates and the scope; never the text. */
  readonly leakChecks: { candidates: number; scope: LeakScope }[];
  /**
   * Adds a chunk (a copy, validated against ChunkSchema) after construction, as a CorrectionStore
   * writing a teacher note does (5.10). It is found only under a scope allowing its module.
   */
  add(chunk: Chunk): void;
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

/** Each module's text, its chunks joined in order, for one teacher: [allowed, outside]. */
function moduleTexts(chunks: readonly Chunk[], teacherId: string, allowed: ReadonlySet<string>) {
  const byModule = new Map<string, string[]>();
  for (const c of chunks) {
    if (c.teacherId !== teacherId) continue;
    const texts = byModule.get(c.moduleId) ?? [];
    texts.push(c.text);
    byModule.set(c.moduleId, texts);
  }
  const inside: string[] = [];
  const outside: string[] = [];
  for (const [moduleId, texts] of byModule) {
    (allowed.has(moduleId) ? inside : outside).push(texts.join('\n'));
  }
  return [inside, outside] as const;
}

export function memoryRetrieval(opts: {
  chunks: readonly Chunk[];
  /** A fixed probe result, instead of the computed one. */
  probe?: { hit: boolean; score: number };
  /** A fixed leakCheck result instead of the computed one; an Error rejects. */
  leakCheck?: boolean | Error;
}): MemoryRetrieval {
  const chunks = opts.chunks.map(copy);
  const searches: MemoryRetrieval['searches'] = [];
  const probes: MemoryRetrieval['probes'] = [];
  const leakChecks: MemoryRetrieval['leakChecks'] = [];
  return {
    searches,
    probes,
    leakChecks,
    add(chunk) {
      const c = ChunkSchema.parse(chunk);
      if (chunks.some((x) => x.id === c.id)) {
        throw new Error('memoryRetrieval.add: duplicate chunk id');
      }
      chunks.push(copy(c));
    },
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
    leakCheck(candidates, scope) {
      const s = scope as Partial<LeakScope> | undefined;
      if (typeof s?.teacherId !== 'string' || !isIds(s.allowedModuleIds)) {
        return Promise.reject(scopeError('leakCheck'));
      }
      if (!isIds(candidates)) {
        return Promise.reject(new Error('memoryRetrieval.leakCheck: candidates must be strings'));
      }
      leakChecks.push({
        candidates: candidates.length,
        scope: { teacherId: s.teacherId, allowedModuleIds: [...s.allowedModuleIds] },
      });
      const fixed = opts.leakCheck;
      if (fixed instanceof Error) return Promise.reject(fixed);
      if (fixed !== undefined) return Promise.resolve({ hit: fixed });
      const [inside, outside] = moduleTexts(chunks, s.teacherId, new Set(s.allowedModuleIds));
      return Promise.resolve({ hit: lockedIndex(outside, inside).hits(candidates) });
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
