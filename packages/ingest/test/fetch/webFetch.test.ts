import { describe, expect, it, vi } from 'vitest';
import { IngestError } from '../../src/errors.js';
import {
  createWebFetcher,
  normaliseAllowedHosts,
  redactUrl,
  type WebFetcherOptions,
} from '../../src/fetch/webFetch.js';

const PUBLIC_V4 = '93.184.216.34';
const PUBLIC_V6 = '2606:4700:4700::1111';
const HOST = 'lessons.example.org';
const LEAK_MARK = 'leak-marker-qz';
const PAGE = `https://${HOST}/unit/1?key=${LEAK_MARK}`;

interface Reply {
  readonly status?: number;
  readonly body?: string | Uint8Array | ReadableStream<Uint8Array> | null;
  readonly headers?: Readonly<Record<string, string>>;
}

function fakeFetch(replies: readonly Reply[]) {
  const queue = [...replies];
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = queue.shift();
    if (next === undefined) return Promise.reject(new Error('no reply queued'));
    const body = next.body === undefined ? '<p>ok</p>' : next.body;
    return Promise.resolve(
      new Response(body as ConstructorParameters<typeof Response>[0], {
        status: next.status ?? 200,
        headers: { 'content-type': 'text/html; charset=utf-8', ...next.headers },
      }),
    );
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls, spy: fetch };
}

function fetcher(
  replies: readonly Reply[],
  over: Partial<WebFetcherOptions> = {},
): { f: ReturnType<typeof createWebFetcher>; calls: ReturnType<typeof fakeFetch>['calls'] } {
  const ff = fakeFetch(replies);
  const f = createWebFetcher({
    allowedHosts: [HOST, 'www.example.org'],
    fetch: ff.fetch,
    resolveHost: () => Promise.resolve([PUBLIC_V4]),
    ...over,
  });
  return { f, calls: ff.calls };
}

async function failure(p: Promise<unknown>): Promise<IngestError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(IngestError);
    const e = err as IngestError;
    // The fetched URL may carry a token: it is never echoed, not even in toJSON.
    expect(JSON.stringify(e)).not.toContain(LEAK_MARK);
    expect(e.message).not.toContain(LEAK_MARK);
    expect(e.message).not.toContain('/unit/');
    return e;
  }
  throw new Error('expected a rejection');
}

function streamOf(chunks: readonly string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
}

