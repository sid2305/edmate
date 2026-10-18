import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fileRecorder,
  FixtureReadError,
  InvalidFixtureKeyError,
  memoryRecorder,
  MissingFixtureError,
} from './recorder.js';

const never = () => Promise.reject(new Error('fn must not be called in replay'));

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'evals-recorder-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('fileRecorder', () => {
  it('record calls fn once and writes one pretty JSON file per key', async () => {
    const fn = vi.fn(() => Promise.resolve({ text: 'hi', n: 1 }));
    const rec = fileRecorder(dir, 'record');
    await expect(rec.run('case-a/turn-0/agent', fn)).resolves.toEqual({ text: 'hi', n: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
    const path = join(dir, 'case-a', 'turn-0', 'agent.json');
    expect(readFileSync(path, 'utf8')).toBe('{\n  "text": "hi",\n  "n": 1\n}\n');
  });

  it('replay on a fresh recorder returns the recorded value without calling fn', async () => {
    await fileRecorder(dir, 'record').run('case-a/turn-0/judge-0', () =>
      Promise.resolve({ pass: true }),
    );
    const fn = vi.fn(never);
    await expect(fileRecorder(dir, 'replay').run('case-a/turn-0/judge-0', fn)).resolves.toEqual({
      pass: true,
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it('replay with no fixture throws MissingFixtureError telling you to --record', async () => {
    const fn = vi.fn(never);
    const err = await fileRecorder(dir, 'replay')
      .run('case-a/turn-0/agent', fn)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MissingFixtureError);
    expect((err as Error).message).toMatch(/run with --record first/);
    expect((err as MissingFixtureError).key).toBe('case-a/turn-0/agent');
    expect(fn).not.toHaveBeenCalled();
  });

  it('replay of a corrupt fixture throws FixtureReadError naming the key', async () => {
    mkdirSync(join(dir, 'case-a'), { recursive: true });
    writeFileSync(join(dir, 'case-a', 'agent.json'), '{not json');
    await expect(fileRecorder(dir, 'replay').run('case-a/agent', never)).rejects.toThrow(
      FixtureReadError,
    );
  });

  it('replay rethrows a read error other than a missing file', async () => {
    mkdirSync(join(dir, 'case-a', 'agent.json'), { recursive: true });
    await expect(fileRecorder(dir, 'replay').run('case-a/agent', never)).rejects.toThrow(
      FixtureReadError,
    );
  });

  it('record overwrites an older fixture and reports the overwritten key', async () => {
    const first = fileRecorder(dir, 'record');
    await first.run('k', () => Promise.resolve(1));
    await first.run('new/one', () => Promise.resolve(1));
    expect(first.overwritten()).toEqual([]);
    const second = fileRecorder(dir, 'record');
    await second.run('new/one', () => Promise.resolve(2));
    await second.run('k', () => Promise.resolve(2));
    await second.run('fresh', () => Promise.resolve(2));
    expect(second.overwritten()).toEqual(['new/one', 'k']);
    await expect(fileRecorder(dir, 'replay').run('k', never)).resolves.toBe(2);
  });

  it('replay reports nothing overwritten', async () => {
    await fileRecorder(dir, 'record').run('k', () => Promise.resolve(1));
    const rec = fileRecorder(dir, 'replay');
    await rec.run('k', never);
    expect(rec.overwritten()).toEqual([]);
  });

  it('record does not write a file when fn throws', async () => {
    const rec = fileRecorder(dir, 'record');
    await expect(rec.run('k', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(existsSync(join(dir, 'k.json'))).toBe(false);
  });

  it.each([['../escape'], ['/abs'], ['a/../b'], ['a\\b'], [''], ['a//b'], ['A/b'], ['a/']])(
    'rejects the unsafe key %j in both modes',
    async (key) => {
      await expect(fileRecorder(dir, 'record').run(key, never)).rejects.toThrow(
        InvalidFixtureKeyError,
      );
      await expect(fileRecorder(dir, 'replay').run(key, never)).rejects.toThrow(
        InvalidFixtureKeyError,
      );
    },
  );
});

describe('memoryRecorder', () => {
  it('records into a snapshot that seeds a replaying recorder', async () => {
    const rec = memoryRecorder('record');
    await rec.run('a/agent', () => Promise.resolve({ text: 'x' }));
    const snap = rec.snapshot();
    expect(snap).toEqual({ 'a/agent': { text: 'x' } });
    const fn = vi.fn(never);
    await expect(memoryRecorder('replay', snap).run('a/agent', fn)).resolves.toEqual({
      text: 'x',
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it('stores JSON copies, so later mutation of a result does not change the fixture', async () => {
    const rec = memoryRecorder('record');
    const value = { list: [1] };
    await rec.run('k', () => Promise.resolve(value));
    value.list.push(2);
    expect(rec.snapshot()).toEqual({ k: { list: [1] } });
  });

  it('reports a seeded key that record overwrites', async () => {
    const rec = memoryRecorder('record', { k: 1 });
    await rec.run('k', () => Promise.resolve(2));
    await rec.run('other', () => Promise.resolve(2));
    expect(rec.overwritten()).toEqual(['k']);
    expect(rec.snapshot()).toEqual({ k: 2, other: 2 });
  });

  it('replay with no seed entry throws MissingFixtureError', async () => {
    await expect(memoryRecorder('replay').run('k', never)).rejects.toThrow(MissingFixtureError);
  });

  it('rejects unsafe keys like the file recorder', async () => {
    await expect(memoryRecorder('record').run('../x', never)).rejects.toThrow(
      InvalidFixtureKeyError,
    );
  });
});
