// Shared RetrievalIndex contract (task 5.3, ADR-0003 and ADR-0007): one framework-free list of
// cases that every adapter must pass, so the in-memory adapter and the production Postgres adapter
// can never disagree about leakCheck's shape, scope or matching. Each case builds its own world
// (synthetic text only) through the adapter's `make`, then calls the port.
//
// No vitest import: a case throws a plain Error when it fails, and a test file runs each case
// inside its own `it`. Failure messages never quote candidate text.
//
// Fail-closed behaviour under a database error, a timeout or a closed pool (ADR-0007 point 5) is
// adapter-specific (only a real adapter has a database to break), so those injections live next to
// the adapter's own tests; this list covers points 1-4 and the search/probe scope.
import type { Chunk, RetrievalIndex } from '@edmate/contracts';

export type MakeRetrieval = (world: Chunk[]) => Promise<RetrievalIndex>;

export interface RetrievalContractCase {
  name: string;
  run(make: MakeRetrieval): Promise<void>;
}

/** Ids of the contract world. Teacher A has an open, a locked and a draft module; B has one. */
export const CONTRACT = {
  A: 'tch_ctr_a',
  B: 'tch_ctr_b',
  open: 'mod_ctr_a_open',
  locked: 'mod_ctr_a_locked',
  draft: 'mod_ctr_a_draft',
  other: 'mod_ctr_b_one',
} as const;

/** 8+ tokens that exist only in A's locked module (first chunk). */
export const CONTRACT_LOCKED_SPAN = 'Volcanoes form where magma rises through cracks in the crust';
/** A span that runs across A's two locked chunks: end of the first, start of the second. */
const CROSS_SPAN = 'cracks in the crust of the earth basalt lava flows quickly';
const DRAFT_SPAN = 'a draft lesson about glaciers carving deep valleys over thousands';
const OTHER_SPAN = 'teacher b explains that comets carry ice and dust on long orbits';
const OPEN_TEXT = 'Photosynthesis turns sunlight, water and carbon dioxide into sugar in green leaves.';

function chunk(
  id: string,
  teacherId: string,
  moduleId: string,
  text: string,
  documentId = `doc_${moduleId.slice(4)}`,
): Chunk {
  return {
    id,
    teacherId,
    documentId,
    moduleId,
    kind: 'material',
    text,
    source: { title: `${moduleId} notes`, locator: 'p1', kind: 'material' },
  };
}

/** The base world; chunks of one document are listed in source order. */
export function contractWorld(): Chunk[] {
  const { A, B } = CONTRACT;
  return [
    chunk('chk_ctr_open_0', A, CONTRACT.open, OPEN_TEXT),
    chunk('chk_ctr_locked_0', A, CONTRACT.locked, `${CONTRACT_LOCKED_SPAN} of the earth.`),
    chunk(
      'chk_ctr_locked_1',
      A,
      CONTRACT.locked,
      'Basalt lava flows quickly because it holds little silica and stays runny.',
    ),
    chunk('chk_ctr_draft_0', A, CONTRACT.draft, `${DRAFT_SPAN} of slow cold years.`),
    chunk('chk_ctr_other_0', B, CONTRACT.other, `${OTHER_SPAN} around the sun.`),
  ];
}

const scopeA = (allowedModuleIds: string[]) => ({ teacherId: CONTRACT.A, allowedModuleIds });

function fail(message: string): never {
  throw new Error(`retrievalContract: ${message}`);
}

function expectLeak(got: unknown, hit: boolean, what: string): void {
  if (typeof got !== 'object' || got === null) fail(`${what}: not an object`);
  const keys = Object.keys(got);
  if (keys.length !== 1 || keys[0] !== 'hit') fail(`${what}: keys must be exactly ['hit']`);
  if ((got as { hit: unknown }).hit !== hit) fail(`${what}: expected hit=${String(hit)}`);
}

async function rejects(p: Promise<unknown>, what: string): Promise<unknown> {
  const outcome = await p.then(
    () => ({ resolved: true as const }),
    (err: unknown) => ({ resolved: false as const, err }),
  );
  if (outcome.resolved) fail(`${what}: expected a rejection`);
  return outcome.err;
}

type Loose = (a: unknown, b: unknown, c?: unknown) => Promise<unknown>;
const loose = (r: RetrievalIndex, m: 'search' | 'probe' | 'leakCheck'): Loose =>
  (r[m] as unknown as Loose).bind(r);

/** Every message and cause message in an error's chain (and its own string form). */
function errorTexts(err: unknown): string[] {
  const out: string[] = [];
  let e: unknown = err;
  for (let depth = 0; depth < 5 && e !== undefined && e !== null; depth += 1) {
    out.push(String(e));
    if (typeof e === 'object') {
      const o = e as { message?: unknown; stack?: unknown; cause?: unknown };
      out.push(String(o.message), String(o.stack));
      try {
        out.push(JSON.stringify(e));
      } catch {
        // A cyclic error can't be stringified; its message and stack are already in.
      }
      e = o.cause;
    } else {
      e = undefined;
    }
  }
  return out;
}

