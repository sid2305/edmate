// Fetching a recording through its signed URL (ADR-0005, Decision 5): allowlisted hosts only,
// no redirect off the host, size and time limits, and the URL never in an error.
import { describe, expect, it } from 'vitest';
import { TranscriberError } from '../../src/transcriber/errors.js';
import {
  allowedUrl,
  download,
  normaliseAllowedHosts,
  redactUrl,
} from '../../src/transcriber/source.js';
import { type FakeResponse, fetchMock } from '../helpers/fetch-mock.js';

const HOST = 'storage.edmate.invalid';
const SIGNED = `https://storage.edmate.invalid/recordings/class-7.mp3?X-Amz-Signature=fake0sig0value&X-Amz-Expires=600`;
const QUERY = 'X-Amz-Signature=fake0sig0value';

const hosts = normaliseAllowedHosts([HOST]);

function opts(
  responses: readonly FakeResponse[],
  over: { maxBytes?: number; timeoutMs?: number } = {},
) {
  const mock = fetchMock(responses);
  return {
    mock,
    o: {
      allowedHosts: hosts,
      fetch: mock.fetch,
      maxBytes: over.maxBytes ?? 1_000,
      timeoutMs: over.timeoutMs ?? 5_000,
    },
  };
}

async function failure(p: Promise<unknown>): Promise<TranscriberError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(TranscriberError);
    const e = err as TranscriberError;
    // Never the signed URL, in any form an error can be printed in.
    const printed = [e.message, String(e.stack), JSON.stringify(e), String(e.cause)].join('\n');
    expect(printed.includes(QUERY)).toBe(false);
    expect(printed.includes('fake0sig0value')).toBe(false);
    expect(e.cause).toBeUndefined();
    return e;
  }
  throw new Error('expected a TranscriberError');
}

describe('redactUrl', () => {
  it('keeps scheme, host and path; drops userinfo, query and fragment', () => {
    expect(redactUrl(SIGNED)).toBe(`https://storage.edmate.invalid/recordings/class-7.mp3`);
    expect(redactUrl(`https://u:p@storage.edmate.invalid:8443/a/b?q=1#frag`)).toBe(
      `https://storage.edmate.invalid:8443/a/b`,
    );
    expect(redactUrl('not a url ?token=abc')).toBe('[unparseable url]');
  });
});

describe('normaliseAllowedHosts', () => {
  it('accepts bare hosts, with or without a port, lower-cased', () => {
    expect([
      ...normaliseAllowedHosts([HOST, 'cdn.edmate.invalid:8443', 'Media.Edmate.invalid']),
    ]).toEqual([HOST, 'cdn.edmate.invalid:8443', 'media.edmate.invalid']);
    expect(normaliseAllowedHosts([]).size).toBe(0);
  });

  it.each([
    'https://storage.edmate.invalid',
    'storage.edmate.invalid/path',
    'user@storage.edmate.invalid',
    '',
    'storage.edmate.invalid:443',
    'bad host',
  ])('rejects %j at construction, without echoing it', (entry) => {
    expect(() => normaliseAllowedHosts([entry])).toThrow(
      'transcriber: every allowedHosts entry must be a bare host such as storage.example.com',
    );
  });
});

describe('allowedUrl', () => {
  it('matches the parsed host exactly', () => {
    expect(allowedUrl(SIGNED, hosts).host).toBe(HOST);
  });

  it.each([
    ['an empty allowlist', SIGNED, normaliseAllowedHosts([])],
    ['another host', 'https://evil.invalid/x.mp3?sig=1', hosts],
    ['a suffix of an allowed host', `https://evilstorage.edmate.invalid/x.mp3`, hosts],
    ['a subdomain of an allowed host', `https://a.storage.edmate.invalid/x.mp3`, hosts],
    ['an allowed host on another port', `https://storage.edmate.invalid:8443/x.mp3`, hosts],
    ['http', `http://storage.edmate.invalid/x.mp3`, hosts],
  ])('refuses %s', async (_name, url, allow) => {
    const err = await failure(Promise.resolve().then(() => allowedUrl(url, allow)));
    expect(err.code).toBe('forbidden');
    expect(err.retryable).toBe(false);
    expect(err.message).toBe('transcriber: the recording URL is not on an allowed storage host');
  });
});