describe('createWebFetcher: happy path', () => {
  it('fetches an allowlisted https page with manual redirects and returns its HTML', async () => {
    const { f, calls } = fetcher([{ body: '<h1>Hi</h1>' }]);
    await expect(f.fetchPage(PAGE)).resolves.toEqual({ html: '<h1>Hi</h1>' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(PAGE);
    expect(calls[0]?.init?.redirect).toBe('manual');
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('accepts xhtml, a public IPv6 resolution and an upper-case host', async () => {
    const { f } = fetcher([{ headers: { 'content-type': 'application/xhtml+xml' } }], {
      resolveHost: () => Promise.resolve([PUBLIC_V6]),
    });
    await expect(f.fetchPage(`https://LESSONS.example.org/a`)).resolves.toEqual({
      html: '<p>ok</p>',
    });
  });

  it('decodes the declared charset, and falls back to UTF-8 for an unknown one', async () => {
    const latin1 = new Uint8Array([0x63, 0x61, 0x66, 0xe9]); // "café" in windows-1252
    const { f } = fetcher([
      { body: latin1, headers: { 'content-type': 'text/html; charset=windows-1252' } },
      { body: 'plain', headers: { 'content-type': 'text/html; charset=nonsense-9' } },
    ]);
    await expect(f.fetchPage(PAGE)).resolves.toEqual({ html: 'café' });
    await expect(f.fetchPage(PAGE)).resolves.toEqual({ html: 'plain' });
  });

  it('follows a redirect to another allowlisted host over https, re-checking its addresses', async () => {
    const resolveHost = vi.fn(() => Promise.resolve([PUBLIC_V4]));
    const { f, calls } = fetcher(
      [
        { status: 301, headers: { location: 'https://www.example.org/moved' } },
        { status: 302, headers: { location: '/final' } },
        { body: '<p>moved</p>' },
      ],
      { resolveHost },
    );
    await expect(f.fetchPage(PAGE)).resolves.toEqual({ html: '<p>moved</p>' });
    expect(calls.map((c) => c.url)).toEqual([
      PAGE,
      'https://www.example.org/moved',
      'https://www.example.org/final',
    ]);
    expect(resolveHost.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      HOST,
      'www.example.org',
      'www.example.org',
    ]);
  });
});

describe('createWebFetcher: SSRF refusals (fetch is never reached)', () => {
  it.each([
    ['plain http', `http://${HOST}/a`],
    ['ftp', `ftp://${HOST}/a`],
    ['a host not on the allowlist', 'https://evil.example.net/a'],
    ['an allowlisted suffix is not a match', `https://x.${HOST}/a`],
    ['userinfo in the URL', `https://user:pw@${HOST}/a`],
    ['a port the allowlist does not name', `https://${HOST}:8443/a`],
  ])('refuses %s', async (_label, url) => {
    const { f, calls } = fetcher([]);
    const e = await failure(f.fetchPage(url));
    expect(e.code).toBe('forbidden');
    expect(calls).toHaveLength(0);
  });

  it('an empty allowlist refuses everything', async () => {
    const { f, calls } = fetcher([], { allowedHosts: [] });
    expect((await failure(f.fetchPage(PAGE))).code).toBe('forbidden');
    expect(calls).toHaveLength(0);
  });

  it('an unparseable URL is a validation error', async () => {
    const { f } = fetcher([]);
    expect((await failure(f.fetchPage('not a url'))).code).toBe('validation');
  });

  it.each([
    ['loopback v4', '127.0.0.1', '127.0.0.1'],
    ['loopback v4 in decimal form', '127.0.0.1', '2130706433'],
    ['private 10/8', '10.1.2.3', '10.1.2.3'],
    ['cloud metadata', '169.254.169.254', '169.254.169.254'],
    ['loopback v6', '[::1]', '[::1]'],
    ['v4-mapped loopback v6', '[::ffff:7f00:1]', '[::ffff:127.0.0.1]'],
    ['unique-local v6', '[fd00:ec2::254]', '[fd00:ec2::254]'],
  ])('refuses an allowlisted IP literal that is not public: %s', async (_label, allow, host) => {
    const resolveHost = vi.fn(() => Promise.resolve([PUBLIC_V4]));
    const { f, calls } = fetcher([], { allowedHosts: [allow], resolveHost });
    expect((await failure(f.fetchPage(`https://${host}/x`))).code).toBe('forbidden');
    expect(calls).toHaveLength(0);
    expect(resolveHost).not.toHaveBeenCalled();
  });

  it('fetches an allowlisted public IP literal without a DNS lookup', async () => {
    const resolveHost = vi.fn(() => Promise.resolve([PUBLIC_V4]));
    const { f } = fetcher([{}], { allowedHosts: [PUBLIC_V4], resolveHost });
    await expect(f.fetchPage(`https://${PUBLIC_V4}/x`)).resolves.toEqual({ html: '<p>ok</p>' });
    expect(resolveHost).not.toHaveBeenCalled();
  });

  it.each([
    ['a private address', ['10.0.0.5']],
    ['one private among public ones', [PUBLIC_V4, '192.168.1.10']],
    ['link-local v6', ['fe80::1%en0']],
    ['metadata', ['169.254.169.254']],
  ])('refuses a hostname that resolves to %s', async (_label, addrs) => {
    const { f, calls } = fetcher([], { resolveHost: () => Promise.resolve(addrs) });
    expect((await failure(f.fetchPage(PAGE))).code).toBe('forbidden');
    expect(calls).toHaveLength(0);
  });

  it('a hostname that resolves to nothing, or fails to resolve, is not_found', async () => {
    const empty = fetcher([], { resolveHost: () => Promise.resolve([]) });
    expect((await failure(empty.f.fetchPage(PAGE))).code).toBe('not_found');
    const broken = fetcher([], {
      resolveHost: () => Promise.reject(new Error(`ENOTFOUND ${PAGE}`)),
    });
    expect((await failure(broken.f.fetchPage(PAGE))).code).toBe('not_found');
  });
});

describe('createWebFetcher: redirects', () => {
  it.each([
    ['off the allowlist', 'https://evil.example.net/x'],
    ['down to http', `http://${HOST}/x`],
    ['to an internal address', 'https://169.254.169.254/latest/meta-data'],
  ])('refuses a redirect %s', async (_label, location) => {
    const { f, calls } = fetcher([{ status: 302, headers: { location } }]);
    expect((await failure(f.fetchPage(PAGE))).code).toBe('forbidden');
    expect(calls).toHaveLength(1);
  });

  it('refuses a redirect to an allowlisted host whose DNS now points inside', async () => {
    const resolveHost = vi.fn((host: string) =>
      Promise.resolve(host === HOST ? [PUBLIC_V4] : ['127.0.0.1']),
    );
    const { f, calls } = fetcher(
      [{ status: 307, headers: { location: 'https://www.example.org/x' } }],
      { resolveHost },
    );
    expect((await failure(f.fetchPage(PAGE))).code).toBe('forbidden');
    expect(calls).toHaveLength(1);
  });

  it('a redirect with no location, and more than three hops, are refused', async () => {
    const none = fetcher([{ status: 302 }]);
    expect((await failure(none.f.fetchPage(PAGE))).code).toBe('provider_error');
    const hop = { status: 302, headers: { location: '/again' } };
    const loop = fetcher([hop, hop, hop, hop, hop]);
    const e = await failure(loop.f.fetchPage(PAGE));
    expect(e.code).toBe('provider_error');
    expect(loop.calls).toHaveLength(4);
  });
});

describe('createWebFetcher: responses', () => {
  it.each([
    [401, 'forbidden', false],
    [403, 'forbidden', false],
    [404, 'not_found', false],
    [410, 'not_found', false],
    [429, 'rate_limited', true],
    [503, 'provider_error', true],
    [418, 'provider_error', false],
  ] as const)('HTTP %i maps to %s (retryable %s)', async (status, code, retryable) => {
    const { f } = fetcher([{ status, body: 'nope' }]);
    const e = await failure(f.fetchPage(PAGE));
    expect([e.code, e.retryable]).toEqual([code, retryable]);
  });

  it.each([
    ['a PDF', 'application/pdf'],
    ['JSON', 'application/json'],
    ['no content type', ''],
  ])('refuses %s as unsupported (not a web page)', async (_label, type) => {
    const { f } = fetcher([{ headers: { 'content-type': type } }]);
    expect((await failure(f.fetchPage(PAGE))).code).toBe('unsupported');
  });

  it('refuses a declared length over the cap before reading the body', async () => {
    const { f } = fetcher([{ body: 'x'.repeat(20), headers: { 'content-length': '20' } }], {
      maxBytes: 10,
    });
    expect((await failure(f.fetchPage(PAGE))).code).toBe('input_too_large');
  });

  it('stops reading a stream as soon as it passes the cap', async () => {
    const { f } = fetcher([{ body: streamOf(['12345', '67890', 'X']) }], { maxBytes: 10 });
    expect((await failure(f.fetchPage(PAGE))).code).toBe('input_too_large');
  });

  it('joins a chunked stream that fits, and ignores a compressed declared length', async () => {
    const { f } = fetcher([
      { body: streamOf(['<p>', 'ok', '</p>']) },
      { body: 'abc', headers: { 'content-encoding': 'gzip', 'content-length': '999' } },
    ]);
    await expect(f.fetchPage(PAGE)).resolves.toEqual({ html: '<p>ok</p>' });
    await expect(f.fetchPage(PAGE)).resolves.toEqual({ html: 'abc' });
  });

  it('a body shorter than its declared length is a truncated download', async () => {
    const { f } = fetcher([{ body: streamOf(['abc']), headers: { 'content-length': '10' } }]);
    const e = await failure(f.fetchPage(PAGE));
    expect([e.code, e.retryable]).toEqual(['provider_error', true]);
  });

  it('an empty page is a validation error', async () => {
    const { f } = fetcher([{ body: null }, { body: '' }]);
    expect((await failure(f.fetchPage(PAGE))).code).toBe('validation');
    expect((await failure(f.fetchPage(PAGE))).code).toBe('validation');
  });

  it('a timeout and a network failure are retryable provider errors, with the URL dropped', async () => {
    const timeout = Object.assign(new Error(`timed out ${PAGE}`), { name: 'TimeoutError' });
    const t = fetcher([], {
      fetch: () => Promise.reject(timeout),
    });
    const e1 = await failure(t.f.fetchPage(PAGE));
    expect([e1.code, e1.retryable]).toEqual(['provider_error', true]);
    expect(e1.message).toContain('timed out');
    const n = fetcher([], { fetch: () => Promise.reject(new TypeError(`fetch failed ${PAGE}`)) });
    const e2 = await failure(n.f.fetchPage(PAGE));
    expect([e2.code, e2.retryable]).toEqual(['provider_error', true]);
    expect(e2.cause).toBeUndefined();
  });
});

describe('createWebFetcher: other transport failures', () => {
  it('an abort, a non-Error rejection and a missing content type are all handled', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const a = fetcher([], { fetch: () => Promise.reject(abort) });
    expect((await failure(a.f.fetchPage(PAGE))).message).toContain('timed out');
    const s = fetcher([], { fetch: () => Promise.reject(new Error('x', { cause: 'boom' }).cause) });
    expect((await failure(s.f.fetchPage(PAGE))).code).toBe('provider_error');
    const bare = fetcher([], {
      fetch: () => Promise.resolve(new Response(new Uint8Array([60]), { status: 200 })),
    });
    expect((await failure(bare.f.fetchPage(PAGE))).code).toBe('unsupported');
  });
});

describe('helpers', () => {
  it('redactUrl keeps scheme, host and path only', () => {
    expect(redactUrl(`https://u:p@${HOST}/a/b?key=${LEAK_MARK}#frag`)).toBe(`https://${HOST}/a/b`);
    expect(redactUrl('::nope')).toBe('[unparseable url]');
  });

  it('normaliseAllowedHosts lower-cases bare hosts and rejects anything else', () => {
    expect([...normaliseAllowedHosts(['Lessons.Example.org', 'a.example:8443'])]).toEqual([
      'lessons.example.org',
      'a.example:8443',
    ]);
    for (const bad of ['https://a.example', 'a.example/path', '', 'a b', 'u@a.example']) {
      expect(() => normaliseAllowedHosts([bad])).toThrow(/bare host/);
    }
  });
});