type Writer = (chunk: unknown, ...rest: unknown[]) => boolean;
interface Stream {
  write: Writer;
}

/** Runs `fn` while recording everything written to the console, stdout and stderr. */
async function captureOutput(fn: () => Promise<void>): Promise<string[]> {
  const seen: string[] = [];
  const record = (args: unknown[]) => {
    for (const a of args) seen.push(typeof a === 'string' ? a : String(a));
  };
  const methods = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;
  const con = (globalThis as unknown as { console: Record<string, (...args: unknown[]) => void> })
    .console;
  const savedConsole = methods.map((m) => con[m]);
  const proc = (globalThis as { process?: { stdout?: Stream; stderr?: Stream } }).process;
  const streams = [proc?.stdout, proc?.stderr].filter((s): s is Stream => s !== undefined);
  const savedWrites = streams.map((s) => s.write);
  methods.forEach((m) => {
    con[m] = (...args: unknown[]) => record(args);
  });
  streams.forEach((s, i) => {
    const original = savedWrites[i] as Writer;
    s.write = (chunk: unknown, ...rest: unknown[]) => {
      record([chunk]);
      return original.call(s, chunk, ...rest);
    };
  });
  try {
    await fn();
  } finally {
    methods.forEach((m, i) => {
      con[m] = savedConsole[i] as (...args: unknown[]) => void;
    });
    streams.forEach((s, i) => {
      s.write = savedWrites[i] as Writer;
    });
  }
  return seen;
}

