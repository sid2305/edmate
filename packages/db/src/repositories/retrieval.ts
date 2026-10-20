// Task 5.3: hybrid search and probe over the teacher's chunks (build plan § Access filter 2,
// § Ingestion 4; ADR-0003, ADR-0007). Both signals filter by teacher and allowed module in the
// same statement, before ranking; there is no unfiltered search.
import { type Chunk, type ChunkKind, LIMITS, type RetrievalIndex } from '@edmate/contracts';
import { DEFAULT_COVERAGE_THRESHOLD, type LockedIndex, lockedIndex } from '@edmate/harness';
import { and, asc, desc, eq, inArray, isNotNull, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client.js';
import { chunks, modules, teacherMaterialRevisions } from '../schema/index.js';
import { vectorToDriver } from '../schema/_shared.js';
import { EmbeddingSchema } from './chunks.js';
import { RepositoryError } from './errors.js';
import type { Repositories } from './index.js';
import { leakCacheKey, LeakIndexCache } from './leakCache.js';
import { IdSchema, parseArg, teacherScope, type TeacherScope } from './scope.js';

/** Most module ids one call may name (a teacher's whole course fits many times over). */
export const RETRIEVAL_MAX_MODULES = 500;
/** Most chunks one search returns. */
export const SEARCH_MAX_K = 50;
/** Candidates each signal contributes before fusion. */
const PER_SIGNAL = 20;
/** Reciprocal-rank fusion constant. */
const RRF_K = 60;
/** Most query terms used for full text. */
const MAX_TERMS = 32;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

// Calibration (Phase D, measured on the demo Q&A set; see the handoff's "Phase D" table). Every
// score is an absolute 0-1 relevance, never the RRF number, on the scale of the harness's
// DEFAULT_COVERAGE_THRESHOLD (0.5): at or above it a question counts as covered.
//
// Full text: termCoverage (IDF-weighted share of the query's terms the chunk has) times
// `raw / (raw + TEXT_HALF)` of ts_rank_cd, then mapped piecewise so TEXT_PIVOT lands on 0.5.
// Measured (full text only, best of the top 5): 30 in-course questions 0.269-0.983 (27 at or
// above 0.30), 8 out-of-course questions 0-0.318 (1 at or above 0.30). TEXT_PIVOT = 0.30 is the
// round value between them.
//
// Vector: cosine similarity rescaled from VECTOR_ZERO..1. Provisional: the real model's vectors
// are not recorded yet (B-24), and the hashed test embedder says nothing about semantic scores,
// so this stays the identity until the recorded run measures it.
const TEXT_HALF = 0.05;
export const TEXT_PIVOT = 0.3;
const VECTOR_ZERO = 0;
/** A teacher note found only by vector search counts as matching from this score. */
export const NOTE_MATCH_FLOOR = DEFAULT_COVERAGE_THRESHOLD;
/** probe's `hit` threshold: the same "covered" line as the coverage gate. */
export const PROBE_FLOOR = DEFAULT_COVERAGE_THRESHOLD;

/** Monotone map of 0-1 onto 0-1 that sends `pivot` to 0.5 (the coverage threshold). */
export function pivotScale(x: number, pivot: number): number {
  const v = clamp01(x);
  return v < pivot ? (0.5 * v) / pivot : 0.5 + (0.5 * (v - pivot)) / (1 - pivot);
}

/** A short, fixed English stop-word list: these words alone never make a full-text match. */
const STOP_WORDS = new Set(
  (
    'a an and are as at be but by can could did do does for from had has have he her his how i if ' +
    'in into is it its me my no not of on or our she so than that the their them then there these ' +
    'they this to was we were what when where which who why will with would you your ' +
    // Question fillers (Phase D): words that say how a student asks, not what about.
    'actually also any anything just really should something still thing things very want'
  ).split(' '),
);

/**
 * A light English suffix strip before the prefix match (`'simple'` has no stemmer): "dividing"
 * becomes `divid:*`, which also finds "divide" and "division". Only widens a match; a term keeps
 * at least four letters; numbers and words ending in "ss", "is" or "us" are left alone.
 */
export function stemTerm(t: string): string {
  if (/\p{N}/u.test(t) || /(?:ss|is|us)$/.test(t)) return t;
  for (const suffix of ['ies', 'ing', 'ed', 'es', 's']) {
    if (t.endsWith(suffix) && t.length - suffix.length >= 4) return t.slice(0, -suffix.length);
  }
  return t;
}

const ModuleIdsSchema = z.array(IdSchema).max(RETRIEVAL_MAX_MODULES);
const QuerySchema = z.string().max(LIMITS.turnTextMaxLength);

const SearchInputSchema = z.strictObject({
  q: QuerySchema,
  k: z.int().min(1).max(SEARCH_MAX_K),
  embedding: EmbeddingSchema.optional(),
});
const ProbeInputSchema = z.strictObject({
  q: QuerySchema,
  embedding: EmbeddingSchema.optional(),
});

export interface SearchInput {
  q: string;
  allowedModuleIds: string[];
  k: number;
  /** The query's embedding; without it the search is full text only. */
  embedding?: number[];
}
export interface ProbeInput {
  q: string;
  moduleIds: string[];
  embedding?: number[];
}

/**
 * One term as a quoted tsquery prefix literal (`'term':*`), with `'` and `\\` escaped (5.4).
 * Quoted, any text parses as a literal: tsquery syntax, spaces or a character the Postgres parser
 * reads differently from JavaScript can't raise (every code point was checked on Postgres 16).
 */
export function tsTerm(t: string): string {
  return `'${t.replace(/\\/g, '\\\\').replace(/'/g, "''")}':*`;
}

/**
 * Prefix tsquery (`'term':* | 'term':*`) from the query's words, or null when none is left. Each
 * term is quoted (tsTerm); the whole string is one parameter.
 */
export function ftsQuery(q: string): string | null {
  const terms = queryTerms(q);
  return terms.length === 0 ? null : terms.map(tsTerm).join(' | ');
}

/** The query's distinct full-text terms: letters and digits only, stop words dropped. */
export function queryTerms(q: string): string[] {
  const terms = new Set<string>();
  for (const m of q.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)) {
    const t = m[0];
    if (STOP_WORDS.has(t) || (t.length < 2 && !/\p{N}/u.test(t))) continue;
    terms.add(stemTerm(t));
    if (terms.size === MAX_TERMS) break;
  }
  return [...terms];
}