describe('download', () => {
  const audio = new Uint8Array([1, 2, 3, 4, 5]);

  it('returns the bytes and never follows redirects on its own', async () => {
    const { mock, o } = opts([{ body: audio }]);
    expect(await download(new URL(SIGNED), o)).toEqual(audio);
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0]?.url).toBe(SIGNED);
    expect(mock.requests[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('follows a same-host https redirect, relative or absolute', async () => {
    const { mock, o } = opts([
      { status: 302, body: '', headers: { location: '/moved/a.mp3?sig=2' } },
      {
        status: 307,
        body: '',
        headers: { location: `https://storage.edmate.invalid/final.mp3?sig=3` },
      },
      { body: audio },
    ]);
    expect(await download(new URL(SIGNED), o)).toEqual(audio);
    expect(mock.requests.map((r) => new URL(r.url).pathname)).toEqual([
      '/recordings/class-7.mp3',
      '/moved/a.mp3',
      '/final.mp3',
    ]);
  });

  it.each([
    ['another host', 'https://evil.invalid/a.mp3?sig=2'],
    ['http on the same host', `http://storage.edmate.invalid/a.mp3`],
    ['a subdomain', `https://x.storage.edmate.invalid/a.mp3`],
  ])('refuses a redirect to %s and fetches nothing more', async (_name, location) => {
    const { mock, o } = opts([{ status: 301, body: '', headers: { location } }, { body: audio }]);
    const err = await failure(download(new URL(SIGNED), o));
    expect(err.code).toBe('forbidden');
    expect(err.message).toBe('transcriber: storage redirected to another host; refused');
    expect(mock.requests).toHaveLength(1);
  });

  it('refuses a redirect with no location, and more than three redirects', async () => {
    const none = opts([{ status: 302, body: '' }]);
    expect((await failure(download(new URL(SIGNED), none.o))).message).toBe(
      'transcriber: storage sent a redirect with no location',
    );
    const hop = { status: 302, body: '', headers: { location: '/again.mp3' } };
    const loop = opts([hop, hop, hop, hop, { body: audio }]);
    const err = await failure(download(new URL(SIGNED), loop.o));
    expect(err.message).toBe('transcriber: storage redirected too many times');
    expect(loop.mock.requests).toHaveLength(4);
  });

  it.each([
    [401, 'forbidden', false],
    [403, 'forbidden', false],
    [404, 'not_found', false],
    [410, 'not_found', false],
    [429, 'rate_limited', true],
    [500, 'provider_error', true],
    [503, 'provider_error', true],
    [400, 'provider_error', false],
  ] as const)('HTTP %i from storage is %s (retryable %s)', async (status, code, retryable) => {
    const { o } = opts([{ status, body: 'Access denied for X-Amz-Signature=fake0sig0value' }]);
    const err = await failure(download(new URL(SIGNED), o));
    expect(err.code).toBe(code);
    expect(err.retryable).toBe(retryable);
  });

  it('a status below 200 is not success', async () => {
    const res = new Response('x', { status: 200 });
    Object.defineProperty(res, 'status', { value: 199 });
    const err = await failure(
      download(new URL(SIGNED), { ...opts([]).o, fetch: () => Promise.resolve(res) }),
    );
    expect(err.code).toBe('provider_error');
  });

  it('an empty body is a validation error, never an empty recording', async () => {
    const { o } = opts([{ body: new Uint8Array(0) }]);
    const err = await failure(download(new URL(SIGNED), o));
    expect(err.code).toBe('validation');
    expect(err.message).toBe('transcriber: the recording is empty');
  });

  it.each([200, 204])('a null body (HTTP %i) is empty too', async (status) => {
    const err = await failure(
      download(new URL(SIGNED), {
        ...opts([]).o,
        fetch: () => Promise.resolve(new Response(null, { status })),
      }),
    );
    expect(err.code).toBe('validation');
    expect(err.message).toBe('transcriber: the recording is empty');
  });

  it('refuses a declared content-length over the limit before reading it', async () => {
    const { o } = opts([{ body: new Uint8Array(10), headers: { 'content-length': '5000' } }]);
    const err = await failure(download(new URL(SIGNED), o));
    expect(err.code).toBe('input_too_large');
    expect(err.message).toBe(
      'transcriber: the recording is larger than the 1000-byte download limit',
    );
  });

  it('stops reading a body that grows past the limit', async () => {
    const { o } = opts([{ body: new Uint8Array(1_001) }]);
    expect((await failure(download(new URL(SIGNED), o))).code).toBe('input_too_large');
    const exact = opts([{ body: new Uint8Array(1_000) }]);
    expect((await download(new URL(SIGNED), exact.o)).byteLength).toBe(1_000);
  });

  it('a timeout is retryable and names no URL', async () => {
    const { o } = opts([{ body: 'x', hold: true, contentType: 'audio/mpeg' }], { timeoutMs: 20 });
    const err = await failure(download(new URL(SIGNED), o));
    expect(err.code).toBe('provider_error');
    expect(err.retryable).toBe(true);
    expect(err.message).toBe('transcriber: the recording download timed out');
  });

  it('a network failure quoting the URL becomes a fixed message with no cause', async () => {
    const fetch = () => Promise.reject(new TypeError(`fetch failed for ${SIGNED}`));
    const err = await failure(download(new URL(SIGNED), { ...opts([]).o, fetch }));
    expect(err.code).toBe('provider_error');
    expect(err.retryable).toBe(true);
    expect(err.message).toBe('transcriber: could not download the recording from storage');
  });

  it('an AbortError from the transport is a timeout too', async () => {
    const fetch = () => Promise.reject(new DOMException(`aborted ${SIGNED}`, 'AbortError'));
    const err = await failure(download(new URL(SIGNED), { ...opts([]).o, fetch }));
    expect(err.message).toBe('transcriber: the recording download timed out');
  });

  it('a non-Error rejection is a download failure', async () => {
    const fetch = () => Promise.reject(SIGNED as unknown as Error);
    const err = await failure(download(new URL(SIGNED), { ...opts([]).o, fetch }));
    expect(err.message).toBe('transcriber: could not download the recording from storage');
  });
});
