// The SSRF-safe web fetcher (tasks 5.1 and 8.2d, ADR-0014), driven through a fake resolver and a
// fake pinned transport: no socket is ever opened (rule 4).
import { gzipSync } from 'node:zlib';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { IngestError } from '../../src/errors.js';
import {
  createWebFetcher,
  normaliseAllowedHosts,
  redactUrl,
  WEB_FETCH_HEADERS,
  WEB_PAGE_MAX_BYTES,
  type PinnedTransport,
  type TransportRequest,
  type TransportResponse,
  type WebFetcherOptions,
} from '../../src/fetch/webFetch.js';
import { REFUSED_URLS, YOUTUBE_URLS } from './urlTable.js';

const PUBLIC_V4 = '93.184.216.34';
const PUBLIC_V6 = '2606:4700:4700::1111';
const HOST = 'lessons.example.org';
const LEAK_MARK = 'leak-marker-qz';
const PAGE = `https://${HOST}/unit/1?key=${LEAK_MARK}`;

interface Reply {
  readonly status?: number;
  readonly body?: string | Uint8Array | AsyncIterable<Uint8Array>;
  readonly headers?: Readonly<Record<string, string>>;
}

const enc = new TextEncoder();

async function* chunksOf(parts: readonly (string | Uint8Array)[]): AsyncIterable<Uint8Array> {
  for (const p of parts) {
    await Promise.resolve();
    yield typeof p === 'string' ? enc.encode(p) : p;
  }
}

function fakeTransport(replies: readonly Reply[]) {
  const queue = [...replies];
  const calls: TransportRequest[] = [];
  let cancels = 0;
  const transport: PinnedTransport = (req) => {
    calls.push(req);
    const next = queue.shift();
    if (next === undefined) return Promise.reject(new Error('no reply queued'));
    const headers: Record<string, string> = {
      'content-type': 'text/html; charset=utf-8',
      ...next.headers,
    };
    const raw = next.body ?? '<p>ok</p>';
    const body: AsyncIterable<Uint8Array> =
      typeof raw === 'string' || raw instanceof Uint8Array ? chunksOf([raw]) : raw;
    const res: TransportResponse = {
      status: next.status ?? 200,
      header: (name) => headers[name.toLowerCase()],
      body,
      cancel: () => {
        cancels += 1;
        return Promise.resolve();
      },
    };
    return Promise.resolve(res);
  };
  return { transport, calls, cancels: () => cancels };
}

function fetcher(replies: readonly Reply[], over: Partial<WebFetcherOptions> = {}) {
  const ft = fakeTransport(replies);
  const f = createWebFetcher({
    allowedHosts: [HOST, 'www.example.org'],
    transport: ft.transport,
    resolveHost: () => Promise.resolve([PUBLIC_V4]),
    ...over,
  });
  return { f, calls: ft.calls, cancels: ft.cancels };
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
    expect(e.cause).toBeUndefined();
    return e;
  }
  throw new Error('expected a rejection');
}