/**
 * How much of the query a chunk answers: the IDF-weighted share of the query's terms it contains.
 * IDF is over the searched chunks, smoothed so a term no chunk has weighs most: a question whose
 * rare words the material never mentions scores low even when its common words match.
 */
export function termCoverage(
  matched: readonly string[],
  df: ReadonlyMap<string, number>,
  n: number,
): number {
  const idf = (t: string) => Math.log((n + 1) / ((df.get(t) ?? 0) + 0.5));
  let all = 0;
  for (const w of df.keys()) all += idf(w);
  let got = 0;
  for (const t of new Set(matched)) if (df.has(t)) got += idf(t);
  // `all` > 0: every term's df is at most n, so each idf is positive.
  return clamp01(got / all);
}

interface Row {
  id: string;
  teacherId: string;
  documentId: string;
  moduleId: string;
  kind: ChunkKind;
  text: string;
  sourceTitle: string;
  locator: string;
}
interface Ranked extends Row {
  rrf: number;
  textScore: number;
  vectorScore: number;
}

/** Ranks the scope's chunks in `moduleIds` (each also checked to be the teacher's). */
async function rank(
  db: Db,
  teacherId: string,
  moduleIds: string[],
  q: string,
  embedding: number[] | undefined,
): Promise<Ranked[]> {
  const terms = queryTerms(q);
  const tsq = ftsQuery(q);
  if (moduleIds.length === 0 || (tsq === null && embedding === undefined)) return [];
  const owned = db.select({ id: modules.id }).from(modules).where(eq(modules.teacherId, teacherId));
  const scope = sql.join(
    [
      eq(chunks.teacherId, teacherId),
      inArray(chunks.moduleId, moduleIds),
      inArray(chunks.moduleId, owned),
    ],
    sql` and `,
  );
  const scoped = (extra: SQL) => sql`${scope} and ${extra}`;
  // Terms are letters and digits only (queryTerms), so a space-joined string is a safe array, and
  // `termQuery` quotes each one like tsTerm (no quote or backslash can be in it to escape).
  const termList = sql`string_to_array(${terms.join(' ')}, ' ')`;
  const termQuery = (t: SQL) => sql`to_tsquery('simple', '''' || ${t} || ''':*')`;
  const fields = {
    id: chunks.id,
    teacherId: chunks.teacherId,
    documentId: chunks.documentId,
    moduleId: chunks.moduleId,
    kind: chunks.kind,
    text: chunks.text,
    sourceTitle: chunks.sourceTitle,
    locator: chunks.locator,
  };

  const textRows = async () => {
    if (tsq === null) return [];
    const query = sql`to_tsquery('simple', ${tsq})`;
    const raw = sql<number>`ts_rank_cd(${chunks.search}, ${query})::float8`;
    const matched = sql<
      string[]
    >`array(select t from unnest(${termList}) as t where ${chunks.search} @@ ${termQuery(sql`t`)})`;
    return db
      .select({ ...fields, raw, matched })
      .from(chunks)
      .where(scoped(sql`${chunks.search} @@ ${query}`))
      .orderBy(desc(raw), asc(chunks.id))
      .limit(PER_SIGNAL);
  };
  const vectorRows = async () => {
    if (embedding === undefined) return [];
    const v = sql`${vectorToDriver(embedding)}::vector`;
    const distance = sql<number>`(${chunks.embedding} <=> ${v})::float8`;
    // The id tie-break keeps this an exact scan today (the planner cannot take an HNSW order with
    // a second sort key). Should it ever use the index, pgvector 0.8's iterative scan keeps going
    // until the teacher and module filter has filled the list, instead of filtering ef_search
    // (40) candidates after the scan; SET LOCAL ends with the transaction.
    return db.transaction(async (tx) => {
      await tx.execute(sql`set local hnsw.iterative_scan = strict_order`);
      return tx
        .select({ ...fields, distance })
        .from(chunks)
        .where(scoped(isNotNull(chunks.embedding)))
        .orderBy(asc(distance), asc(chunks.id))
        .limit(PER_SIGNAL);
    });
  };
  /** Each term's document frequency over the searched chunks, and their count. */
  const termStats = async (): Promise<{ df: Map<string, number>; n: number }> => {
    if (tsq === null) return { df: new Map(), n: 0 };
    const [dfRows, countRows] = await Promise.all([
      db.execute<{ term: string; df: number }>(
        sql`select t.term, count(${chunks.id})::int as df from unnest(${termList}) as t(term) left join ${chunks} on ${chunks.search} @@ ${termQuery(sql`t.term`)} and ${scope} group by t.term`,
      ),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(chunks)
        .where(scope),
    ]);
    return {
      df: new Map(dfRows.rows.map((r) => [r.term, Number(r.df)])),
      n: Number(countRows[0]?.n ?? 0),
    };
  };
  const [byText, byVector, stats] = await Promise.all([textRows(), vectorRows(), termStats()]);

  const fused = new Map<string, Ranked>();
  const entry = (r: Row): Ranked => {
    const got = fused.get(r.id);
    if (got) return got;
    const fresh: Ranked = {
      id: r.id,
      teacherId: r.teacherId,
      documentId: r.documentId,
      moduleId: r.moduleId,
      kind: r.kind,
      text: r.text,
      sourceTitle: r.sourceTitle,
      locator: r.locator,
      rrf: 0,
      textScore: 0,
      vectorScore: 0,
    };
    fused.set(r.id, fresh);
    return fresh;
  };
  byText.forEach((r, i) => {
    const e = entry(r);
    e.rrf += 1 / (RRF_K + i + 1);
    const strength = termCoverage(r.matched, stats.df, stats.n) * (r.raw / (r.raw + TEXT_HALF));
    e.textScore = pivotScale(strength, TEXT_PIVOT);
  });
  byVector.forEach((r, i) => {
    const e = entry(r);
    e.rrf += 1 / (RRF_K + i + 1);
    e.vectorScore = clamp01((1 - r.distance - VECTOR_ZERO) / (1 - VECTOR_ZERO));
  });
  // Ties by id (ids are unique), so the order is deterministic.
  return [...fused.values()].sort(
    (a, b) => b.rrf - a.rrf || Number(a.id > b.id) - Number(a.id < b.id),
  );
}

