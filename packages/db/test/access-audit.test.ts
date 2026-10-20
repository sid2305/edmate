// Task 5.4 Phase B: the static "no unfiltered search exists anywhere" audit (build plan § Access
// filter; ADR-0003). It reads the source of every package and app (no database) and fails when a
// new path could reach teacher material without the access filter:
//   1. the `chunks` table is named only in the schema, internal.ts and the chunks/retrieval repos;
//   2. retrieval.ts's reads of `chunks` are pinned in number, and each statement carries the scope;
//   3. `.material(` (all of a teacher's text, locked included) is called only in retrieval.ts;
//   4. only allowlisted files implement RetrievalIndex;
//   5. in harness src, `.search(` / `.probe(` on the index appear only in access/scopedRetrieval.ts
//      and `.leakCheck(` only in guardrails/lockedLeak.ts.
// Each rule also runs on a fixture string that breaks it, so the audit is shown to be able to fail.
// The harness has no Node types, so this lives here; CI runs turbo without a cache.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const SOURCE = /\.(ts|tsx|mts|js|mjs)$/;
const TEST_FILE = /(\.(test|spec)\.[cm]?[jt]sx?$)|(^|\/)(test|tests|__tests__)\//;
const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', '.turbo', 'coverage']);

function walk(dir: string, out: string[]): void {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SOURCE.test(name)) out.push(full);
  }
}

/** Every non-test source file under packages/<pkg>/src and apps/<app>/{src,app}, repo-relative. */
function sourceFiles(): string[] {
  const out: string[] = [];
  for (const top of ['packages', 'apps']) {
    for (const pkg of readdirSync(join(ROOT, top))) {
      for (const sub of top === 'apps' ? ['src', 'app'] : ['src'])
        walk(join(ROOT, top, pkg, sub), out);
    }
  }
  return out.map((f) => relative(ROOT, f).split('\\').join('/')).filter((f) => !TEST_FILE.test(f));
}

/** The text without comments, so prose like "text from chunks" can't trip a rule. */
export function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

const RETRIEVAL = 'packages/db/src/repositories/retrieval.ts';
const CHUNKS_ALLOWED = [
  /^packages\/db\/src\/schema\//,
  /^packages\/db\/src\/internal\.ts$/,
  /^packages\/db\/src\/repositories\/(chunks|retrieval)\.ts$/,
];
const INDEX_IMPLEMENTERS = new Set([
  // The port itself (an interface: it declares the methods and implements nothing).
  'packages/contracts/src/ports.ts',
  RETRIEVAL,
  'packages/harness/src/testing/memoryRetrieval.ts',
  'packages/harness/src/testing/testSteps.ts',
  'packages/harness/src/testing/hostileRetrieval.ts',
]);
const HARNESS_SRC = 'packages/harness/src/';
/** Harness files that may call the index's search/probe: the filter, and test-only helpers. */
const SEARCH_CALLERS = new Set([
  'packages/harness/src/access/scopedRetrieval.ts',
  'packages/harness/src/testing/memoryRetrieval.ts',
  'packages/harness/src/testing/testSteps.ts',
  'packages/harness/src/testing/hostileRetrieval.ts',
  'packages/harness/src/testing/retrievalContract.ts',
]);
const LEAK_CALLERS = new Set([
  'packages/harness/src/guardrails/lockedLeak.ts',
  'packages/harness/src/testing/hostileRetrieval.ts',
  'packages/harness/src/testing/retrievalContract.ts',
]);
/** Reads of the chunks table in retrieval.ts: textRows, vectorRows, the count, material; the df join. */
export const PINNED_CHUNK_READS = 5;

/** Rule 1: the file names the chunks table (schema import, namespace member or SQL text). */
export function namesChunksTable(text: string): boolean {
  const c = code(text);
  const imported = [
    ...c.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g),
  ].some(
    ([, names = '', from = '']) =>
      /(schema|internal|@edmate\/db)/.test(from) &&
      names.split(',').some((n) => n.trim().split(/\s+as\s+/)[0] === 'chunks'),
  );
  const member = /\b(?:s|schema|tables)\.chunks\b/.test(c);
  const sqlText = /\b(?:from|join|update|into)\s+"?chunks"?\b/i.test(c);
  return imported || member || sqlText;
}