describe('createWebFetcher: the pinned address', () => {
  it('hands the transport the resolved address, the fixed headers and a deadline signal', async () => {
    const { f, calls, cancels } = fetcher([{ body: '<h1>Hi</h1>' }]);
    await expect(f.fetchPage(PAGE)).resolves.toEqual({ html: '<h1>Hi</h1>' });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url.href).toBe(PAGE);
    expect([call?.address, call?.family]).toEqual([PUBLIC_V4, 4]);
    expect(call?.headers).toEqual(WEB_FETCH_HEADERS);
    expect(call?.signal).toBeInstanceOf(AbortSignal);
    expect(cancels()).toBe(1);
  });

  it('the fixed headers carry no cookie or credential and ask for no compression', () => {
    expect(Object.keys(WEB_FETCH_HEADERS).sort()).toEqual([
      'accept',
      'accept-encoding',
      'user-agent',
    ]);
    expect(WEB_FETCH_HEADERS['accept-encoding']).toBe('identity');
    expect(WEB_FETCH_HEADERS['user-agent']).toBe('EdmateBot/0.1');
  });

  it('a DNS-rebinding resolver (public, then loopback) never yields loopback to the transport', async () => {
    const answers = [[PUBLIC_V4], ['127.0.0.1']];
    const resolveHost = vi.fn(() => Promise.resolve(answers.shift() ?? ['127.0.0.1']));
    const { f, calls } = fetcher([{}], { resolveHost });
    await expect(f.fetchPage(PAGE)).resolves.toEqual({ html: '<p>ok</p>' });
    expect(resolveHost).toHaveBeenCalledTimes(1);
    expect(calls.map((c) => c.address)).toEqual([PUBLIC_V4]);
  });

  it('pins the first of several public answers, and a v6 answer as family 6', async () => {
    const { f, calls } = fetcher([{}, {}], {
      resolveHost: vi
        .fn()
        .mockResolvedValueOnce([PUBLIC_V4, '1.1.1.1'])
        .mockResolvedValueOnce([PUBLIC_V6]),
    });
    await f.fetchPage(PAGE);
    await f.fetchPage(PAGE);
    expect(calls.map((c) => [c.address, c.family])).toEqual([
      [PUBLIC_V4, 4],
      [PUBLIC_V6, 6],
    ]);
  });

  it('resolves once per hop and pins each hop separately', async () => {
    const resolveHost = vi.fn((host: string) =>
      Promise.resolve(host === HOST ? [PUBLIC_V4] : [PUBLIC_V6]),
    );
    const { f, calls } = fetcher(
      [
        { status: 301, headers: { location: 'https://www.example.org/moved' } },
        { status: 302, headers: { location: '/final' } },
        { body: '<p>moved</p>' },
      ],
      { resolveHost },
    );
    await expect(f.fetchPage(PAGE)).resolves.toEqual({ html: '<p>moved</p>' });
    expect(calls.map((c) => [c.url.href, c.address])).toEqual([
      [PAGE, PUBLIC_V4],
      ['https://www.example.org/moved', PUBLIC_V6],
      ['https://www.example.org/final', PUBLIC_V6],
    ]);
    expect(resolveHost.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      HOST,
      'www.example.org',
      'www.example.org',
    ]);
  });

  it('connects to a public IP literal directly, without a lookup', async () => {
    const resolveHost = vi.fn(() => Promise.resolve([PUBLIC_V4]));
    const { f, calls } = fetcher([{}, {}], { allowedHosts: 'any-public', resolveHost });
    await f.fetchPage(`https://${PUBLIC_V4}/x`);
    await f.fetchPage(`https://[${PUBLIC_V6}]/x`);
    expect(resolveHost).not.toHaveBeenCalled();
    expect(calls.map((c) => [c.address, c.family])).toEqual([
      [PUBLIC_V4, 4],
      [PUBLIC_V6, 6],
    ]);
  });
});

describe('createWebFetcher: allow-list modes', () => {
  it("'any-public' passes any public https host", async () => {
    const { f } = fetcher([{}], { allowedHosts: 'any-public' });
    await expect(f.fetchPage('https://another.example.net/a')).resolves.toEqual({
      html: '<p>ok</p>',
    });
  });

  it('a host list matches exactly, ignoring case and a trailing dot', async () => {
    const { f, calls } = fetcher([{}, {}]);
    await f.fetchPage(`https://LESSONS.example.org/a`);
    await f.fetchPage(`https://${HOST}./a`);
    expect(calls).toHaveLength(2);
    for (const url of ['https://evil.example.net/a', `https://x.${HOST}/a`]) {
      expect((await failure(f.fetchPage(url))).code).toBe('forbidden');
    }
    expect(calls).toHaveLength(2);
  });

  it('an empty list refuses everything before any lookup', async () => {
    const resolveHost = vi.fn(() => Promise.resolve([PUBLIC_V4]));
    const { f, calls } = fetcher([], { allowedHosts: [], resolveHost });
    expect((await failure(f.fetchPage(PAGE))).code).toBe('forbidden');
    expect(calls).toHaveLength(0);
    expect(resolveHost).not.toHaveBeenCalled();
  });

  it('a list naming an internal host still refuses it', async () => {
    const { f, calls } = fetcher([], { allowedHosts: ['localhost', '127.0.0.1'] });
    expect((await failure(f.fetchPage('https://localhost/a'))).code).toBe('forbidden');
    expect((await failure(f.fetchPage('https://127.0.0.1/a'))).code).toBe('forbidden');
    expect(calls).toHaveLength(0);
  });
});

