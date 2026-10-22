import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  floorProblems,
  GUARD_FOLDERS,
  MIN_CASES_PER_GUARD,
  normaliseTurn,
  SUITE_FLOORS,
  validateSuites,
  type SuiteRules,
} from './suites.js';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SUITES_ROOT = join(REPO_ROOT, 'evals/suites');
const DEMO_PACKAGES = readdirSync(join(REPO_ROOT, 'content/demo-teacher/packages'))
  .filter((name) => /\.ya?ml$/.test(name))
  .map((name) => name.replace(/\.ya?ml$/, ''))
  .sort();

// --- The real suites -------------------------------------------------------------------------
// On by default: no case may still say `reviewed_by: pending`, and every guard folder must be
// seeded. EDMATE_ALLOW_PENDING=1 opts out of the first (before sign-off); EDMATE_ALLOW_UNSEEDED=1
// opts out of the second (before a guard folder is seeded).
describe('evals/suites (real cases)', () => {
  const rules: SuiteRules = {
    guardFolders: GUARD_FOLDERS,
    minCases: MIN_CASES_PER_GUARD,
    packages: DEMO_PACKAGES,
    requireReviewed: process.env.EDMATE_ALLOW_PENDING !== '1',
    requireAllGuards: process.env.EDMATE_ALLOW_UNSEEDED !== '1',
  };
  const report = validateSuites(SUITES_ROOT, rules);

  it('finds the demo packages the cases must name', () => {
    expect(DEMO_PACKAGES.length).toBeGreaterThan(0);
  });

  it('requires reviewed cases and all guards by default (no opt-out env var set here)', () => {
    expect(process.env.EDMATE_ALLOW_PENDING).toBeUndefined();
    expect(process.env.EDMATE_ALLOW_UNSEEDED).toBeUndefined();
    expect(rules.requireReviewed).toBe(true);
    expect(rules.requireAllGuards).toBe(true);
  });

  it('every case validates and follows the suite rules', () => {
    expect(report.problems).toEqual([]);
  });

  // Task 7.2: the count ratchet. Each 7.2 phase raises its suite's floor to the new count, so a
  // case deleted by mistake fails here.
  it('each platform suite holds at least its SUITE_FLOORS count', () => {
    expect(floorProblems(report.cases, SUITE_FLOORS)).toEqual([]);
  });

  for (const guard of GUARD_FOLDERS) {
    const count = report.guardCounts[guard] ?? 0;
    it.skipIf(count === 0)(`${guard} has at least ${MIN_CASES_PER_GUARD} cases`, () => {
      expect(count).toBeGreaterThanOrEqual(MIN_CASES_PER_GUARD);
    });
  }
});

// --- The validator itself, on tiny synthetic trees -------------------------------------------
function caseYaml(
  id: string,
  over: { suite?: string; package?: string; reviewed_by?: string; students?: string[] } = {},
): string {
  // By default each case's student turn is its own id, so synthetic cases are never duplicates.
  const students = over.students ?? [`hello from ${id}`];
  return [
    `id: ${id}`,
    `suite: ${over.suite ?? id.split('-')[0]}`,
    `package: ${over.package ?? 'free'}`,
    `reviewed_by: ${over.reviewed_by ?? 'pending'}`,
    'source: synthetic',
    'turns:',
    ...students.flatMap((s) => [
      `  - student: ${JSON.stringify(s)}`,
      '    expect:',
      '      max_words: 10',
    ]),
    '',
  ].join('\n');
}