/** Rule 2: each read of chunks in `text`, with whether its statement carries the scope. */
export function chunkReads(text: string): { at: number; scoped: boolean }[] {
  const c = code(text);
  return [...c.matchAll(/\.from\(chunks\)|\$\{chunks\}/g)].map((m) => {
    const end = c.indexOf(';', m.index);
    const statement = c.slice(m.index, end === -1 ? undefined : end);
    return { at: m.index, scoped: /\bscope\b|\bscoped\(|chunks\.teacherId/.test(statement) };
  });
}

/** Rule 3: the file calls `.material(`. */
export const callsMaterial = (text: string) => /\.material\s*\(/.test(code(text));

/** `text` without '...' and "..." strings (test names, messages); template literals stay. */
export function noStrings(text: string): string {
  return text.replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, "''");
}

/** The argument count of each `.name(` call in `c` (brackets balanced; a trailing comma ignored). */
export function callArity(c: string, name: string): number[] {
  const out: number[] = [];
  for (const m of c.matchAll(new RegExp(`\\.\\s*${name}\\s*\\(`, 'g'))) {
    let depth = 0;
    let commas = 0;
    let last = '';
    for (let i = m.index + m[0].length; i < c.length; i += 1) {
      const ch = c[i] ?? '';
      if (depth === 0 && ch === ')') break;
      if ('([{'.includes(ch)) depth += 1;
      else if (')]}'.includes(ch)) depth -= 1;
      else if (depth === 0 && ch === ',') commas += 1;
      if (!/\s/.test(ch)) last = ch;
    }
    out.push(last === '' ? 0 : commas + 1 - (last === ',' ? 1 : 0));
  }
  return out;
}

/** Rule 4: the file builds a RetrievalIndex (returns one, implements one or defines leakCheck). */
export function implementsIndex(text: string): boolean {
  const c = noStrings(code(text));
  return (
    /\)\s*:\s*RetrievalIndex\b|\b(?:implements|satisfies)\s+RetrievalIndex\b|:\s*RetrievalIndex\s*=/.test(
      c,
    ) || /(?<![.\w])(?:async\s+)?leakCheck\s*[:(]/.test(c)
  );
}

/**
 * Rule 5: index-shaped calls (`search(q, scope, k)`: three arguments; `probe(q, scope)`: two; the
 * scoped wrapper's `search(q, k)` and String's `search(re)` have fewer) or a `retrieval.` member.
 */
export function callsSearchOrProbe(text: string): boolean {
  const c = noStrings(code(text));
  return (
    callArity(c, 'search').some((n) => n >= 3) ||
    callArity(c, 'probe').some((n) => n >= 2) ||
    /\bretrieval\s*\.\s*(?:search|probe)\b/.test(c)
  );
}
/** Rule 5: a `.leakCheck(` call, or the `retrieval.leakCheck` member passed on. */
export function callsLeakCheck(text: string): boolean {
  const c = noStrings(code(text));
  return /\.\s*leakCheck\s*\(/.test(c) || /\bretrieval\s*\.\s*leakCheck\b/.test(c);
}

const files = sourceFiles();
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');

describe('no unfiltered search exists anywhere (static audit)', () => {
  it('scans the packages and apps', () => {
    expect(files).toContain(RETRIEVAL);
    expect(files).toContain('packages/harness/src/access/scopedRetrieval.ts');
    expect(files.some((f) => f.startsWith('apps/'))).toBe(true);
    expect(files.some((f) => TEST_FILE.test(f))).toBe(false);
  });

  it('1. the chunks table is named only in the schema, internal.ts and the chunks/retrieval repos', () => {
    const named = files.filter((f) => namesChunksTable(read(f)));
    expect(named).toContain(RETRIEVAL);
    expect(named.filter((f) => !CHUNKS_ALLOWED.some((r) => r.test(f)))).toEqual([]);
  });

  it(`2. retrieval.ts reads chunks exactly ${PINNED_CHUNK_READS} times, each in a scoped statement`, () => {
    const reads = chunkReads(read(RETRIEVAL));
    expect(reads).toHaveLength(PINNED_CHUNK_READS);
    expect(reads.filter((r) => !r.scoped)).toEqual([]);
  });

  it('3. retrieval.material is called only in retrieval.ts', () => {
    expect(files.filter((f) => callsMaterial(read(f)))).toEqual([RETRIEVAL]);
  });

  it('4. only allowlisted files implement RetrievalIndex', () => {
    const found = files.filter((f) => implementsIndex(read(f)));
    expect(found).toContain(RETRIEVAL);
    expect(found.filter((f) => !INDEX_IMPLEMENTERS.has(f))).toEqual([]);
  });

  it('5. in harness src, the index is searched only by access/scopedRetrieval and leak-checked only by lockedLeak', () => {
    const harness = files.filter((f) => f.startsWith(HARNESS_SRC));
    const searchers = harness.filter((f) => callsSearchOrProbe(read(f)));
    expect(searchers).toContain('packages/harness/src/access/scopedRetrieval.ts');
    expect(searchers.filter((f) => !SEARCH_CALLERS.has(f))).toEqual([]);
    const leakers = harness.filter((f) => callsLeakCheck(read(f)));
    expect(leakers).toContain('packages/harness/src/guardrails/lockedLeak.ts');
    expect(leakers.filter((f) => !LEAK_CALLERS.has(f))).toEqual([]);
  });
});

describe('each rule fails on a fixture that breaks it', () => {
  it('1. a schema import, a namespace member or SQL text naming chunks', () => {
    expect(namesChunksTable(`import { chunks, modules } from '../schema/index.js';`)).toBe(true);
    expect(namesChunksTable(`import { modules, chunks as c } from '@edmate/db/internal';`)).toBe(
      true,
    );
    expect(namesChunksTable('db.select().from(s.chunks)')).toBe(true);
    expect(namesChunksTable('sql`select text from chunks where true`')).toBe(true);
    expect(namesChunksTable('sql`select 1 from x join "chunks" on true`')).toBe(true);
    // Not the table: prose in comments, the repo member, other imports.
    expect(namesChunksTable('// returns text from chunks\nconst a = repos.chunks;')).toBe(false);
    expect(namesChunksTable(`import { chunksRepo } from './chunks.js';`)).toBe(false);
  });

  it('2. an extra read, or a read without the scope in its statement', () => {
    const scoped = 'db.select().from(chunks).where(scope);';
    const bare = 'db.select({ t: chunks.text }).from(chunks).limit(5);';
    expect(chunkReads(scoped)).toEqual([{ at: expect.any(Number), scoped: true }]);
    expect(chunkReads(bare)).toEqual([{ at: expect.any(Number), scoped: false }]);
    expect(chunkReads('sql`select * from ${chunks} where true`;')[0]?.scoped).toBe(false);
    expect(
      chunkReads('sql`select * from ${chunks} where ${chunks.teacherId} = 1`;')[0]?.scoped,
    ).toBe(true);
    expect(chunkReads(`${read(RETRIEVAL)}\n${bare}`)).toHaveLength(PINNED_CHUNK_READS + 1);
  });

  it('3. a .material( call', () => {
    expect(callsMaterial('const all = await repos.retrieval.material({ teacherId });')).toBe(true);
    expect(callsMaterial('const x = r.material ;')).toBe(false);
  });

  it('4. a returned, satisfied or annotated RetrievalIndex, or a leakCheck member', () => {
    expect(implementsIndex('export function idx(): RetrievalIndex { return x; }')).toBe(true);
    expect(
      implementsIndex('const r = { search, probe, leakCheck } satisfies RetrievalIndex;'),
    ).toBe(true);
    expect(implementsIndex('const r: RetrievalIndex = make();')).toBe(true);
    expect(implementsIndex('const r = { leakCheck: () => Promise.resolve({ hit: false }) };')).toBe(
      true,
    );
    expect(implementsIndex('const r = { async leakCheck(c, s) { return { hit: false }; } };')).toBe(
      true,
    );
    expect(implementsIndex('await o.retrieval.leakCheck(c, s);')).toBe(false);
    expect(implementsIndex(`it("leakCheck: a test name", f);`)).toBe(false);
  });

  it('5. an index search or probe outside access, and a leakCheck outside lockedLeak', () => {
    expect(callsSearchOrProbe('await ctx.retrieval.search(q, scope, 5);')).toBe(true);
    expect(callsSearchOrProbe('await index.probe(\n  q,\n  { teacherId, moduleIds },\n);')).toBe(
      true,
    );
    expect(callsSearchOrProbe('const f = deps.retrieval.search;')).toBe(true);
    // String.prototype.search takes one argument.
    expect(callsSearchOrProbe('const i = text.search(/[.!?\\n]/);')).toBe(false);
    expect(callsSearchOrProbe('const found = await scoped.search(q, RETRIEVAL_K);')).toBe(false);
    expect(callsSearchOrProbe('index.search(q, { ids: dedup(a, b) }, k,)')).toBe(true);
    expect(callsSearchOrProbe('x.probe()')).toBe(false);
    expect(callArity('a.search(f(1, 2), [3, 4], { a, b }, k,)', 'search')).toEqual([4]);
    expect(callsLeakCheck('await o.retrieval.leakCheck(c, s);')).toBe(true);
    expect(callsLeakCheck('const f = o.retrieval.leakCheck;')).toBe(true);
    expect(callsLeakCheck('const hits = index.hits(c);')).toBe(false);
    expect(callsLeakCheck('if (opts.leakCheck instanceof Error) return;')).toBe(false);
  });

  it('comments are ignored but URLs inside strings are kept', () => {
    expect(code('a /* from chunks */ b // .material(\nc')).toBe('a   b \nc');
    expect(code("const u = 'https://x.test/a';")).toBe("const u = 'https://x.test/a';");
  });
});
