// @vitest-environment jsdom
// Task 8.3 Phase C: the browser side of the studio outline API. Fetch is stubbed (rule 4).
// Written red before outlineClient.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateOutline, getOutline, putOutline } from './outlineClient';
import type { Outline, OutlineInput } from './outlineClient';

const reply = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function stubFetch(...responses: Response[]) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error('no stubbed response');
    return next;
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const outline: Outline = {
  courseId: 'crs_1',
  outlineVersion: 1,
  modules: [{ id: 'mod_1', title: 'Module 1', order: 0, topics: [] }],
};

describe('the outline calls', () => {
  it('gets the outline', async () => {
    const calls = stubFetch(reply(200, outline));
    await expect(getOutline()).resolves.toEqual({ ok: true, value: outline });
    expect(calls[0]!.url).toBe('/api/studio/outline');
    expect(calls[0]!.init).toMatchObject({ cache: 'no-store', method: 'GET' });
  });

  it('puts the outline with exactly the given tree', async () => {
    const updated = { ...outline, outlineVersion: 2 };
    const calls = stubFetch(reply(200, updated));
    const input: OutlineInput = {
      modules: [{ id: 'mod_1', title: 'Renamed', order: 0, topics: [] }],
    };
    await expect(putOutline(input)).resolves.toEqual({ ok: true, value: updated });
    expect(calls[0]!.url).toBe('/api/studio/outline');
    expect(calls[0]!.init).toMatchObject({ method: 'PUT', body: JSON.stringify(input) });
  });

  it('generates and saves a fresh outline', async () => {
    const calls = stubFetch(reply(200, outline));
    await expect(generateOutline()).resolves.toEqual({ ok: true, value: outline });
    expect(calls[0]!.url).toBe('/api/studio/outline/generate');
    expect(calls[0]!.init).toMatchObject({ method: 'POST' });
  });

  it('reads an error body as its code, and anything else as provider_error', async () => {
    stubFetch(
      reply(400, { error: { code: 'validation', message: 'x', retryable: false } }),
      new Response('<html>', { status: 502 }),
    );
    await expect(getOutline()).resolves.toEqual({ ok: false, status: 400, code: 'validation' });
    await expect(getOutline()).resolves.toEqual({
      ok: false,
      status: 502,
      code: 'provider_error',
    });
  });

  it('a network failure is provider_error with status 0', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('offline'))),
    );
    await expect(getOutline()).resolves.toEqual({
      ok: false,
      status: 0,
      code: 'provider_error',
    });
  });
});
