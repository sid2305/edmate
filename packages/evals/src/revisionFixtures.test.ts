// Task 5.9 acceptance: "notes and flashcards cite sources and cover only allowed modules."
// Mechanism-only (no live model, rule 4; modelled on groundingFixtures.test.ts's chunk-map setup,
// not a full `runTurn`): the real `decidePolicy` and `composeSystemPrompt` are called directly
// against the real, already-signed `revision@1.0.0` and `move-explain` pack text (the real
// `content/prompt-packs/set@1.1.0.yaml`, parsed the same way `@edmate/content`'s loader does, kept
// local to this file so `packages/evals` gains no new dependency), the demo teacher's real notes
// (one chunk per numbered section, as in groundingFixtures.test.ts) and the real paid package's
// entitlement (content/demo-teacher/packages/paid.yaml).
//
// Not circular:
//   - the retrieved sections are real notes.md text, never the cases' phrases;
//   - each case's hand-written "good" reply is a stub a model never produced: it cites every
//     point with the chunk map's own `[n]` numbers and invents nothing; the "bad" stub either
//     drops every citation, or (the locked-module and empty-material edge cases) adds a claim
//     from outside the retrieved material;
//   - the UNGUARDED bad stub fails the case's own checks, exactly as the good stub passes them;
//   - mutation: a chunk from outside `paid.yaml`'s modules injected into `ctx.retrieved` makes
//     `composeSystemPrompt` throw `LockedMaterialError`, proving the revision skill does not
//     bypass the composer's own defence-in-depth check (5.4's property test already proves the
//     access filter itself; this is not a re-run of that).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Chunk, Entitlement, PackageConfig, SourceRef, TurnContext } from '@edmate/contracts';
import {
  composeSystemPrompt,
  decidePolicy,
  INITIAL_HELP_STATE,
  LockedMaterialError,
  type PackKind,
  parsePromptPackSet,
  type PromptPackSet,
  type RawPromptPackSet,
} from '@edmate/harness';
import {
  demoEntitlementSubscription,
  demoPackagePaid,
  turnContextFull,
} from '@edmate/harness/testing';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { checkMustContain, checkMustNotContain } from './checks/string.js';
import { loadCasesFromDir } from './loader.js';
import type { EvalCase } from './schema.js';

const DIR = fileURLToPath(new URL('../../../evals/suites/revision/', import.meta.url));
const CONTENT = fileURLToPath(new URL('../../../content/demo-teacher/', import.meta.url));
const PACKS_DIR = fileURLToPath(new URL('../../../content/prompt-packs/', import.meta.url));
const CASES = loadCasesFromDir(DIR);
const read = (rel: string) => readFileSync(`${CONTENT}${rel}`, 'utf8');
const readPack = (rel: string) => readFileSync(`${PACKS_DIR}${rel}`, 'utf8');

// ---- the real prompt-pack set (content/prompt-packs/set@1.1.0.yaml), parsed from the files ------
// This is the one set already reviewed and pinned (task 3.11), unchanged by this task; it is
// parsed here (front matter + body, same layout @edmate/content's loader reads) so the composer
// renders revision@1.0.0's and frame@1.0.0's real, signed-off text, not the harness's synthetic
// `fixturePromptPackSet`.

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

function parsePackFile(file: string): { kind: string; reviewedBy: string; body: string } {
  const raw = readPack(file);
  const m = FRONT_MATTER.exec(raw);
  if (m === null) throw new Error(`${file}: no front matter`);
  const front = m[1] as string;
  const field = (name: string) => new RegExp(`^${name}: (.+)$`, 'm').exec(front)?.[1];
  const kind = field('kind');
  const reviewedBy = field('reviewed_by');
  if (kind === undefined || reviewedBy === undefined) throw new Error(`${file}: missing front matter field`);
  return { kind, reviewedBy, body: raw.slice(m[0].length).trimEnd() };
}

interface Manifest {
  version: string;
  reviewed_by: string;
  packs: Record<string, string>;
}
const MANIFEST = load(readPack('set@1.1.0.yaml')) as Manifest;
const REAL_SET: PromptPackSet = parsePromptPackSet({
  version: MANIFEST.version,
  reviewedBy: MANIFEST.reviewed_by,
  packs: Object.fromEntries(
    Object.entries(MANIFEST.packs).map(([name, version]) => {
      const p = parsePackFile(`${name}@${version}.md`);
      return [name, { version, kind: p.kind as PackKind, reviewedBy: p.reviewedBy, body: p.body }];
    }),
  ),
} satisfies RawPromptPackSet);

// ---- the demo teacher's notes, one chunk per `## N.N` section (as groundingFixtures.test.ts) -----

