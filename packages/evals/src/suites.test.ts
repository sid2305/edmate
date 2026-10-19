import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GUARD_FOLDERS, MIN_CASES_PER_GUARD, validateSuites, type SuiteRules } from './suites.js';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SUITES_ROOT = join(REPO_ROOT, 'evals/suites');
const DEMO_PACKAGES = readdirSync(join(REPO_ROOT, 'content/demo-teacher/packages'))
  .filter((name) => /\.ya?ml$/.test(name))
  .map((name) => name.replace(/\.ya?ml$/, ''))
  .sort();

// --- The real suites -------------------------------------------------------------------------
// EDMATE_REQUIRE_REVIEWED=1: no case may still say `reviewed_by: pending` (set after sign-off).
// EDMATE_REQUIRE_SUITES=1: every guard folder must be seeded (set once 4.0a and 4.0b land).
describe('evals/suites (real cases)', () => {
  const rules: SuiteRules = {
    guardFolders: GUARD_FOLDERS,
    minCases: MIN_CASES_PER_GUARD,
    packages: DEMO_PACKAGES,
    requireReviewed: process.env.EDMATE_REQUIRE_REVIEWED === '1',
    requireAllGuards: process.env.EDMATE_REQUIRE_SUITES === '1',
  };
  const report = validateSuites(SUITES_ROOT, rules);

  it('finds the demo packages the cases must name', () => {
    expect(DEMO_PACKAGES.length).toBeGreaterThan(0);
  });

  it('every case validates and follows the suite rules', () => {
    expect(report.problems).toEqual([]);
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
  over: { suite?: string; package?: string; reviewed_by?: string } = {},
): string {
  return [
    `id: ${id}`,
    `suite: ${over.suite ?? id.split('-')[0]}`,
    `package: ${over.package ?? 'free'}`,
    `reviewed_by: ${over.reviewed_by ?? 'pending'}`,
    'source: synthetic',
    'turns:',
    '  - student: "hello"',
    '    expect:',
    '      max_words: 10',
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
});