const score = (r: Ranked) => Math.max(r.textScore, r.vectorScore);

/** A matching teacher note: found by full text, or close enough by vector. */
const matchingNote = (r: Ranked) =>
  r.kind === 'teacher_note' && (r.textScore > 0 || score(r) >= NOTE_MATCH_FLOOR);

function toChunk(r: Ranked): Chunk {
  return {
    id: r.id,
    teacherId: r.teacherId,
    documentId: r.documentId,
    moduleId: r.moduleId,
    kind: r.kind,
    text: r.text,
    source: { title: r.sourceTitle, locator: r.locator, kind: r.kind },
    score: score(r),
  };
}

export function retrievalRepo(db: Db) {
  return {
    /**
     * Hybrid search: full text plus (with `embedding`) vector, each filtered by teacher, allowed
     * module and module ownership before ranking; fused by reciprocal rank, then matching teacher
     * notes first (stable). Allowed ids the teacher does not own are ignored.
     */
    async search(scope: TeacherScope, input: SearchInput): Promise<Chunk[]> {
      const method = 'retrieval.search';
      const { teacherId } = teacherScope(scope, method);
      const allowed = moduleIdsOf(input, 'allowedModuleIds', method);
      const { q, k, embedding } = parseArg(
        SearchInputSchema,
        {
          q: input.q,
          k: input.k,
          ...(input.embedding === undefined ? {} : { embedding: input.embedding }),
        },
        method,
      );
      const ranked = await rank(db, teacherId, allowed, q, embedding);
      const notes = ranked.filter(matchingNote);
      const rest = ranked.filter((r) => !matchingNote(r));
      return [...notes, ...rest].slice(0, k).map(toChunk);
    },

    /** ADR-0003: whether the scope's own `moduleIds` match, as `{ hit, score }` only. */
    async probe(scope: TeacherScope, input: ProbeInput): Promise<{ hit: boolean; score: number }> {
      const method = 'retrieval.probe';
      const { teacherId } = teacherScope(scope, method);
      const ids = moduleIdsOf(input, 'moduleIds', method);
      const { q, embedding } = parseArg(
        ProbeInputSchema,
        { q: input.q, ...(input.embedding === undefined ? {} : { embedding: input.embedding }) },
        method,
      );
      const ranked = await rank(db, teacherId, ids, q, embedding);
      const best = ranked.reduce((m, r) => Math.max(m, score(r)), 0);
      return { hit: best >= PROBE_FLOOR, score: best };
    },

    /**
     * Every chunk text of the teacher's own modules, ordered by module, then document, then chunk
     * (chunk ids sort in document order). leakCheck builds its locked index from this; it is
     * never returned through the RetrievalIndex port.
     */
    async material(scope: TeacherScope): Promise<{ moduleId: string; text: string }[]> {
      const method = 'retrieval.material';
      const { teacherId } = teacherScope(scope, method);
      const owned = db
        .select({ id: modules.id })
        .from(modules)
        .where(eq(modules.teacherId, teacherId));
      return db
        .select({ moduleId: chunks.moduleId, text: chunks.text })
        .from(chunks)
        .where(and(eq(chunks.teacherId, teacherId), inArray(chunks.moduleId, owned)))
        .orderBy(asc(chunks.moduleId), asc(chunks.documentId), asc(chunks.id));
    },

    /** The teacher's material revision: 0 before any write, +1 per document or chunk write. */
    async revision(scope: TeacherScope): Promise<number> {
      const method = 'retrieval.revision';
      const { teacherId } = teacherScope(scope, method);
      const rows = await db
        .select({ revision: teacherMaterialRevisions.revision })
        .from(teacherMaterialRevisions)
        .where(eq(teacherMaterialRevisions.teacherId, teacherId));
      return rows[0]?.revision ?? 0;
    },
  };
}