describe('createWebFetcher: SSRF refusals (the transport is never reached)', () => {
  it.each(REFUSED_URLS)('refuses %s in any-public mode', async (_label, url) => {
    const resolveHost = vi.fn(() => Promise.resolve([PUBLIC_V4]));
    const { f, calls } = fetcher([], { allowedHosts: 'any-public', resolveHost });
    expect((await failure(f.fetchPage(url))).code).toBe('forbidden');
    expect(calls).toHaveLength(0);
    expect(resolveHost).not.toHaveBeenCalled();
  });

  it.each(YOUTUBE_URLS)('refuses the YouTube link %s as unsupported', async (url) => {
    const { f, calls } = fetcher([], { allowedHosts: 'any-public' });
    expect((await failure(f.fetchPage(url))).code).toBe('unsupported');
    expect(calls).toHaveLength(0);
  });

  it('a URL over 2048 characters is refused', async () => {
    const { f, calls } = fetcher([], { allowedHosts: 'any-public' });
    const e = await failure(f.fetchPage(`https://${HOST}/${'a'.repeat(2100)}`));
    expect(e.code).toBe('forbidden');
    expect(calls).toHaveLength(0);
  });

  it('an unparseable URL is a validation error', async () => {
    const { f } = fetcher([]);
    expect((await failure(f.fetchPage('not a url'))).code).toBe('validation');
  });

  it.each([
    ['a private address', ['10.0.0.5']],
    ['one private among public ones', [PUBLIC_V4, '192.168.1.10']],
    ['a public v6 then loopback v6', [PUBLIC_V6, '::1']],
    ['v4-mapped loopback', ['::ffff:127.0.0.1']],
    ['link-local v6 with a zone', ['fe80::1%en0']],
    ['metadata', ['169.254.169.254']],
    ['not an address at all', ['lessons.example.org']],
  ])('refuses a name that resolves to %s', async (_label, addrs) => {
    const { f, calls } = fetcher([], { resolveHost: () => Promise.resolve(addrs) });
    expect((await failure(f.fetchPage(PAGE))).code).toBe('forbidden');
    expect(calls).toHaveLength(0);
  });

  it('a name that resolves to nothing, or fails to resolve, is not_found', async () => {
    const empty = fetcher([], { resolveHost: () => Promise.resolve([]) });
    expect((await failure(empty.f.fetchPage(PAGE))).code).toBe('not_found');
    const broken = fetcher([], {
      resolveHost: () => Promise.reject(new Error(`ENOTFOUND ${PAGE}`)),
    });
    expect((await failure(broken.f.fetchPage(PAGE))).code).toBe('not_found');
    expect(broken.calls).toHaveLength(0);
  });

  it('a slow DNS answer past the deadline is a retryable timeout, and nothing is fetched', async () => {
    const { f, calls } = fetcher([{}], {
      resolveHost: () => new Promise<readonly string[]>(() => undefined),
      timeoutMs: 30,
    });
    const e = await failure(f.fetchPage(PAGE));
    expect([e.code, e.retryable]).toEqual(['provider_error', true]);
    expect(e.message).toContain('timed out');
    expect(calls).toHaveLength(0);
  });

  it('a DNS answer that arrives just after the deadline is still not fetched', async () => {
    const { f, calls } = fetcher([{}], {
      resolveHost: () =>
        new Promise<readonly string[]>((resolve) => setTimeout(() => resolve([PUBLIC_V4]), 60)),
      timeoutMs: 20,
    });
    expect((await failure(f.fetchPage(PAGE))).message).toContain('timed out');
    await new Promise((r) => setTimeout(r, 80));
    expect(calls).toHaveLength(0);
  });
});

