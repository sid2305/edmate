import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  it.each([['--version'], ['-v']])('prints the package version for %s', async (flag) => {
    const { io, out, err } = capture();
    expect(await run([flag], io)).toBe(0);
    expect(out.join('')).toBe(`${pkg.version}\n`);
    expect(err).toEqual([]);
  });

  it.each([['--help'], ['-h']])('prints usage for %s', async (flag) => {
    const { io, out } = capture();
    expect(await run([flag], io)).toBe(0);
    expect(out.join('')).toContain('Usage: edmate');
  });

  it('prints usage and fails with no arguments', async () => {
    const { io, err } = capture();
    expect(await run([], io)).toBe(1);
    expect(err.join('')).toContain('Usage: edmate');
  });

  it('writes to the real stdout and stderr by default', async () => {
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      expect(await run(['--version'])).toBe(0);
      expect(await run([])).toBe(1);
      expect(out).toHaveBeenCalledWith(`${pkg.version}\n`);
      expect(err).toHaveBeenCalledWith(expect.stringContaining('Usage: edmate'));
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
  });

  it('rejects an unknown command', async () => {
    const { io, err } = capture();
    expect(await run(['bogus'], io)).toBe(1);
    expect(err.join('')).toContain("unknown command 'bogus'");
  });

  it('lists the chat command in the usage text', async () => {
    const { io, out } = capture();
    await run(['--help'], io);
    expect(out.join('')).toContain('chat');
  });

  it('routes chat to the chat command', async () => {
    const { io, out } = capture();
    expect(await run(['chat', '--help'], io)).toBe(0);
    expect(out.join('')).toContain('Usage: edmate chat');
  });

  it('lists the eval command in the usage text', async () => {
    const { io, out } = capture();
    await run(['--help'], io);
    expect(out.join('')).toContain('eval <dir>');
  });

  it('lists content validate in the usage text', async () => {
    const { io, out } = capture();
    await run(['--help'], io);
    expect(out.join('')).toContain('content validate [dir]');
  });

  it('routes content to the content command', async () => {
    const { io, out } = capture();
    expect(await run(['content', '--help'], io)).toBe(0);
    expect(out.join('')).toContain('Usage: edmate content validate [dir]');
  });

  it('content validate fails for a directory that is not a content tree', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-content-'));
    try {
      const { io, err } = capture();
      expect(await run(['content', 'validate', dir], io)).toBe(1);
      expect(err.join('')).toContain('course.yaml: missing; not a recognised content directory');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('routes eval to the eval command', async () => {
    const { io, out } = capture();
    expect(await run(['eval', '--help'], io)).toBe(0);
    expect(out.join('')).toContain('Usage: edmate eval <dir>');
  });

  it('eval with the unwired agent fails loudly when a fixture is missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-eval-'));
    try {
      writeFileSync(
        join(dir, 'c.yaml'),
        'id: c-001\nsuite: t\npackage: free\nreviewed_by: pending\nsource: s\nturns:\n  - student: hi\n    expect:\n      max_words: 5\n',
      );
      const { io, out } = capture();
      expect(await run(['eval', dir, '--fixtures', join(dir, 'fx')], io)).toBe(1);
      expect(out.join('')).toContain('run with --record first');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