/** Module ids are part of the scope: malformed is `scope`, before any SQL. */
function moduleIdsOf(input: unknown, key: string, method: string): string[] {
  const value =
    typeof input === 'object' && input !== null
      ? (input as Record<string, unknown>)[key]
      : undefined;
  const r = ModuleIdsSchema.safeParse(value);
  if (!r.success) throw new RepositoryError('scope', method);
  return [...new Set(r.data)];
}

/** Why a search ran on full text only: the only thing an embed failure leaves behind. */
export type EmbedFallback = 'embed_failed' | 'embed_timeout' | 'embed_invalid';

export interface RetrievalIndexOptions {
  /** Embeds the query (a `Pick<ModelGateway, 'embed'>`); without it every search is full text. */
  embedder?: { embed(texts: string[]): Promise<number[][]> };
  /** How long to wait for the query embedding before searching on full text alone. */
  embedTimeoutMs?: number;
  /** Told the fixed code of each fallback; never the query or the error. */
  onEmbedFallback?: (code: EmbedFallback) => void;
  /** How long leakCheck may take before it answers `{ hit: true }` (fail closed). */
  leakTimeoutMs?: number;
  /** How long a background build of a locked index may run before it is dropped. */
  leakBuildTimeoutMs?: number;
  /** Told the fixed code each time leakCheck fails closed; never a candidate or the error. */
  onLeakFallback?: (code: LeakFallback) => void;
}