describe('createWebFetcher: redirects', () => {
  const redirectTargets: readonly (readonly [string, string])[] = [
    ...REFUSED_URLS.map(([label, url]): readonly [string, string] => [label, url]),
    ['off the allow-list', 'https://evil.example.net/x'],
  ];
  it.each(redirectTargets)('refuses a redirect to %s', async (_label, location) => {
    const { f, calls } = fetcher([{ status: 302, headers: { location } }]);
    expect((await failure(f.fetchPage(PAGE))).code).toBe('forbidden');
    expect(calls).toHaveLength(1);
  });

  it('refuses a redirect from https down to http even on the same host', async () => {
    const { f, calls } = fetcher([{ status: 301, headers: { location: `http://${HOST}/x` } }], {
      allowedHosts: 'any-public',
    });
    const e = await failure(f.fetchPage(PAGE));
    expect(e.code).toBe('forbidden');
    expect(e.message).toContain('https');
    expect(calls).toHaveLength(1);
  });

  it('refuses a redirect to a YouTube link as unsupported', async () => {
    const { f } = fetcher([{ status: 302, headers: { location: 'https://youtu.be/x' } }], {
      allowedHosts: 'any-public',
    });
    expect((await failure(f.fetchPage(PAGE))).code).toBe('unsupported');
  });

  it('refuses a redirect to a host whose DNS now points inside', async () => {
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

  it('a redirect with no location, a broken location and a fourth redirect are refused', async () => {
    const none = fetcher([{ status: 302 }]);
    expect((await failure(none.f.fetchPage(PAGE))).code).toBe('provider_error');
    const broken = fetcher([{ status: 302, headers: { location: 'https://[::1' } }]);
    const eb = await failure(broken.f.fetchPage(PAGE));
    expect([eb.code, eb.retryable]).toEqual(['provider_error', false]);
    const hop = { status: 302, headers: { location: '/again' } };
    const loop = fetcher([hop, hop, hop, hop, hop]);
    const e = await failure(loop.f.fetchPage(PAGE));
    expect(e.code).toBe('provider_error');
    expect(e.message).toContain('too many');
    expect(loop.calls).toHaveLength(4);
    expect(loop.cancels()).toBe(4);
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
    [101, 'provider_error', false],
  ] as const)('HTTP %i maps to %s (retryable %s)', async (status, code, retryable) => {
    const { f, cancels } = fetcher([{ status, body: 'nope' }]);
    const e = await failure(f.fetchPage(PAGE));
    expect([e.code, e.retryable]).toEqual([code, retryable]);
    expect(cancels()).toBe(1);
  });

  it.each([
    ['a PDF', 'application/pdf'],
    ['JSON', 'application/json'],
    ['no content type', ''],
  ])('refuses %s as unsupported (not a web page)', async (_label, type) => {
    const { f } = fetcher([{ headers: { 'content-type': type } }]);
    expect((await failure(f.fetchPage(PAGE))).code).toBe('unsupported');
  });

  it('accepts xhtml, and decodes a declared charset or falls back to UTF-8', async () => {
    const latin1 = new Uint8Array([0x63, 0x61, 0x66, 0xe9]); // "café" in windows-1252
    const { f } = fetcher([
      { headers: { 'content-type': 'application/xhtml+xml' } },
      { body: latin1, headers: { 'content-type': 'text/html; charset=windows-1252' } },
      { body: 'plain', headers: { 'content-type': 'text/html; charset=nonsense-9' } },
    ]);
    await expect(f.fetchPage(PAGE)).resolves.toEqual({ html: '<p>ok</p>' });
    await expect(f.fetchPage(PAGE)).resolves.toEqual({ html: 'café' });
    await expect(f.fetchPage(PAGE)).resolves.toEqual({ html: 'plain' });
  });

  it('the page cap defaults to 5 MB', () => {
    expect(WEB_PAGE_MAX_BYTES).toBe(5 * 1024 * 1024);
  });

  it('refuses a declared length over the cap before reading the body', async () => {
    const { f, cancels } = fetcher(
      [{ body: 'x'.repeat(20), headers: { 'content-length': '20' } }],
      { maxBytes: 10 },
    );
    expect((await failure(f.fetchPage(PAGE))).code).toBe('input_too_large');
    expect(cancels()).toBe(1);
  });

  it('stops reading a body with no declared length as soon as it passes the cap', async () => {
    let pulled = 0;
    async function* endless(): AsyncIterable<Uint8Array> {
      for (;;) {
        pulled += 1;
        await Promise.resolve();
        yield enc.encode('12345');
      }
    }
    const { f, cancels } = fetcher([{ body: endless() }], { maxBytes: 10 });
    expect((await failure(f.fetchPage(PAGE))).code).toBe('input_too_large');
    expect(pulled).toBe(3);
    expect(cancels()).toBe(1);
  });

  it('a gzip body the transport inflates is capped on the inflated bytes (a compression bomb)', async () => {
    const bomb = gzipSync(Buffer.alloc(6 * 1024 * 1024));
    expect(bomb.byteLength).toBeLessThan(64 * 1024);
    const inflated = Readable.from([bomb]).pipe(createGunzip());
    const { f } = fetcher([{ body: inflated }]);
    const e = await failure(f.fetchPage(PAGE));
    expect(e.code).toBe('input_too_large');
    expect(e.message).toContain(String(WEB_PAGE_MAX_BYTES));
    inflated.destroy();
  });

  it('a body still marked compressed (the transport did not decode it) is refused', async () => {
    const { f } = fetcher([
      { body: 'abc', headers: { 'content-encoding': 'zstd' } },
      { body: 'abc', headers: { 'content-encoding': 'gzip' } },
    ]);
    expect((await failure(f.fetchPage(PAGE))).code).toBe('unsupported');
    expect((await failure(f.fetchPage(PAGE))).code).toBe('unsupported');
  });

  it('identity encoding and a matching declared length are fine', async () => {
    const { f } = fetcher([
      { body: '<p>abc</p>', headers: { 'content-encoding': 'Identity', 'content-length': '10' } },
    ]);
    await expect(f.fetchPage(PAGE)).resolves.toEqual({ html: '<p>abc</p>' });
  });

  it('joins a chunked body that fits', async () => {
    const { f } = fetcher([{ body: chunksOf(['<p>', 'ok', '</p>']) }]);
    await expect(f.fetchPage(PAGE)).resolves.toEqual({ html: '<p>ok</p>' });
  });

  it('a body shorter than its declared length is a truncated download', async () => {
    const { f } = fetcher([{ body: chunksOf(['abc']), headers: { 'content-length': '10' } }]);
    const e = await failure(f.fetchPage(PAGE));
    expect([e.code, e.retryable]).toEqual(['provider_error', true]);
  });

  it('an unusable content-length is ignored', async () => {
    const { f } = fetcher([{ body: 'abc', headers: { 'content-length': 'lots' } }]);
    await expect(f.fetchPage(PAGE)).resolves.toEqual({ html: 'abc' });
  });

  it('an empty page is a validation error', async () => {
    const { f } = fetcher([{ body: '' }, { body: chunksOf([]) }]);
    expect((await failure(f.fetchPage(PAGE))).code).toBe('validation');
    expect((await failure(f.fetchPage(PAGE))).code).toBe('validation');
  });
});

describe('createWebFetcher: transport failures', () => {
  it('a timeout or abort from the transport is a retryable timeout, with the URL dropped', async () => {
    for (const name of ['TimeoutError', 'AbortError']) {
      const err = Object.assign(new Error(`timed out ${PAGE}`), { name });
      const { f } = fetcher([], { transport: () => Promise.reject(err) });
      const e = await failure(f.fetchPage(PAGE));
      expect([e.code, e.retryable]).toEqual(['provider_error', true]);
      expect(e.message).toContain('timed out');
    }
  });

  it('a response with no headers at all is not an HTML page', async () => {
    const { f } = fetcher([], {
      transport: () =>
        Promise.resolve({
          status: 200,
          header: () => undefined,
          body: chunksOf(['<p>x</p>']),
          cancel: () => undefined,
        }),
    });
    expect((await failure(f.fetchPage(PAGE))).code).toBe('unsupported');
  });

  it('a network failure or a non-Error rejection is a retryable provider error', async () => {
    const n = fetcher([], {
      transport: () => Promise.reject(new TypeError(`connect failed ${PAGE}`)),
    });
    const e = await failure(n.f.fetchPage(PAGE));
    expect([e.code, e.retryable]).toEqual(['provider_error', true]);
    expect(e.message).toContain('could not download');
    const s = fetcher([], {
      transport: () => Promise.reject(new Error('x', { cause: 'boom' }).cause),
    });
    expect((await failure(s.f.fetchPage(PAGE))).code).toBe('provider_error');
  });

  it('a body that fails mid-stream is a provider error and the response is cancelled', async () => {
    async function* failing(): AsyncIterable<Uint8Array> {
      await Promise.resolve();
      yield enc.encode('<p>');
      throw new Error(`socket hang up ${PAGE}`);
    }
    const { f, cancels } = fetcher([{ body: failing() }]);
    expect((await failure(f.fetchPage(PAGE))).code).toBe('provider_error');
    expect(cancels()).toBe(1);
  });

  it('the deadline covers every hop, the body included', async () => {
    const slowBody = (async function* (): AsyncIterable<Uint8Array> {
      await new Promise((r) => setTimeout(r, 200));
      yield enc.encode('late');
    })();
    let seen: AbortSignal | undefined;
    const ft = fakeTransport([{ body: slowBody }]);
    const f = createWebFetcher({
      allowedHosts: 'any-public',
      resolveHost: () => Promise.resolve([PUBLIC_V4]),
      timeoutMs: 20,
      transport: (req) => {
        seen = req.signal;
        return ft.transport(req);
      },
    });
    expect((await failure(f.fetchPage(PAGE))).message).toContain('timed out');
    expect(seen?.aborted).toBe(true);
  });
});

describe('helpers', () => {
  it('redactUrl keeps scheme, host and path only', () => {
    expect(redactUrl(`https://u:p@${HOST}/a/b?key=${LEAK_MARK}#frag`)).toBe(`https://${HOST}/a/b`);
    expect(redactUrl('::nope')).toBe('[unparseable url]');
  });

  it('normaliseAllowedHosts lower-cases bare host names and rejects anything else', () => {
    expect([
      ...normaliseAllowedHosts(['Lessons.Example.org', 'a.example.', '93.184.216.34', '[::1]']),
    ]).toEqual(['lessons.example.org', 'a.example', '93.184.216.34', '[::1]']);
    for (const bad of [
      'https://a.example',
      'a.example/path',
      '',
      'a b',
      'u@a.example',
      'a.example:8443',
      'a.example:443',
      '*.example.org',
      '*',
      '[::1]:443',
    ]) {
      expect(() => normaliseAllowedHosts([bad])).toThrow(/bare host/);
    }
  });
});