let root: string;
function put(rel: string, text: string): void {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
function seed(folder: string, prefix: string, n: number, over?: Parameters<typeof caseYaml>[1]) {
  for (let i = 1; i <= n; i++) {
    const id = `${prefix}-${String(i).padStart(3, '0')}`;
    put(`${folder}/${id}.yaml`, caseYaml(id, over));
  }
}
const base: SuiteRules = {
  guardFolders: ['leak', 'safety/pii'],
  minCases: 3,
  packages: ['free', 'paid'],
  requireReviewed: false,
  requireAllGuards: false,
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'evals-suites-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('validateSuites', () => {
  it('passes valid guard folders, nested ones included, and counts per guard', () => {
    seed('leak', 'leak-hint', 3);
    seed('safety/pii', 'safety-pii', 4);
    const r = validateSuites(root, base);
    expect(r.problems).toEqual([]);
    expect(r.suites).toEqual(['leak', 'safety']);
    expect(r.guardCounts).toEqual({ leak: 3, 'safety/pii': 4 });
    expect(r.unseeded).toEqual([]);
    expect(r.cases.map((c) => c.file)).toContain('safety/pii/safety-pii-001.yaml');
  });

  it('fails a guard folder under the minimum', () => {
    seed('leak', 'leak-hint', 2);
    seed('safety/pii', 'safety-pii', 3);
    expect(validateSuites(root, base).problems).toEqual(['leak: 2 cases, needs at least 3']);
  });

  it('skips .gitkeep-only and missing guard folders, unless all guards are required', () => {
    put('leak/.gitkeep', '');
    const loose = validateSuites(root, base);
    expect(loose.problems).toEqual([]);
    expect(loose.suites).toEqual([]);
    expect(loose.unseeded).toEqual(['leak', 'safety/pii']);

    const strict = validateSuites(root, { ...base, requireAllGuards: true });
    expect(strict.problems).toEqual([
      'leak: guard folder has no cases',
      'safety/pii: guard folder is missing',
    ]);
  });

  it('validates non-guard suites too, with no minimum', () => {
    seed('pedagogy', 'pedagogy-hint', 1);
    const r = validateSuites(root, { ...base, guardFolders: [] });
    expect(r.problems).toEqual([]);
    expect(r.suites).toEqual(['pedagogy']);
  });

  it('reports a case that fails the schema (no reviewed_by) and keeps checking others', () => {
    seed('leak', 'leak-hint', 3);
    put('advice/advice-tax-001.yaml', caseYaml('advice-tax-001').replace(/reviewed_by.*\n/, ''));
    const r = validateSuites(root, { ...base, guardFolders: ['leak', 'advice'], minCases: 1 });
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toMatch(/^advice: .*advice-tax-001\.yaml: invalid eval case/);
    expect(r.problems[0]).toMatch(/reviewed_by/);
    expect(r.guardCounts).toEqual({ leak: 3, advice: 0 });
  });

  it('reports invalid YAML', () => {
    put('leak/leak-x-001.yaml', 'id: [unclosed');
    const r = validateSuites(root, { ...base, guardFolders: [] });
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toMatch(/^leak: .*invalid YAML/);
  });

  it('flags pending reviewers only when reviewed cases are required', () => {
    seed('leak', 'leak-hint', 3);
    seed('safety/pii', 'safety-pii', 3, { reviewed_by: 'sid2305' });
    expect(validateSuites(root, base).problems).toEqual([]);
    const strict = validateSuites(root, { ...base, requireReviewed: true });
    expect(strict.problems).toEqual([
      'leak/leak-hint-001.yaml: reviewed_by is still "pending"',
      'leak/leak-hint-002.yaml: reviewed_by is still "pending"',
      'leak/leak-hint-003.yaml: reviewed_by is still "pending"',
    ]);
  });

  it('enforces file name = id, suite = top folder, id prefix and a known package', () => {
    put('leak/wrong-name.yaml', caseYaml('leak-a-001'));
    put('leak/leak-a-002.yaml', caseYaml('leak-a-002', { suite: 'locked' }));
    put('leak/locked-a-003.yaml', caseYaml('locked-a-003', { suite: 'leak' }));
    put('leak/leak-a-004.yaml', caseYaml('leak-a-004', { package: 'full' }));
    const r = validateSuites(root, { ...base, guardFolders: [] });
    expect(r.problems).toEqual([
      'leak/leak-a-002.yaml: suite is "locked", expected "leak" (its top folder)',
      'leak/leak-a-004.yaml: package "full" is not one of: free, paid',
      'leak/locked-a-003.yaml: id "locked-a-003" must start with "leak-"',
      'leak/wrong-name.yaml: file name must be "<id>.yaml" (id is "leak-a-001")',
    ]);
  });

  it('reports a duplicate id inside one suite and across suites', () => {
    put('leak/a/leak-dup-001.yaml', caseYaml('leak-dup-001'));
    put('leak/b/leak-dup-001.yaml', caseYaml('leak-dup-001'));
    const inside = validateSuites(root, { ...base, guardFolders: [] });
    expect(inside.problems).toHaveLength(1);
    expect(inside.problems[0]).toMatch(/^leak: .*duplicate case id "leak-dup-001"/);

    rmSync(join(root, 'leak'), { recursive: true });
    // Same id in two suites: only the cross-suite check can see it (the prefix rule also fires).
    put('leak/leak-dup-001.yaml', caseYaml('leak-dup-001'));
    put('locked/leak-dup-001.yaml', caseYaml('leak-dup-001', { suite: 'locked' }));
    const across = validateSuites(root, { ...base, guardFolders: [] });
    expect(across.problems).toContain(
      'locked/leak-dup-001.yaml: duplicate case id "leak-dup-001" (also in leak/leak-dup-001.yaml)',
    );
  });

  it('flags a pending reviewer regardless of case or surrounding whitespace', () => {
    seed('leak', 'leak-hint', 3, { reviewed_by: '  Pending  ' });
    seed('safety/pii', 'safety-pii', 3, { reviewed_by: 'PENDING' });
    const r = validateSuites(root, { ...base, requireReviewed: true });
    expect(r.problems).toEqual([
      'leak/leak-hint-001.yaml: reviewed_by is still "pending"',
      'leak/leak-hint-002.yaml: reviewed_by is still "pending"',
      'leak/leak-hint-003.yaml: reviewed_by is still "pending"',
      'safety/pii/safety-pii-001.yaml: reviewed_by is still "pending"',
      'safety/pii/safety-pii-002.yaml: reviewed_by is still "pending"',
      'safety/pii/safety-pii-003.yaml: reviewed_by is still "pending"',
    ]);
  });

  it('a case properly reviewed by someone whose name merely contains "pending" is not flagged', () => {
    seed('leak', 'leak-hint', 1, { reviewed_by: 'ependington' });
    const r = validateSuites(root, { ...base, requireReviewed: true, guardFolders: [] });
    expect(r.problems).toEqual([]);
  });

  it('reports "suite failed to load" for a guard, not "has no cases", when its suite errors out', () => {
    put('leak/leak-bad-001.yaml', 'id: [unclosed');
    seed('safety/pii', 'safety-pii', 3);
    const r = validateSuites(root, { ...base, requireAllGuards: true });
    expect(r.problems).toHaveLength(2);
    expect(r.problems[0]).toMatch(/^leak: .*invalid YAML/);
    expect(r.problems[1]).toBe('leak: suite failed to load');
  });

  it('still calls a failed-to-load guard unseeded, not a problem, when all guards are not required', () => {
    put('leak/leak-bad-001.yaml', 'id: [unclosed');
    const r = validateSuites(root, base);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toMatch(/^leak: .*invalid YAML/);
    expect(r.unseeded).toContain('leak');
  });

  it('pairs every loaded case with its own file across nested, differently-sorted suites', () => {
    // Nesting "bbb" one folder deeper than "aaa" makes the path sort ("a/..." before "leak-...")
    // run opposite to id order, the way a re-list-and-cast bug (pairing by array index from a
    // separate re-listing, instead of the pair the load itself produced) could silently swap a
    // case's file with a neighbour's.
    put('leak/a/leak-bbb-002.yaml', caseYaml('leak-bbb-002'));
    put('leak/leak-aaa-001.yaml', caseYaml('leak-aaa-001'));
    put('safety/pii/safety-pii-003.yaml', caseYaml('safety-pii-003', { suite: 'safety' }));
    const r = validateSuites(root, { ...base, guardFolders: [] });
    expect(r.problems).toEqual([]);
    expect(r.cases.map((c) => [c.file, c.evalCase.id])).toEqual([
      ['leak/a/leak-bbb-002.yaml', 'leak-bbb-002'],
      ['leak/leak-aaa-001.yaml', 'leak-aaa-001'],
      ['safety/pii/safety-pii-003.yaml', 'safety-pii-003'],
    ]);
  });
});

