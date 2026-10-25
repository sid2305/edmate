// Task 8.7l: the browser-side publish client over a mocked `global.fetch` -- no real network
// call (rule 4). Covers a normal round-trip, a fetch that hangs until the fixed client timeout
// aborts it, and `failure()`'s zod `safeParse` over well-formed, extra-field and malformed error
// bodies.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FETCH_TIMEOUT_MS, loadLatestRun, startPublish } from './publishClient';

const RUN = {
  runId: 'run_1',
  status: 'queued' as const,
  changes: ['first_publish'],
  groups: [],
  errorCode: null,
  failedCases: [],
  scorecard: null,
  startedAt: '2026-10-22T10:00:00.000Z',
  finishedAt: null,
  publishedAt: null,
  changedSincePublish: false,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('loadLatestRun / startPublish: normal round-trip', () => {
  it('loadLatestRun parses a well-formed run', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { run: RUN }));
    const result = await loadLatestRun();
    expect(result).toEqual({ ok: true, value: RUN });
  });

  it('startPublish parses a well-formed {runId}', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(202, { runId: 'run_1' }));
    const result = await startPublish();
    expect(result).toEqual({ ok: true, value: { runId: 'run_1' } });
  });
});

describe('a hung fetch', () => {
  it('is aborted after FETCH_TIMEOUT_MS and resolves to a status-0 failure, not a hang', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = (init as RequestInit | undefined)?.signal;
          signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const pending = loadLatestRun();
    await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS + 1);
    const result = await pending;
    expect(result).toEqual({ ok: false, status: 0, code: 'provider_error' });
  });
});

describe('failure(): error bodies via safeParse', () => {
  it('a well-formed error body gives the code and reason', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(409, { error: { code: 'validation' }, reason: 'style_card_required' }),
    );
    const result = await startPublish();
    expect(result).toEqual({ ok: false, status: 409, code: 'validation', reason: 'style_card_required' });
  });

  it('an extra unknown field is ignored, not merged into the result', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(409, { error: { code: 'validation' }, reason: 'conflict', extra: 'unexpected' }),
    );
    const result = await startPublish();
    expect(result).toEqual({ ok: false, status: 409, code: 'validation', reason: 'conflict' });
    expect(result).not.toHaveProperty('extra');
  });

  it('a malformed body (wrong types) falls back to provider_error, no reason', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(500, { error: { code: 123 }, reason: true }));
    const result = await startPublish();
    expect(result).toEqual({ ok: false, status: 500, code: 'provider_error' });
  });
});