export const RETRIEVAL_CONTRACT: readonly RetrievalContractCase[] = [
  {
    name: 'leakCheck returns one boolean: { hit: true } on locked text, { hit: false } otherwise',
    async run(make) {
      const r = await make(contractWorld());
      const scope = scopeA([CONTRACT.open]);
      expectLeak(await r.leakCheck([`Sure: ${CONTRACT_LOCKED_SPAN}.`], scope), true, 'locked');
      expectLeak(await r.leakCheck([OPEN_TEXT], scope), false, 'allowed text');
      expectLeak(await r.leakCheck(['short locked words: magma rises'], scope), false, 'short');
      expectLeak(await r.leakCheck([], scope), false, 'empty batch');
      // One bit for the whole batch: a clean candidate next to a leaking one still hits.
      expectLeak(await r.leakCheck(['hello', CONTRACT_LOCKED_SPAN], scope), true, 'batch');
    },
  },
  {
    name: 'leakCheck folds case, punctuation and spacing the shared way',
    async run(make) {
      const r = await make(contractWorld());
      const folded = 'VOLCANOES   form, where "magma" rises -- through cracks in the CRUST';
      expectLeak(await r.leakCheck([folded], scopeOpen()), true, 'folded span');
    },
  },
  {
    name: 'leakCheck checks the complement: a draft or unpackaged module counts as locked',
    async run(make) {
      const r = await make(contractWorld());
      expectLeak(await r.leakCheck([DRAFT_SPAN], scopeOpen()), true, 'draft locked');
      const both = scopeA([CONTRACT.open, CONTRACT.draft]);
      expectLeak(await r.leakCheck([DRAFT_SPAN], both), false, 'draft allowed');
      // Nothing allowed at all: every module of the teacher is outside.
      expectLeak(await r.leakCheck([OPEN_TEXT], scopeA([])), true, 'no allowed module');
    },
  },
  {
    name: 'leakCheck ignores a span that also appears in an allowed module',
    async run(make) {
      const shared = 'one two three four five six seven eight nine';
      const world = [
        ...contractWorld(),
        chunk('chk_ctr_open_1', CONTRACT.A, CONTRACT.open, `allowed ${shared}`),
        chunk('chk_ctr_locked_2', CONTRACT.A, CONTRACT.locked, `locked ${shared} tail`),
      ];
      const r = await make(world);
      expectLeak(await r.leakCheck([shared], scopeOpen()), false, 'shared span');
      expectLeak(await r.leakCheck([`${shared} tail`], scopeOpen()), true, 'span plus locked');
    },
  },
  {
    name: 'leakCheck matches a span across two chunks of one module (source order)',
    async run(make) {
      const r = await make(contractWorld());
      expectLeak(await r.leakCheck([CROSS_SPAN], scopeOpen()), true, 'cross-chunk span');
    },
  },
  {
    name: "leakCheck is per teacher: another teacher's material never hits",
    async run(make) {
      const r = await make(contractWorld());
      expectLeak(await r.leakCheck([OTHER_SPAN], scopeOpen()), false, "B's text for A");
      const asB = { teacherId: CONTRACT.B, allowedModuleIds: [CONTRACT.other] };
      expectLeak(await r.leakCheck([CONTRACT_LOCKED_SPAN], asB), false, "A's text for B");
      const unknown = { teacherId: 'tch_ctr_nobody', allowedModuleIds: [] };
      expectLeak(await r.leakCheck([CONTRACT_LOCKED_SPAN], unknown), false, 'unknown teacher');
    },
  },
  {
    name: "leakCheck: allowed ids of another teacher's modules do not widen the allowed set",
    async run(make) {
      // B's module holds A's locked span; naming it as allowed for A must not excuse the span.
      const world = [
        ...contractWorld(),
        chunk('chk_ctr_other_1', CONTRACT.B, CONTRACT.other, `${CONTRACT_LOCKED_SPAN} copy`),
      ];
      const r = await make(world);
      const widened = scopeA([CONTRACT.open, CONTRACT.other, 'mod_ctr_missing']);
      expectLeak(await r.leakCheck([CONTRACT_LOCKED_SPAN], widened), true, 'foreign allowed id');
    },
  },
  {
    name: 'leakCheck rejects a malformed scope or candidate list',
    async run(make) {
      const leak = loose(await make(contractWorld()), 'leakCheck');
      const c = [CONTRACT_LOCKED_SPAN];
      await rejects(leak(c, undefined), 'no scope');
      await rejects(leak(c, { allowedModuleIds: [] }), 'no teacherId');
      await rejects(leak(c, { teacherId: CONTRACT.A }), 'no allowedModuleIds');
      await rejects(leak(c, { teacherId: CONTRACT.A, allowedModuleIds: 'm' }), 'ids not a list');
      await rejects(leak(c, { teacherId: CONTRACT.A, allowedModuleIds: [1] }), 'ids not strings');
      await rejects(leak(c, { teacherId: 7, allowedModuleIds: [] }), 'teacherId not a string');
      await rejects(leak('text', scopeOpen()), 'candidates not a list');
      await rejects(leak([1], scopeOpen()), 'candidates not strings');
    },
  },
  {
    name: 'leakCheck never logs, prints or echoes a candidate (success and failure paths)',
    async run(make) {
      const r = await make(contractWorld());
      const leak = loose(r, 'leakCheck');
      const marker = 'zqxcandidatemarker';
      const candidate = `${marker} ${CONTRACT_LOCKED_SPAN}`;
      const errors: unknown[] = [];
      const output = await captureOutput(async () => {
        await r.leakCheck([candidate], scopeOpen());
        await r.leakCheck([`${marker} clean words only`], scopeOpen());
        errors.push(await rejects(leak([candidate], undefined), 'bad scope'));
        errors.push(await rejects(leak([candidate, 1], scopeOpen()), 'bad candidates'));
      });
      const texts = [...output, ...errors.flatMap(errorTexts)];
      if (texts.some((t) => t.toLowerCase().includes(marker))) {
        fail('a candidate reached the output or an error');
      }
    },
  },
  {
    name: 'search returns only the scope teacher and allowed modules; foreign ids never widen',
    async run(make) {
      const r = await make(contractWorld());
      const q = 'photosynthesis sunlight volcanoes magma comets';
      const scope = scopeA([CONTRACT.open, CONTRACT.other]);
      const out = await r.search(q, scope, 10);
      if (out.length === 0) fail('search: expected the open module to match');
      for (const c of out) {
        if (c.teacherId !== CONTRACT.A || c.moduleId !== CONTRACT.open) {
          fail('search: a chunk outside the scope came back');
        }
      }
      const search = loose(r, 'search');
      await rejects(search(q, undefined, 5), 'search without scope');
      await rejects(search(q, { teacherId: CONTRACT.A }, 5), 'search without allowedModuleIds');
    },
  },
  {
    name: 'probe returns only { hit, score }, for the scope teacher only',
    async run(make) {
      const r = await make(contractWorld());
      const q = 'volcanoes magma';
      const p = await r.probe(q, { teacherId: CONTRACT.A, moduleIds: [CONTRACT.locked] });
      const keys = Object.keys(p).sort();
      if (keys.join(',') !== 'hit,score') fail('probe: keys must be exactly hit and score');
      if (!p.hit || !(p.score > 0 && p.score <= 1)) fail('probe: expected a hit in (0, 1]');
      const asB = await r.probe(q, { teacherId: CONTRACT.B, moduleIds: [CONTRACT.locked] });
      if (asB.hit || asB.score !== 0) fail("probe: another teacher's module must miss");
      const probe = loose(r, 'probe');
      await rejects(probe(q, undefined), 'probe without scope');
      await rejects(probe(q, { teacherId: CONTRACT.A, moduleIds: 'm' }), 'probe ids not a list');
    },
  },
];

function scopeOpen() {
  return scopeA([CONTRACT.open]);
}