describe('duplicate student turns (task 7.2)', () => {
  it('normalises with NFKC, lower case, collapsed whitespace and no punctuation', () => {
    expect(normaliseTurn('  Show me   LESSON 9, please!! ')).toBe('show me lesson 9 please');
    expect(normaliseTurn('ｓｈｏｗ me\tlesson\n9')).toBe('show me lesson 9');
    expect(normaliseTurn('what’s “range”?')).toBe('whats range');
  });

  it('flags two cases in one suite whose student turns differ only by case, spacing and punctuation', () => {
    put('locked/locked-a-001.yaml', caseYaml('locked-a-001', { students: ['Show me lesson 9.'] }));
    put('locked/locked-b-002.yaml', caseYaml('locked-b-002', { students: ['show  me LESSON 9!'] }));
    const r = validateSuites(root, { ...base, guardFolders: [] });
    expect(r.problems).toEqual([
      'locked/locked-b-002.yaml: same student turns as locked/locked-a-001.yaml',
    ]);
  });

  it('compares the whole turn sequence, within one suite only, nested folders included', () => {
    // Same first turn, different second turn: not a duplicate.
    put('locked/locked-a-001.yaml', caseYaml('locked-a-001', { students: ['hi', 'one'] }));
    put('locked/locked-a-002.yaml', caseYaml('locked-a-002', { students: ['hi', 'two'] }));
    // The same turns in another suite: not a duplicate.
    put('leak/leak-a-001.yaml', caseYaml('leak-a-001', { students: ['hi', 'one'] }));
    expect(validateSuites(root, { ...base, guardFolders: [] }).problems).toEqual([]);

    // Two sub-folders of one suite: a duplicate.
    put('safety/pii/safety-a-001.yaml', caseYaml('safety-a-001', { students: ['my number'] }));
    put(
      'safety/jailbreak/safety-b-001.yaml',
      caseYaml('safety-b-001', { students: ['My number.'] }),
    );
    expect(validateSuites(root, { ...base, guardFolders: [] }).problems).toEqual([
      'safety/pii/safety-a-001.yaml: same student turns as safety/jailbreak/safety-b-001.yaml',
    ]);
  });
});

describe('floorProblems (task 7.2 count ratchet)', () => {
  it('passes at or above each floor and names every suite below it', () => {
    seed('leak', 'leak-hint', 3);
    seed('safety/pii', 'safety-pii', 2);
    const { cases } = validateSuites(root, { ...base, guardFolders: [] });
    expect(floorProblems(cases, { leak: 3, safety: 2 })).toEqual([]);
    expect(floorProblems(cases, { leak: 4, safety: 2, locked: 1 })).toEqual([
      'leak: 3 cases, below its floor of 4',
      'locked: 0 cases, below its floor of 1',
    ]);
  });

  it('pins every platform suite the Evals table names, at today’s counts or more', () => {
    expect(Object.keys(SUITE_FLOORS).sort()).toEqual(
      ['advice', 'leak', 'locked', 'pedagogy', 'persona', 'safety'].sort(),
    );
    expect(SUITE_FLOORS).toEqual({
      leak: 44,
      locked: 38,
      safety: 214,
      persona: 42,
      pedagogy: 1,
      advice: 37,
    });
  });
});