/** Why leakCheck answered `{ hit: true }` without matching. */
export type LeakFallback = 'leak_timeout' | 'leak_failed';

/**
 * Most candidates one leakCheck takes, and the longest one (5.4). The harness's largest
 * legitimate batch comes from one 16 KB text (LIMITS.skillPayloadMaxJsonLength): at most about
 * 16,400 characters per candidate, and about 220 candidates when a 4,000-character student message
 * splits it (test/retrieval-leak.int.test.ts measures both). The caps leave at least 4x headroom.
 */
export const LEAK_CANDIDATES_MAX = 2_048;
export const LEAK_CANDIDATE_MAX_LENGTH = 65_536;

const CandidatesSchema = z
  .array(z.string().max(LEAK_CANDIDATE_MAX_LENGTH))
  .max(LEAK_CANDIDATES_MAX);

const PortSearchScopeSchema = z.strictObject({
  teacherId: IdSchema,
  allowedModuleIds: ModuleIdsSchema,
});
const PortProbeScopeSchema = z.strictObject({ teacherId: IdSchema, moduleIds: ModuleIdsSchema });

/**
 * The production RetrievalIndex over the repositories. The scope is validated before the query
 * is embedded; an embed that fails, times out or returns a bad vector falls back to full text.
 *
 * leakCheck (ADR-0007): the scope and candidates are validated (malformed rejects), then the
 * teacher's revision and owned module ids are read and the locked index for (teacher, revision,
 * owned allowed ids) is taken
 * from an LRU cache, or built from the teacher's own material with the shared `lockedIndex`:
 * each module's chunks joined in order, modules outside `allowedModuleIds` locked, the rest
 * allowed. Another teacher's module ids in the allowed list match none of this teacher's chunks,
 * so they can't widen anything. The whole call races `leakTimeoutMs`; a timeout or any error is
 * `{ hit: true }`. A build that loses the race keeps running, so the next call is warm. Nothing
 * here logs; a fallback reports only its fixed code.
 */
