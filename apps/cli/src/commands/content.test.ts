import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CONTENT_USAGE, runContentCommand } from './content.js';

// The tiny trees @edmate/content tests itself with (the real content lives in content/).
const FIXTURES = new URL('../../../../packages/content/test/fixtures', import.meta.url).pathname;
const VALID = join(FIXTURES, 'valid');
const BROKEN = join(FIXTURES, 'broken-all');

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { stdout: (s: string) => out.push(s), stderr: (s: string) => err.push(s) },
    out,
    err,
  };
}

const temps: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'edmate-cli-content-'));
  temps.push(d);
  return d;
}
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('edmate content validate', () => {
  it('exits 0 and says so for a valid tree', () => {
    const { io, out, err } = capture();
    expect(runContentCommand(['validate', VALID], io, { cwd: '/' })).toBe(0);
    expect(out.join('')).toBe(`edmate content validate: ${VALID}: ok\n`);
    expect(err).toEqual([]);
  });

  it('exits 1 and prints every issue for a broken tree', () => {
    const { io, out, err } = capture();
    expect(runContentCommand(['validate', BROKEN], io, { cwd: '/' })).toBe(1);
    const text = err.join('');
    expect(text).toMatch(/^edmate content validate: .*broken-all: 7 issues\n/);
    for (const needle of [
      'common-mistakes.yaml: no entry in licences.yaml',
      'licence "CC-BY-NC-4.0"',
      '29 rubric-scored answers',
      'expectedModuleId "dictionaries"',
      'at most 300 words',
      'moduleIds is missing "variables"',
      'skills is missing "explain"',
    ]) {
      expect(text).toContain(needle);
    }
    expect(out).toEqual([]);
  });

  it('indents multi-line issues under their bullet', () => {
    const dir = tempDir();
    cpSync(VALID, dir, { recursive: true });
    writeFileSync(join(dir, 'qa-recall.yaml'), '- id: x\n');
    const { io, err } = capture();
    expect(runContentCommand(['validate', dir], io, { cwd: '/' })).toBe(1);
    expect(err.join('')).toMatch(/: 1 issue\n {2}- qa-recall\.yaml: invalid content:\n {4}/);
  });

  it('resolves a relative dir against cwd', () => {
    const { io } = capture();
    expect(runContentCommand(['validate', 'valid'], io, { cwd: FIXTURES })).toBe(0);
  });

  it('defaults to content/demo-teacher under cwd', () => {
    const root = tempDir();
    mkdirSync(join(root, 'content'));
    cpSync(VALID, join(root, 'content', 'demo-teacher'), { recursive: true });
    const { io, out } = capture();
    expect(runContentCommand(['validate'], io, { cwd: root })).toBe(0);
    expect(out.join('')).toContain(join(root, 'content', 'demo-teacher'));
  });

  it('falls back to the workspace root for a relative dir missing under cwd', () => {
    const root = tempDir();
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
    cpSync(VALID, join(root, 'content', 'demo-teacher'), { recursive: true });
    const cwd = join(root, 'apps', 'cli');
    mkdirSync(cwd, { recursive: true });
    const { io, out } = capture();
    expect(runContentCommand(['validate'], io, { cwd })).toBe(0);
    expect(out.join('')).toContain(join(root, 'content', 'demo-teacher'));
  });

  it('exits 1 for a missing directory', () => {
    const cwd = tempDir();
    const { io, err } = capture();
    expect(runContentCommand(['validate', 'nowhere'], io, { cwd })).toBe(1);
    expect(err.join('')).toContain(`${join(cwd, 'nowhere')}: no such content directory`);
  });

  it.each([[['--help']], [['-h']], [['validate', '--help']]])('prints usage for %j', (args) => {
    const { io, out } = capture();
    expect(runContentCommand(args, io, { cwd: '/' })).toBe(0);
    expect(out.join('')).toBe(CONTENT_USAGE);
  });

  it.each([
    [[], 'expected a subcommand'],
    [['frobnicate'], "unknown subcommand 'frobnicate'"],
    [['validate', 'a', 'b'], 'expected at most one directory'],
    [['validate', '--nope'], "Unknown option '--nope'"],
  ])('fails with usage for %j', (args, message) => {
    const { io, err } = capture();
    expect(runContentCommand(args, io, { cwd: '/' })).toBe(1);
    expect(err.join('')).toContain(message);
    expect(err.join('')).toContain(CONTENT_USAGE);
  });
});
