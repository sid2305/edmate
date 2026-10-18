import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { run } from './cli.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { stdout: (s: string) => out.push(s), stderr: (s: string) => err.push(s) },
    out,
    err,
  };
}

describe('edmate cli', () => {
  it.each([['--version'], ['-v']])('prints the package version for %s', (flag) => {
    const { io, out, err } = capture();
    expect(run([flag], io)).toBe(0);
    expect(out.join('')).toBe(`${pkg.version}\n`);
    expect(err).toEqual([]);
  });

  it.each([['--help'], ['-h']])('prints usage for %s', (flag) => {
    const { io, out } = capture();
    expect(run([flag], io)).toBe(0);
    expect(out.join('')).toContain('Usage: edmate');
  });

  it('prints usage and fails with no arguments', () => {
    const { io, err } = capture();
    expect(run([], io)).toBe(1);
    expect(err.join('')).toContain('Usage: edmate');
  });

  it('writes to the real stdout and stderr by default', () => {
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      expect(run(['--version'])).toBe(0);
      expect(run([])).toBe(1);
      expect(out).toHaveBeenCalledWith(`${pkg.version}\n`);
      expect(err).toHaveBeenCalledWith(expect.stringContaining('Usage: edmate'));
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
  });

  it('rejects an unknown command', () => {
    const { io, err } = capture();
    expect(run(['chat'], io)).toBe(1);
    expect(err.join('')).toContain("unknown command 'chat'");
  });
});