export function retrievalIndexFor(
  repos: Repositories,
  opts: RetrievalIndexOptions = {},
): RetrievalIndex {
  const timeoutMs = opts.embedTimeoutMs ?? 800;
  const leakTimeoutMs = opts.leakTimeoutMs ?? 100;
  const leakCache = new LeakIndexCache<LockedIndex>(
    opts.leakBuildTimeoutMs === undefined ? {} : { buildTimeoutMs: opts.leakBuildTimeoutMs },
  );

  const fallback = (code: EmbedFallback): undefined => {
    try {
      opts.onEmbedFallback?.(code);
    } catch {
      // A failing counter must not fail the search.
    }
    return undefined;
  };

  const leakClosed = (code: LeakFallback): { hit: boolean } => {
    try {
      opts.onLeakFallback?.(code);
    } catch {
      // A failing counter must not open the check.
    }
    return { hit: true };
  };

  /** Builds from the teacher's material; `allowed` is already the owned allowed set. */
  async function buildLockedIndex(teacherId: string, allowed: string[]): Promise<LockedIndex> {
    const rows = await repos.retrieval.material({ teacherId });
    const byModule = new Map<string, string[]>();
    for (const r of rows) {
      const texts = byModule.get(r.moduleId) ?? [];
      texts.push(r.text);
      byModule.set(r.moduleId, texts);
    }
    const allowedSet = new Set(allowed);
    const inside: string[] = [];
    const outside: string[] = [];
    for (const [moduleId, texts] of byModule) {
      (allowedSet.has(moduleId) ? inside : outside).push(texts.join('\n'));
    }
    return lockedIndex(outside, inside);
  }

  async function lockedIndexFor(teacherId: string, allowed: string[]): Promise<LockedIndex> {
    // Revision (and the owned module ids) first, material second: a write in between makes the
    // index newer than its key, never older, so a cached index never misses material its key
    // promises. A module created in between is not in `owned`, so it is built as locked (closed).
    // The key and the build use only the allowed ids the teacher owns (5.4): every package version
    // with the same owned allowed set shares one entry, and foreign or unknown ids can't fill the
    // cache with copies.
    const [revision, ownedIds] = await Promise.all([
      repos.retrieval.revision({ teacherId }),
      repos.modules.ids({ teacherId }),
    ]);
    const ownedSet = new Set(ownedIds);
    const owned = allowed.filter((id) => ownedSet.has(id));
    const key = leakCacheKey(teacherId, revision, owned);
    return leakCache.get(key, () => buildLockedIndex(teacherId, owned));
  }

  async function embedQuery(q: string): Promise<number[] | undefined> {
    const embedder = opts.embedder;
    if (embedder === undefined || !worthEmbedding(q)) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs);
    });
    try {
      const got = await Promise.race([embedder.embed([q]), timeout]);
      if (got === 'timeout') return fallback('embed_timeout');
      const parsed = EmbeddingSchema.safeParse(got[0]);
      return parsed.success ? parsed.data : fallback('embed_invalid');
    } catch {
      return fallback('embed_failed');
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async search(q, scope, k) {
      const parsed = PortSearchScopeSchema.safeParse(scope);
      if (!parsed.success) throw new RepositoryError('scope', 'retrievalIndex.search');
      const { teacherId, allowedModuleIds } = parsed.data;
      const embedding = await embedQuery(q);
      return repos.retrieval.search(
        { teacherId },
        { q, allowedModuleIds, k, ...(embedding === undefined ? {} : { embedding }) },
      );
    },
    async probe(q, scope) {
      const parsed = PortProbeScopeSchema.safeParse(scope);
      if (!parsed.success) throw new RepositoryError('scope', 'retrievalIndex.probe');
      const { teacherId, moduleIds } = parsed.data;
      const embedding = await embedQuery(q);
      const { hit, score: s } = await repos.retrieval.probe(
        { teacherId },
        { q, moduleIds, ...(embedding === undefined ? {} : { embedding }) },
      );
      return { hit, score: s };
    },
    async leakCheck(candidates, scope) {
      const method = 'retrievalIndex.leakCheck';
      const parsed = PortSearchScopeSchema.safeParse(scope);
      if (!parsed.success) throw new RepositoryError('scope', method);
      const list = CandidatesSchema.safeParse(candidates);
      if (!list.success) throw new RepositoryError('invalid', method);
      const { teacherId, allowedModuleIds } = parsed.data;
      const work = lockedIndexFor(teacherId, allowedModuleIds);
      // A build that loses the race finishes in the background; its failure is already closed.
      work.catch(() => undefined);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), leakTimeoutMs);
      });
      try {
        const index = await Promise.race([work, timeout]);
        if (index === 'timeout') return leakClosed('leak_timeout');
        return { hit: index.hits(list.data) };
      } catch {
        return leakClosed('leak_failed');
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Non-blank text; anything else is left for the repository to reject. */
function worthEmbedding(q: unknown): boolean {
  return typeof q === 'string' && q.trim().length > 0;
}
