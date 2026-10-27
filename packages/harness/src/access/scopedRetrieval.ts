// The one place the harness reads a RetrievalIndex for a turn (task 5.4; build plan § Access
// filter, ADR-0003 points 2, 3 and 5). The scope is fixed from the server-side entitlement, so a
// caller cannot widen it, and what the index returns is checked again before it is passed on:
// - search: asks only for the entitlement's teacher and allowed modules, then re-checks every
//   chunk (teacher, allowed, not locked). One stray chunk throws RetrievalScopeError; the error
//   names ids only. Results are fresh objects holding only the Chunk fields, at most k of them.
// - probeLocked: asks only for the locked modules and passes on a fresh `{ hit, score }`, so an
//   index that adds text or any other key passes none of it on (code-only probe).
import {
  ChunkSchema,
  SourceRefSchema,
  type Chunk,
  type Entitlement,
  type RetrievalIndex,
} from '@edmate/contracts';
import { z } from 'zod';
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

/**
 * A non-strict view of the contracts Chunk schema (5.4a): extra top-level keys an index attaches
 * are still silently dropped (unlike `ChunkSchema` itself, which is `strictObject` and would
 * reject them), but every known field is now type-checked -- a non-string `text`/`id`/etc. fails
 * the parse instead of being copied through unchecked. `source` is nested the same way (it is
 * `strictObject` too), so an extra key an index attaches there (e.g. a leaking `leak` field) is
 * dropped rather than failing the whole parse.
 */
const ChunkFields = z.object({ ...ChunkSchema.shape, source: z.object(SourceRefSchema.shape) });

/**
 * Defence in depth (ADR-0003): every chunk must be the entitlement's teacher's, in an allowed
 * module and not in a locked one. One stray chunk fails the whole search instead of being dropped
 * quietly, so the trace shows the fallback. The message names ids only, never chunk text; the id
 * is always the schema-parsed one (1-128 safe characters), so embedding it is safe by
 * construction, not by escaping.
 */
export function checkScope(chunks: unknown, e: Scope): Chunk[] {
  if (!Array.isArray(chunks)) {
    throw new RetrievalScopeError('the retrieval index did not return a list of chunks');
  }
  const allowed = new Set(e.allowedModuleIds);
  const locked = new Set(e.lockedModuleIds);
  return chunks.map((raw: unknown, i) => {
    const parsed = ChunkFields.safeParse(raw);
    if (!parsed.success) {
      throw new RetrievalScopeError(`result ${String(i)} is not a chunk`);
    }
    // Read and copy from this one parsed snapshot only -- never the raw input again -- so a
    // getter-backed object can't disagree with itself between the scope check and the copy.
    const c = parsed.data;
    if (c.teacherId !== e.teacherId || !allowed.has(c.moduleId) || locked.has(c.moduleId)) {
      throw new RetrievalScopeError(`chunk ${c.id} is outside the entitlement's scope`);
    }
    return c;
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
      if (q === '' || allowedModuleIds.length === 0 || !(Number.isFinite(n) && n > 0)) return [];
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
