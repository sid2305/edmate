import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CaseLoadError, loadCasesFromDir, loadCasesWithFiles } from './loader.js';

const FIXTURE_SUITE = fileURLToPath(new URL('../test/fixtures/suite', import.meta.url));

function caseYaml(id: string): string {
  return [
    `id: ${id}`,
    'suite: test',
    'package: free',
    'reviewed_by: pending',
    'source: synthetic',
    'turns:',
    '  - student: "hello"',
    '    expect:',
    '      max_words: 10',
    '',
  ].join('\n');
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'evals-loader-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('loadCasesFromDir', () => {
  it('loads the fixture suite in sorted-path order, byte-identical twice', () => {
    const first = loadCasesFromDir(FIXTURE_SUITE);
    const second = loadCasesFromDir(FIXTURE_SUITE);
    expect(first.map((c) => c.id)).toEqual([
      'test-all-checks-003',
      'test-explain-001',
      'test-locked-002',
      'test-nested-004',
    ]);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    const multi = first.find((c) => c.id === 'test-locked-002');
    expect(multi?.turns.length).toBeGreaterThan(1);
  });

  it('sorts by relative path, not by creation order, and recurses', () => {
    mkdirSync(join(dir, 'b'));
    writeFileSync(join(dir, 'z.yaml'), caseYaml('case-z'));
    writeFileSync(join(dir, 'b', 'a.yml'), caseYaml('case-ba'));
    writeFileSync(join(dir, 'a.yaml'), caseYaml('case-a'));
    writeFileSync(join(dir, 'notes.md'), 'not a case');
    expect(loadCasesFromDir(dir).map((c) => c.id)).toEqual(['case-a', 'case-ba', 'case-z']);
  });

  it('throws when the directory holds no cases', () => {
    expect(() => loadCasesFromDir(dir)).toThrow(/no \.yaml or \.yml cases/);
  });

  it('throws CaseLoadError naming the file for invalid YAML', () => {
    writeFileSync(join(dir, 'ok.yaml'), caseYaml('case-ok'));
    writeFileSync(join(dir, 'broken.yaml'), 'id: [unclosed\n');
    const err = catchError(() => loadCasesFromDir(dir));
    expect(err).toBeInstanceOf(CaseLoadError);
    expect((err as CaseLoadError).filePath).toBe(join(dir, 'broken.yaml'));
    expect(err.message).toContain('invalid YAML');
    expect(err.message).toContain('broken.yaml');
  });

  it('reports an unreadable file differently from invalid YAML', () => {
    const path = join(dir, 'locked.yaml');
    writeFileSync(path, caseYaml('case-locked'));
    chmodSync(path, 0o000);
    try {
      const err = catchError(() => loadCasesFromDir(dir));
      expect(err).toBeInstanceOf(CaseLoadError);
      expect(err.message).toContain('cannot read file');
      expect(err.message).not.toContain('invalid YAML');
    } finally {
      chmodSync(path, 0o644);
    }
  });

  it('never puts the absolute path (outside cwd) in the message', () => {
    writeFileSync(join(dir, 'broken.yaml'), 'id: [unclosed\n');
    const err = catchError(() => loadCasesFromDir(dir)) as CaseLoadError;
    expect(err.message).not.toContain(dir);
    expect(err.filePath).toBe(join(dir, 'broken.yaml'));
  });

  it('throws CaseLoadError naming the file and the issue for a schema-invalid case', () => {
    writeFileSync(
      join(dir, 'bad.yaml'),
      caseYaml('case-bad').replace('max_words: 10', 'max_wordz: 10'),
    );
    const err = catchError(() => loadCasesFromDir(dir));
    expect(err).toBeInstanceOf(CaseLoadError);
    expect(err.message).toContain('bad.yaml');
    expect(err.message).toContain('max_wordz');
  });

  it('throws CaseLoadError for a missing required field', () => {
    writeFileSync(join(dir, 'nosrc.yaml'), caseYaml('case-x').replace('source: synthetic\n', ''));
    const err = catchError(() => loadCasesFromDir(dir));
    expect(err).toBeInstanceOf(CaseLoadError);
    expect(err.message).toContain('nosrc.yaml');
    expect(err.message).toContain('source');
  });

  it('throws on an empty file rather than skipping it', () => {
    writeFileSync(join(dir, 'empty.yaml'), '');
    expect(() => loadCasesFromDir(dir)).toThrow(CaseLoadError);
  });

  it('throws on a duplicate id across files, naming both', () => {
    writeFileSync(join(dir, 'one.yaml'), caseYaml('case-dup'));
    writeFileSync(join(dir, 'two.yaml'), caseYaml('case-dup'));
    const err = catchError(() => loadCasesFromDir(dir));
    expect(err).toBeInstanceOf(CaseLoadError);
    expect(err.message).toContain('two.yaml');
    expect(err.message).toContain('one.yaml');
    expect(err.message).toContain('case-dup');
  });
});

describe('loadCasesWithFiles', () => {
  it('pairs each file with the case it actually holds, even when ids sort differently from paths', () => {
    // b.yaml < z.yaml by path, but holds the id that sorts last; a bug that paired by re-listing
    // the directory and zipping by index (instead of returning the pair from the same load)
    // would not be caught by an id/filename-match rule, only by checking file against content.
    writeFileSync(join(dir, 'b.yaml'), caseYaml('zzz-last'));
    writeFileSync(join(dir, 'z.yaml'), caseYaml('aaa-first'));
    const pairs = loadCasesWithFiles(dir);
    expect(pairs).toEqual([
      { file: 'b.yaml', evalCase: expect.objectContaining({ id: 'zzz-last' }) },
      { file: 'z.yaml', evalCase: expect.objectContaining({ id: 'aaa-first' }) },
    ]);
  });

  it('agrees with loadCasesFromDir on order and content', () => {
    mkdirSync(join(dir, 'nested'));
    writeFileSync(join(dir, 'nested', 'c.yaml'), caseYaml('case-c'));
    writeFileSync(join(dir, 'a.yaml'), caseYaml('case-a'));
    const pairs = loadCasesWithFiles(dir);
    const plain = loadCasesFromDir(dir);
    expect(pairs.map((p) => p.evalCase)).toEqual(plain);
    expect(pairs.map((p) => p.file)).toEqual(['a.yaml', 'nested/c.yaml']);
  });

  it('throws when the directory holds no cases', () => {
    expect(() => loadCasesWithFiles(dir)).toThrow(/no \.yaml or \.yml cases/);
  });
});

function catchError(fn: () => unknown): Error {
  try {
    fn();
  } catch (e) {
    return e as Error;
  }
  throw new Error('expected a throw');
}
