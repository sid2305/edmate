// Task 8.6 Phase C: the packages backend is built lazily, once: the newest signed prompt-pack set
// from the content dir, MODEL_MIX.paid and the per-turn cost from the bundled prices. No signed
// set (or an unpriced mix) is StudioUnavailableError -> 503, logged by reason code only.
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { newestSignedSet, readPromptPackLibrary } from '@edmate/content';
import { loadBundledPrices, MODEL_MIX, turnCostMicroUsd } from '@edmate/gateway';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { createPackageHandlers } from './packages';
import { createPackagesRuntime } from './packagesRuntime';
import { StudioUnavailableError } from './routes';

const CONTENT = resolve(__dirname, '../../../../content');
const REPOS = {} as never;
const repos = () => REPOS;
/** A library with no signed set (only `values()` is read). */
const noSignedSet = () => new Map() as never;

function hooks(extra: Record<string, unknown> = {}) {
  return { repos, log: { error: vi.fn() }, ...extra };
}

function emptyContentDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'edmate-86c-'));
  mkdirSync(join(dir, 'prompt-packs'));
  return dir;
}

describe('createPackagesRuntime', () => {
  it('pins the newest signed set, MODEL_MIX.paid and the bundled per-turn cost, built once', async () => {
    const h = hooks();
    const read = vi.fn(readPromptPackLibrary);
    const runtime = createPackagesRuntime(() => ({ EDMATE_CONTENT_DIR: CONTENT }), {
      ...h,
      readPromptPacks: read,
    });
    const b = await runtime();
    const expected = newestSignedSet(readPromptPackLibrary(join(CONTENT, 'prompt-packs')));
    expect(expected).toBeDefined();
    expect(b.promptPackVersion).toBe(expected!.version);
    expect(b.modelPolicy).toBe(MODEL_MIX.paid);
    expect(b.perTurnMicroUsd).toBe(turnCostMicroUsd(MODEL_MIX.paid, loadBundledPrices()));
    expect(b.repos).toBe(REPOS);
    expect(b.log).toBe(h.log);
    expect(await runtime()).toBe(b);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(join(CONTENT, 'prompt-packs'));
    expect(h.log.error).not.toHaveBeenCalled();
  });

  it('the repos getter is read lazily, per access', async () => {
    const r = vi.fn(() => ({}) as never);
    const b = await createPackagesRuntime(() => ({ EDMATE_CONTENT_DIR: CONTENT }), {
      repos: r,
      log: { error: vi.fn() },
    })();
    expect(r).not.toHaveBeenCalled();
    void b.repos;
    expect(r).toHaveBeenCalledTimes(1);
  });

  it('no signed set: StudioUnavailableError, logged by code, retried on the next call', async () => {
    const h = hooks();
    const dir = emptyContentDir();
    const runtime = createPackagesRuntime(() => ({ EDMATE_CONTENT_DIR: dir }), {
      ...h,
      readPromptPacks: noSignedSet,
    });
    await expect(runtime()).rejects.toBeInstanceOf(StudioUnavailableError);
    await expect(runtime()).rejects.toThrow('prompt_packs_unsigned');
    expect(h.log.error.mock.calls).toEqual([
      ['studio.packages_runtime_unavailable', { reason: 'prompt_packs_unsigned' }],
      ['studio.packages_runtime_unavailable', { reason: 'prompt_packs_unsigned' }],
    ]);
    expect(JSON.stringify(h.log.error.mock.calls)).not.toContain(dir);
  });

  it('an unreadable prompt-pack dir is prompt_packs, never its path or issues', async () => {
    const h = hooks();
    const runtime = createPackagesRuntime(() => ({ EDMATE_CONTENT_DIR: '/nonexistent-86c' }), {
      ...h,
      readPromptPacks: () => {
        throw new Error('invalid prompt packs in /nonexistent-86c');
      },
    });
    await expect(runtime()).rejects.toThrow('prompt_packs');
    expect(h.log.error.mock.calls).toEqual([
      ['studio.packages_runtime_unavailable', { reason: 'prompt_packs' }],
    ]);
  });

  it('an unpriced model in the mix is unpriced_model, never a $0 estimate', async () => {
    const h = hooks();
    const runtime = createPackagesRuntime(() => ({ EDMATE_CONTENT_DIR: CONTENT }), {
      ...h,
      prices: () => ({ scaled: () => undefined }) as never,
    });
    await expect(runtime()).rejects.toThrow('unpriced_model');
    expect(h.log.error).toHaveBeenCalledWith('studio.packages_runtime_unavailable', {
      reason: 'unpriced_model',
    });
  });

  it('any other build failure is logged by its error name', async () => {
    const h = hooks();
    const runtime = createPackagesRuntime(() => ({ EDMATE_CONTENT_DIR: CONTENT }), {
      ...h,
      prices: () => {
        throw new SyntaxError('bad yaml');
      },
    });
    await expect(runtime()).rejects.toThrow('bad yaml');
    expect(h.log.error).toHaveBeenCalledWith('studio.packages_runtime_unavailable', {
      reason: 'SyntaxError',
    });
  });

  it('the handlers answer 503 with the reason logged by code', async () => {
    const dir = emptyContentDir();
    const fallbackLog = { error: vi.fn() };
    const h = createPackageHandlers(
      createPackagesRuntime(() => ({ EDMATE_CONTENT_DIR: dir }), hooks({ readPromptPacks: noSignedSet })),
      fallbackLog,
    );
    const res = await h.list(new NextRequest('http://localhost:8080/api/studio/packages'), {
      principal: { userId: 't_asha', role: 'teacher' },
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(fallbackLog.error).toHaveBeenCalledWith('studio.packages_unavailable', {
      reason: 'prompt_packs_unsigned',
    });
  });
});
