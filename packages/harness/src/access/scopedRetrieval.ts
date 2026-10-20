// The one place the harness reads a RetrievalIndex for a turn (task 5.4; build plan § Access
// filter, ADR-0003 points 2, 3 and 5). The scope is fixed from the server-side entitlement, so a
// caller cannot widen it, and what the index returns is checked again before it is passed on:
// - search: asks only for the entitlement's teacher and allowed modules, then re-checks every
//   chunk (teacher, allowed, not locked). One stray chunk throws RetrievalScopeError; the error
//   names ids only. Results are fresh objects holding only the Chunk fields, at most k of them.
// - probeLocked: asks only for the locked modules and passes on a fresh `{ hit, score }`, so an
//   index that adds text or any other key passes none of it on (code-only probe).
import type { Chunk, Entitlement, RetrievalIndex } from '@edmate/contracts';
import { HarnessError } from '../pipeline/errors.js';

/** The index returned something outside the entitlement's scope: refused, never passed on. */
export class RetrievalScopeError extends HarnessError {
  override readonly name = 'RetrievalScopeError';
}

export interface LockedProbe {
  hit: boolean;
  score: number;
}

export interface ScopedRetrieval {
  /** Chunks of the entitlement's allowed modules, best first, at most `k`. */
  search(q: string, k: number): Promise<Chunk[]>;
  /** Whether the query matches the entitlement's locked modules; never any text. */
  probeLocked(q: string): Promise<LockedProbe>;
}

type Scope = Pick<Entitlement, 'teacherId' | 'allowedModuleIds' | 'lockedModuleIds'>;

const NO_HIT: LockedProbe = { hit: false, score: 0 };

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;

/** Exactly the Chunk fields, copied; nothing else an index attaches is kept. */
function copyChunk(c: Chunk): Chunk {
  const out: Chunk = {
    id: c.id,
    teacherId: c.teacherId,
    documentId: c.documentId,
    moduleId: c.moduleId,
    kind: c.kind,
    text: c.text,
    source: { title: c.source.title, locator: c.source.locator, kind: c.source.kind },
  };
  if (c.score !== undefined) out.score = c.score;
  return out;
}

/**
 * Defence in depth (ADR-0003): every chunk must be the entitlement's teacher's, in an allowed
 * module and not in a locked one. One stray chunk fails the whole search instead of being dropped
 * quietly, so the trace shows the fallback. The message names ids only, never chunk text.
 */
export function checkScope(chunks: unknown, e: Scope): Chunk[] {
  if (!Array.isArray(chunks)) {
    throw new RetrievalScopeError('the retrieval index did not return a list of chunks');
  }
  const allowed = new Set(e.allowedModuleIds);
  const locked = new Set(e.lockedModuleIds);
  return chunks.map((raw: unknown, i) => {
    if (!isObject(raw) || !isObject(raw.source)) {
      throw new RetrievalScopeError(`result ${String(i)} is not a chunk`);
    }
    const c = raw as unknown as Chunk;
    if (c.teacherId !== e.teacherId || !allowed.has(c.moduleId) || locked.has(c.moduleId)) {
      throw new RetrievalScopeError(`chunk ${String(c.id)} is outside the entitlement's scope`);
    }
    return copyChunk(c);
  });
}

/** A finite score clamped to 0..1; anything else is 0. */
function clamp01(x: unknown): number {
  if (typeof x !== 'number' || !Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

export function scopedRetrieval(index: RetrievalIndex, e: Scope): ScopedRetrieval {
  const teacherId = e.teacherId;
  const allowedModuleIds = [...new Set(e.allowedModuleIds)];
  const lockedModuleIds = [...new Set(e.lockedModuleIds)];
  return {
    async search(q, k) {
      const n = Math.floor(k);
      if (q === '' || allowedModuleIds.length === 0 || !(n > 0)) return [];
      const found: unknown = await index.search(
        q,
        { teacherId, allowedModuleIds: [...allowedModuleIds] },
        n,
      );
      return checkScope(found, e).slice(0, n);
    },
    async probeLocked(q) {
      if (q === '' || lockedModuleIds.length === 0) return { ...NO_HIT };
      const raw: unknown = await index.probe(q, { teacherId, moduleIds: [...lockedModuleIds] });
      // Only a real `true` counts; nothing else from the result is read (no text, ADR-0003).
      if (!isObject(raw)) return { ...NO_HIT };
      return { hit: raw.hit === true, score: clamp01(raw.score) };
    },
  };
}