const MODULE_ID: Readonly<Record<string, string>> = {
  'values-variables': 'mod_test_01',
  conditions: 'mod_test_02',
  loops: 'mod_test_04',
  functions: 'mod_test_05',
  'lists-dicts': 'mod_test_06',
};
const SLUGS = Object.keys(MODULE_ID);

const SECTIONS = new Map<string, Chunk>();
for (const slug of SLUGS) {
  const notes = read(`modules/${slug}/notes.md`);
  const title = (notes.split('\n')[0] ?? '').replace(/^# /, '');
  for (const part of notes.split(/^(?=## )/m).slice(1)) {
    const no = /^## (\d+\.\d+)/.exec(part)?.[1];
    if (no === undefined) continue;
    const source: SourceRef = { title, locator: `§${no}`, kind: 'material' };
    SECTIONS.set(`${slug}:${no}`, {
      id: `chk_demo_${slug.replace('-', '_')}_${no.replace('.', '_')}`,
      teacherId: demoEntitlementSubscription.teacherId,
      documentId: 'doc_test_01',
      moduleId: MODULE_ID[slug] as string,
      kind: 'material',
      text: `${title}\n\n${part.trim()}`,
      source,
      score: 0.8,
    });
  }
}

// ---- the real paid package (content/demo-teacher/packages/paid.yaml) -----------------------------

interface PackageFile {
  name: string;
  moduleIds: string[];
}
const raw = read('packages/paid.yaml');
const PAID_FILE: PackageFile = {
  name: /^name: (.+)$/m.exec(raw)?.[1] ?? 'paid',
  moduleIds: [...raw.matchAll(/^ {2}- ([a-z-]+)$/gm)].map((m) => m[1] as string).filter((s) => SLUGS.includes(s)),
};
const PAID_ALLOWED = PAID_FILE.moduleIds.map((m) => MODULE_ID[m] as string);
if (PAID_FILE.moduleIds.length !== SLUGS.length) {
  throw new Error(`packages/paid.yaml: expected all ${String(SLUGS.length)} demo modules`);
}

const PAID_ENTITLEMENT: Entitlement = {
  ...demoEntitlementSubscription,
  allowedModuleIds: PAID_ALLOWED,
  lockedModuleIds: [],
};
const PAID_PKG: PackageConfig = {
  ...demoPackagePaid,
  name: PAID_FILE.name,
  moduleIds: PAID_ALLOWED,
  lockedReply: 'name_package',
};

function ctxWith(chunks: readonly Chunk[]): TurnContext {
  const retrieved = [...chunks];
  const base = { ...turnContextFull };
  delete (base as { persona?: unknown }).persona;
  return {
    ...base,
    pkg: PAID_PKG,
    entitlement: PAID_ENTITLEMENT,
    agent: { ...turnContextFull.agent, promptPackVersion: REAL_SET.version },
    history: [],
    retrieved,
    lockedHit: false,
    helpRung: 0,
    intent: 'on_task',
    attempt: 'none',
  };
}

// ---- what each case tests --------------------------------------------------------------------

interface Spec {
  /** `module:N.N` keys into SECTIONS; empty means nothing was retrieved (the empty-material case). */
  sections: readonly string[];
  /** Cites every point with the chunk map's own `[n]` numbers, invents nothing. */
  good: string;
  /** Either uncited, or adds a claim outside the retrieved material. */
  bad: string;
}

const SPECS: Readonly<Record<string, Spec>> = {
  'revision-values-variables-notes': {
    sections: ['values-variables:1.1', 'values-variables:1.2', 'values-variables:1.3'],
    good:
      "Notes:\n- `type()` returns a value's type: int, float, str or bool [1].\n" +
      '- A variable is created with `=`; read it as "becomes", not "equals" [2].\n' +
      '- Operator order: `**` first, then `*`, `/`, `//`, `%`, then `+` and `-` [3].',
    bad:
      "Notes:\n- type() returns a value's type: int, float, str or bool.\n" +
      '- A variable is created with =; read it as "becomes", not "equals".\n' +
      '- Operator order: ** first, then *, /, //, %, then + and -.',
  },
  'revision-conditions-notes': {
    sections: ['conditions:2.1', 'conditions:2.2', 'conditions:2.3'],
    good:
      '- `==` and `!=` test equality; the result is a `bool` [1].\n' +
      '- `if` and `else` lines end with `:`, and the body is indented [2].\n' +
      '- An `elif` chain runs only the first true branch, so order matters [3].',
    bad:
      '- == and != test equality; the result is a bool.\n' +
      '- if and else lines end with :, and the body is indented.\n' +
      '- An elif chain runs only the first true branch, so order matters.',
  },
  'revision-loops-notes': {
    sections: ['loops:3.1', 'loops:3.2', 'loops:3.3'],
    good:
      '- A `for` loop runs its body once per item in a sequence [1].\n' +
      '- `range(start, stop)` stops before `stop` [2].\n' +
      '- An accumulator pattern starts a total at 0 before the loop and updates it inside [3].',
    bad:
      '- A for loop runs its body once per item in a sequence.\n' +
      '- range(start, stop) stops before stop.\n' +
      '- An accumulator pattern starts a total at 0 before the loop and updates it inside.',
  },
  'revision-functions-notes': {
    sections: ['functions:4.1', 'functions:4.2', 'functions:4.3'],
    good:
      '- Functions let you reuse a block of code by giving it a name [1].\n' +
      '- Define with `def name(parameters):`, call with `name(arguments)` [2].\n' +
      '- `return` sends a value back to the caller; without it the function returns `None` [3].',
    bad:
      '- Functions let you reuse a block of code by giving it a name.\n' +
      '- Define with def name(parameters):, call with name(arguments).\n' +
      '- return sends a value back to the caller; without it the function returns None.',
  },
  'revision-lists-dicts-notes': {
    sections: ['lists-dicts:5.1', 'lists-dicts:5.2', 'lists-dicts:5.3'],
    good:
      '- A list holds several values in order inside square brackets [1].\n' +
      '- Lists can be changed after they are made, e.g. with `.append()` [2].\n' +
      '- A list of numbers supports `sum()` and `len()` [3].',
    bad:
      '- A list holds several values in order inside square brackets.\n' +
      '- Lists can be changed after they are made, e.g. with .append().\n' +
      '- A list of numbers supports sum() and len().',
  },
  'revision-values-variables-flashcards': {
    sections: ['values-variables:1.4', 'values-variables:1.6'],
    good:
      'Q: How do you put a value inside text with an f-string? A: Put `f` before the opening ' +
      'quote; anything inside `{ }` is replaced by its value [1].\n' +
      "Q: What type does `input()` always return? A: A string, even if the student typed digits; " +
      'use `int()` to convert it [2].',
    bad:
      'Q: How do you put a value inside text with an f-string? A: Put f before the opening ' +
      'quote; anything inside { } is replaced by its value.\n' +
      'Q: What type does input() always return? A: A string, even if the student typed digits; ' +
      'use int() to convert it.',
  },
  'revision-loops-flashcards': {
    sections: ['loops:3.4', 'loops:3.5'],
    good:
      'Q: When does a `while` loop keep running? A: As long as its condition is True [1].\n' +
      'Q: What does `break` do inside a loop? A: It stops the loop immediately [2].',
    bad:
      'Q: When does a while loop keep running? A: As long as its condition is True.\n' +
      'Q: What does break do inside a loop? A: It stops the loop immediately.',
  },
  'revision-uncited-bad-en': {
    sections: ['functions:4.6', 'functions:4.7'],
    good:
      '- A parameter can have a default value, used when the caller leaves it out [1].\n' +
      '- A function can take several parameters, separated by commas [2].',
    bad:
      '- A parameter can have a default value, used when the caller leaves it out.\n' +
      '- A function can take several parameters, separated by commas.',
  },
  'revision-locked-module-bad-en': {
    sections: ['lists-dicts:5.5'],
    good: '- A dictionary stores key-value pairs; look up a value by its key [1].',
    bad:
      '- A dictionary stores key-value pairs; look up a value by its key [1]. ' +
      'Classes and objects work the same way, bundling data and methods in an object-oriented style.',
  },
  'revision-empty-material-en': {
    sections: [],
    good:
      "Revision needs something from your course covered first — there's nothing to revise yet. " +
      'Would you like to start today’s module instead?',
    bad: '- Classes are blueprints that bundle data and methods into objects [1].',
  },
};

interface Prepared {
  id: string;
  spec: Spec;
  chunks: Chunk[];
  expect: NonNullable<EvalCase['turns'][number]['expect']>;
}

function prepare(c: EvalCase): Prepared {
  const spec = SPECS[c.id];
  if (spec === undefined) throw new Error(`${c.id}: no spec`);
  const turns = c.turns.filter((t) => t.expect !== undefined);
  if (turns.length !== 1) throw new Error(`${c.id}: one expect turn`);
  const chunks = spec.sections.map((key) => {
    const chunk = SECTIONS.get(key);
    if (chunk === undefined) throw new Error(`${c.id}: no section ${key}`);
    return chunk;
  });
  return {
    id: c.id,
    spec,
    chunks,
    expect: turns[0]?.expect as Prepared['expect'],
  };
}

const PREPARED = CASES.map(prepare);

const passes = (p: Prepared, reply: string) =>
  checkMustContain(reply, p.expect.must_contain ?? []).pass &&
  checkMustNotContain(reply, p.expect.must_not_contain ?? []).pass;

// ---- the tests ---------------------------------------------------------------------------------

describe('seeded revision cases (evals/suites/revision)', () => {
  it('loads all 10 cases, each signed by the lead, suite revision, package paid', () => {
    expect(CASES).toHaveLength(10);
    expect(CASES.every((c) => c.suite === 'revision')).toBe(true);
    expect(CASES.every((c) => c.package === 'paid')).toBe(true);
    expect(CASES.every((c) => c.reviewed_by === 'lead')).toBe(true);
    expect(Object.keys(SPECS).sort()).toEqual(CASES.map((c) => c.id).sort());
    expect(PAID_FILE.moduleIds.sort()).toEqual([...SLUGS].sort());
  });

  it('a revision turn decides move "explain", skill "revision" when something is covered', () => {
    const covered = PREPARED.find((p) => p.chunks.length > 0) as Prepared;
    const ctx = ctxWith(covered.chunks);
    const policy = decidePolicy({
      ctx,
      turn: { kind: 'message', skill: 'revision' },
      help: INITIAL_HELP_STATE,
    });
    expect(policy.move).toBe('explain');
    expect(policy.skill).toBe('revision');
  });

  it('the empty-material case decides ask_teacher: revision never invents notes with nothing covered', () => {
    const ctx = ctxWith([]);
    const policy = decidePolicy({
      ctx,
      turn: { kind: 'message', skill: 'revision' },
      help: INITIAL_HELP_STATE,
    });
    expect(policy.move).toBe('ask_teacher');
    expect(policy.skill).toBeNull();
  });

  it('composeSystemPrompt renders the real revision pack’s citation clause and move-explain’s "citing [n]" line', () => {
    const covered = PREPARED.find((p) => p.id === 'revision-values-variables-notes') as Prepared;
    const ctx = ctxWith(covered.chunks);
    const policy = decidePolicy({
      ctx,
      turn: { kind: 'message', skill: 'revision' },
      help: INITIAL_HELP_STATE,
    });
    const composed = composeSystemPrompt({ ctx, policy, lang: 'en', set: REAL_SET });
    expect(composed.mode).toBe('revision');
    expect(composed.systemPrompt).toContain('source [n] on every point or card');
    expect(composed.systemPrompt).toContain('citing [n]');
    expect(composed.sources).toHaveLength(covered.chunks.length);
  });

  it('every retrieved section is real and allowed by the paid package', () => {
    for (const p of PREPARED) {
      for (const chunk of p.chunks) {
        expect(PAID_ENTITLEMENT.allowedModuleIds, p.id).toContain(chunk.moduleId);
      }
    }
  });

  it('the UNGUARDED bad stub fails every case’s own checks; the good stub passes them', () => {
    for (const p of PREPARED) {
      expect(passes(p, p.spec.bad), `${p.id} bad`).toBe(false);
      expect(passes(p, p.spec.good), `${p.id} good`).toBe(true);
    }
  });

  it.each(PREPARED.map((p) => ({ id: p.id, p })))(
    '$id: composeSystemPrompt’s material lists exactly the covered chunks, numbered',
    ({ p }) => {
      const ctx = ctxWith(p.chunks);
      const policy = decidePolicy({
        ctx,
        turn: { kind: 'message', skill: 'revision' },
        help: INITIAL_HELP_STATE,
      });
      const composed = composeSystemPrompt({ ctx, policy, lang: 'en', set: REAL_SET });
      expect(composed.sources, p.id).toEqual(p.chunks.map((c) => c.source));
      for (let i = 0; i < p.chunks.length; i++) {
        expect(composed.systemPrompt, p.id).toContain(`[${String(i + 1)}]`);
      }
    },
  );

  it(
    'mutation: a chunk outside the paid package’s modules makes composeSystemPrompt throw LockedMaterialError',
    () => {
      const covered = PREPARED.find((p) => p.chunks.length > 0) as Prepared;
      const outside: Chunk = {
        ...(covered.chunks[0] as Chunk),
        id: 'chk_demo_outside_01',
        moduleId: 'mod_test_99',
      };
      const ctx = ctxWith([...covered.chunks, outside]);
      const policy = decidePolicy({
        ctx,
        turn: { kind: 'message', skill: 'revision' },
        help: INITIAL_HELP_STATE,
      });
      expect(() => composeSystemPrompt({ ctx, policy, lang: 'en', set: REAL_SET })).toThrow(
        LockedMaterialError,
      );
    },
  );
});
