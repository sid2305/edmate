// @vitest-environment jsdom
// Task 8.4b: the browser side of the studio style-card API. Fetch is stubbed (rule 4); no real
// model or database call. Mirrors uploadClient.test.ts's shape.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { draftStyleCardApi, getStyleCard, saveStyleCard } from './styleCardClient';

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

const CARD = { id: 'sty_1', teacherId: 't_1', version: 1, text: 'Warm.', mistakeTags: ['units'] };
const DRAFT = { text: 'Warm and brief.', mistakeTags: ['units'] };

describe('getStyleCard', () => {
  it('reads the current card', async () => {
    const calls = stubFetch(reply(200, { card: CARD }));
    await expect(getStyleCard()).resolves.toEqual({ ok: true, value: CARD });
    expect(calls[0]!.url).toBe('/api/studio/style-card');
    expect(calls[0]!.init).toMatchObject({ method: 'GET', cache: 'no-store' });
  });

  it('reads null before a first save', async () => {
    stubFetch(reply(200, { card: null }));
    await expect(getStyleCard()).resolves.toEqual({ ok: true, value: null });
  });
});

describe('draftStyleCardApi', () => {
  it('posts the interview and returns the draft', async () => {
    const interview = {
      answers: { tone: 'Warm.' },
      sampleExplanations: ['Add the tops.'],
      mistakeCandidates: ['units'],
    };
    const calls = stubFetch(reply(200, { draft: DRAFT }));
    await expect(draftStyleCardApi(interview)).resolves.toEqual({ ok: true, value: DRAFT });
    expect(calls[0]!.url).toBe('/api/studio/style-card/draft');
    expect(calls[0]!.init).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(interview),
    });
  });
});

describe('saveStyleCard', () => {
  it('PUTs the text and tags and returns the saved card', async () => {
    const calls = stubFetch(reply(201, { card: CARD }));
    await expect(
      saveStyleCard({ text: CARD.text, mistakeTags: CARD.mistakeTags }),
    ).resolves.toEqual({ ok: true, value: CARD });
    expect(calls[0]!.url).toBe('/api/studio/style-card');
    expect(calls[0]!.init).toMatchObject({
      method: 'PUT',
      body: JSON.stringify({ text: CARD.text, mistakeTags: CARD.mistakeTags }),
    });
  });
});

describe('errors', () => {
  it('reads an error body as its code, and anything else as provider_error', async () => {
    stubFetch(
      reply(400, { error: { code: 'validation', message: 'x', retryable: false } }),
      new Response('<html>', { status: 502 }),
    );
    await expect(saveStyleCard({ text: 'x', mistakeTags: [] })).resolves.toEqual({
      ok: false,
      status: 400,
      code: 'validation',
    });
    await expect(getStyleCard()).resolves.toEqual({
      ok: false,
      status: 502,
      code: 'provider_error',
    });
  });

  it('a 200 with malformed JSON is provider_error, not a rejection', async () => {
    const malformed = new Response('not json', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    stubFetch(malformed);
    await expect(getStyleCard()).resolves.toEqual({
      ok: false,
      status: 200,
      code: 'provider_error',
    });
  });

  it('a network failure is provider_error with status 0', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('offline'))),
    );
    await expect(getStyleCard()).resolves.toEqual({
      ok: false,
      status: 0,
      code: 'provider_error',
    });
  });
});
