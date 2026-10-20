// Hostile RetrievalIndex wrappers over `memoryRetrieval` for the access-filter tests (task 5.4),
// plus a random "marked" world where every chunk's text carries its own marker, so a test can
// show that no out-of-scope chunk's text reaches a result. Synthetic data only.
//
// - widening: search ignores the scope's module filter and teacher (every teacher, every module).
// - textLeaking: search is honest but adds an extra key holding out-of-scope text to each chunk;
//   probe adds the locked modules' text.
// - junkProbe: search is honest; probe returns whatever value it is given (extra keys, NaN, ...).
import type { Chunk, RetrievalIndex } from '@edmate/contracts';
import { memoryRetrieval } from './memoryRetrieval.js';
import type { Prng } from './prng.js';

type SearchScope = Parameters<RetrievalIndex['search']>[1];

/** The text marker of a chunk in a marked world; unique per chunk id (no prefix collisions). */
export const markOf = (chunkId: string): string => `MARK_${chunkId}_END`;

export const MARKED_TEACHERS = ['tch_pa', 'tch_pb', 'tch_pc'] as const;
/** Every teacher may have chunks in any of these ids, so the teacher check matters too. */
export const MARKED_MODULES = ['mod_p1', 'mod_p2', 'mod_p3', 'mod_p4', 'mod_p5', 'mod_p6'] as const;
export const MARKED_VOCAB = [
  'fractions',
  'denominator',
  'algebra',
  'graph',
  'motion',
  'energy',
  'cells',
  'verbs',
] as const;

/**
 * Random chunks: each teacher has 1-3 chunks in about 70% of the module ids. Every chunk's text
 * is its marker plus 3 vocabulary words.
 */
export function markedWorld(r: Prng, teachers: readonly string[] = MARKED_TEACHERS): Chunk[] {
  const out: Chunk[] = [];
  for (const teacherId of teachers) {
    for (const moduleId of MARKED_MODULES) {
      if (!r.chance(0.7)) continue;
      const n = 1 + r.int(3);
      for (let i = 0; i < n; i++) {
        const id = `chk_${teacherId}_${moduleId}_${String(i)}`;
        const words = [r.pick(MARKED_VOCAB), r.pick(MARKED_VOCAB), r.pick(MARKED_VOCAB)];
        out.push({
          id,
          teacherId,
          documentId: `doc_${teacherId}`,
          moduleId,
          kind: 'material',
          text: `${markOf(id)} ${words.join(' ')}`,
          source: { title: `Notes ${moduleId}`, locator: `p. ${String(i + 1)}`, kind: 'material' },
        });
      }
    }
  }
  return out;
}

const teachersOf = (chunks: readonly Chunk[]) => [...new Set(chunks.map((c) => c.teacherId))];
const modulesOf = (chunks: readonly Chunk[], teacherId: string) => [
  ...new Set(chunks.filter((c) => c.teacherId === teacherId).map((c) => c.moduleId)),
];

/** Chunk texts outside a search scope (other teachers, or modules not allowed). */
function outsideText(chunks: readonly Chunk[], scope: SearchScope): string {
  const allowed = new Set(scope.allowedModuleIds);
  return chunks
    .filter((c) => c.teacherId !== scope.teacherId || !allowed.has(c.moduleId))
    .map((c) => c.text)
    .join('\n');
}

/** search returns matches from every teacher and every module, best first, up to k per teacher. */
export function wideningRetrieval(chunks: readonly Chunk[]): RetrievalIndex {
  const inner = memoryRetrieval({ chunks });
  return {
    async search(q, _scope, k) {
      const all: Chunk[] = [];
      for (const teacherId of teachersOf(chunks)) {
        all.push(
          ...(await inner.search(
            q,
            { teacherId, allowedModuleIds: modulesOf(chunks, teacherId) },
            k,
          )),
        );
      }
      return all.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    },
    probe: (q, scope) => inner.probe(q, scope),
    leakCheck: (c, scope) => inner.leakCheck(c, scope),
  };
}

/** Honest ids, but each chunk and each probe result carries out-of-scope text in an extra key. */
export function textLeakingRetrieval(chunks: readonly Chunk[]): RetrievalIndex {
  const inner = memoryRetrieval({ chunks });
  return {
    async search(q, scope, k) {
      const leak = outsideText(chunks, scope);
      return (await inner.search(q, scope, k)).map((c) => ({
        ...c,
        leak,
        source: { ...c.source, leak } as Chunk['source'],
      }));
    },
    async probe(q, scope) {
      const ids = new Set(scope.moduleIds);
      const text = chunks
        .filter((c) => c.teacherId === scope.teacherId && ids.has(c.moduleId))
        .map((c) => c.text)
        .join('\n');
      return { ...(await inner.probe(q, scope)), text, marker: text };
    },
    leakCheck: (c, scope) => inner.leakCheck(c, scope),
  };
}

/** Honest search; probe answers `raw` as is, whatever its shape. */
export function junkProbeRetrieval(chunks: readonly Chunk[], raw: unknown): RetrievalIndex {
  const inner = memoryRetrieval({ chunks });
  return {
    search: (q, scope, k) => inner.search(q, scope, k),
    probe: () => Promise.resolve(raw as { hit: boolean; score: number }),
    leakCheck: (c, scope) => inner.leakCheck(c, scope),
  };
}
