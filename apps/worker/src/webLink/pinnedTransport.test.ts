// The pinned transport against a local node:http server on 127.0.0.1 (task 8.2d, ADR-0014). The
// URL host `teacher-site.test` is not in DNS, so a request that lands proves the connection went
// to the pinned address only.
import http from 'node:http';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createWebFetcher,
  IngestError,
  WEB_FETCH_HEADERS,
  WEB_PAGE_MAX_BYTES,
  type TransportRequest,
  type TransportResponse,
} from '@edmate/ingest';
import { startServer, toLocalServer, type TestServer } from '../../test/webLinkServer.js';
import {
  CONNECT_TIMEOUT_MS,
  createPinnedTransport,
  pinnedLookup,
  pinnedRequestOptions,
  type RequestFn,
} from './pinnedTransport.js';

const LEAK_MARK = 'leak-marker-qz';
const PUBLIC_V4 = '93.184.216.34';
let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
  vi.restoreAllMocks();
});

function req(port: number, over: Partial<TransportRequest> = {}): TransportRequest {
  return {
    url: new URL(`http://teacher-site.test:${String(port)}/page?key=${LEAK_MARK}`),
    address: '127.0.0.1',
    family: 4,
    headers: WEB_FETCH_HEADERS,
    signal: AbortSignal.timeout(10_000),
    ...over,
  };
}

const httpRequest: RequestFn = (u, o, cb) => http.request(u, o, cb);

async function text(res: TransportResponse): Promise<string> {
  const parts: Buffer[] = [];
  for await (const c of res.body) parts.push(Buffer.from(c));
  return Buffer.concat(parts).toString('utf8');
}

async function rejection(p: Promise<unknown>): Promise<Error> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(Error);
    const e = err as Error;
    expect(e.message).not.toContain(LEAK_MARK);
    expect(e.message).not.toContain('teacher-site');
    return e;
  }
  throw new Error('expected a rejection');
}

describe('createPinnedTransport: the pin', () => {
  it('lands on the pinned address for a host that is not in DNS, with only the fixed headers', async () => {
    server = await startServer((_q, res) => {
      res.setHeader('set-cookie', ['sid=abc; Path=/', 'other=1']);
      res.setHeader('content-type', 'text/html');
      res.end('<p>hello</p>');
    });
    const transport = createPinnedTransport({ request: httpRequest });
    for (let i = 0; i < 2; i += 1) {
      const res = await transport(req(server.port));
      expect(res.status).toBe(200);
      expect(res.header('content-type')).toBe('text/html');
      expect(res.header('set-cookie')).toBe('sid=abc; Path=/, other=1');
      expect(await text(res)).toBe('<p>hello</p>');
      await res.cancel();
    }
    expect(server.seen).toHaveLength(2);
    for (const seen of server.seen) {
      expect(seen.headers.host).toBe(`teacher-site.test:${String(server.port)}`);
      expect(seen.headers['user-agent']).toBe('EdmateBot/0.1');
      expect(seen.headers['accept-encoding']).toBe('identity');
      expect(seen.headers.cookie).toBeUndefined();
      expect(seen.headers.authorization).toBeUndefined();
      expect(seen.headers.connection).toBe('close');
    }
    // No keep-alive agent: each request is its own connection.
    expect(server.connections()).toBe(2);
  });

  it('pinnedLookup answers both the single-address and the all-addresses forms', () => {
    const lookup = pinnedLookup('203.0.113.7', 4);
    const single = vi.fn();
    lookup('anything.example', {}, single);
    expect(single).toHaveBeenCalledWith(null, '203.0.113.7', 4);
    const all = vi.fn();
    lookup('anything.example', { all: true }, all);
    expect(all).toHaveBeenCalledWith(null, [{ address: '203.0.113.7', family: 4 }]);
  });

  it('the default request is https.request with SNI, no agent and certificate checks on', async () => {
    const calls: { url: URL; options: https.RequestOptions }[] = [];
    vi.spyOn(https, 'request').mockImplementation(((
      url: URL,
      options: https.RequestOptions,
    ): http.ClientRequest => {
      calls.push({ url, options });
      const fake = new EventEmitter() as http.ClientRequest;
      fake.end = (() => {
        setImmediate(() => fake.emit('error', new Error(`ECONNREFUSED ${url.href}`)));
        return fake;
      }) as http.ClientRequest['end'];
      fake.destroy = (() => fake) as http.ClientRequest['destroy'];
      return fake;
    }) as unknown as typeof https.request);
    const transport = createPinnedTransport();
    const url = new URL(`https://Teacher-Site.test./page?key=${LEAK_MARK}`);
    const e = await rejection(transport(req(443, { url, address: PUBLIC_V4 })));
    expect(e.message).toBe('web link transport: the connection failed');
    expect(calls).toHaveLength(1);
    const options = calls[0]?.options;
    expect(options).toMatchObject({
      method: 'GET',
      agent: false,
      autoSelectFamily: false,
      family: 4,
      servername: 'teacher-site.test',
      headers: { ...WEB_FETCH_HEADERS },
    });
    expect(options).not.toHaveProperty('rejectUnauthorized');
    const answered = vi.fn();
    options?.lookup?.('elsewhere.example', {}, answered);
    expect(answered).toHaveBeenCalledWith(null, PUBLIC_V4, 4);
  });

  it('an IP-literal host gets no SNI servername', () => {
    for (const [host, address, family] of [
      [PUBLIC_V4, PUBLIC_V4, 4],
      ['[2606:4700:4700::1111]', '2606:4700:4700::1111', 6],
    ] as const) {
      const options = pinnedRequestOptions(
        req(443, { url: new URL(`https://${host}/x`), address, family }),
      );
      expect(options).not.toHaveProperty('servername');
      expect(options.family).toBe(family);
    }
  });
});

describe('createPinnedTransport: decompression', () => {
  it.each([
    ['gzip', gzipSync],
    ['x-gzip', gzipSync],
    ['deflate', deflateSync],
    ['br', brotliCompressSync],
  ] as const)('decodes %s and drops content-encoding and content-length', async (enc, pack) => {
    const packed = pack(Buffer.from('<p>squeezed</p>'));
    server = await startServer((_q, res) => {
      res.writeHead(200, {
        'content-type': 'text/html',
        'content-encoding': enc,
        'content-length': String(packed.byteLength),
      });
      res.end(packed);
    });
    const res = await createPinnedTransport({ request: httpRequest })(req(server.port));
    expect(res.header('content-encoding')).toBeUndefined();
    expect(res.header('Content-Length')).toBeUndefined();
    expect(await text(res)).toBe('<p>squeezed</p>');
  });

  it('leaves an encoding it does not know for the fetcher to refuse', async () => {
    server = await startServer((_q, res) => {
      res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'zstd' });
      res.end('raw');
    });
    const res = await createPinnedTransport({ request: httpRequest })(req(server.port));
    expect(res.header('content-encoding')).toBe('zstd');
    expect(await text(res)).toBe('raw');
  });

  it('a broken compressed body fails the read', async () => {
    server = await startServer((_q, res) => {
      res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
      res.end('not gzip at all');
    });
    const res = await createPinnedTransport({ request: httpRequest })(req(server.port));
    await expect(text(res)).rejects.toThrow();
    await res.cancel();
  });
});

describe('createPinnedTransport with the fetcher: caps and limits', () => {
  function fetcherFor(port: number, maxBytes?: number) {
    const local = toLocalServer(port);
    const f = createWebFetcher({
      allowedHosts: 'any-public',
      resolveHost: () => Promise.resolve([PUBLIC_V4]),
      transport: createPinnedTransport({ request: local.request }),
      ...(maxBytes === undefined ? {} : { maxBytes }),
    });
    return { f, pinned: local.pinned };
  }

  it('fetches a page end to end, pinned to the checked address', async () => {
    server = await startServer((_q, res) => {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end('<h1>Fractions</h1>');
    });
    const { f, pinned } = fetcherFor(server.port);
    await expect(f.fetchPage(`https://teacher-site.test/a?key=${LEAK_MARK}`)).resolves.toEqual({
      html: '<h1>Fractions</h1>',
    });
    expect(pinned).toEqual([PUBLIC_V4]);
    // The local-server redirect adds its port to the Host header; the name is the URL's.
    expect(server.seen[0]?.headers.host).toBe(`teacher-site.test:${String(server.port)}`);
  });

  it('a body over the cap stops, with and without a content-length', async () => {
    const big = Buffer.alloc(64 * 1024, 0x61);
    server = await startServer((q, res) => {
      res.setHeader('content-type', 'text/html');
      if (q.url?.startsWith('/declared') === true) res.setHeader('content-length', big.byteLength);
      res.end(big);
    });
    const { f } = fetcherFor(server.port, 1024);
    for (const path of ['/declared', '/streamed']) {
      const e = await f.fetchPage(`https://teacher-site.test${path}`).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(IngestError);
      expect((e as IngestError).code).toBe('input_too_large');
    }
  });

  it('a gzip bomb stops at the 5 MB cap on decompressed bytes', async () => {
    const bomb = gzipSync(Buffer.alloc(WEB_PAGE_MAX_BYTES + 1024 * 1024));
    expect(bomb.byteLength).toBeLessThan(64 * 1024);
    server = await startServer((_q, res) => {
      res.writeHead(200, {
        'content-type': 'text/html',
        'content-encoding': 'gzip',
        'content-length': String(bomb.byteLength),
      });
      res.end(bomb);
    });
    const { f } = fetcherFor(server.port);
    const e = await f.fetchPage('https://teacher-site.test/bomb').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(IngestError);
    expect((e as IngestError).code).toBe('input_too_large');
  });
});

describe('createPinnedTransport: failures', () => {
  it('a server that never answers hits the connect-and-headers timeout', async () => {
    expect(CONNECT_TIMEOUT_MS).toBe(5_000);
    server = await startServer(() => undefined);
    const transport = createPinnedTransport({ request: httpRequest, timeoutMs: 100 });
    const e = await rejection(transport(req(server.port)));
    expect(e.name).toBe('TimeoutError');
  });

  it('a refused connection is a fixed error without the URL or address', async () => {
    server = await startServer(() => undefined);
    const { port } = server;
    await server.close();
    server = undefined;
    const e = await rejection(createPinnedTransport({ request: httpRequest })(req(port)));
    expect(e.message).toBe('web link transport: the connection failed');
    expect(e.message).not.toContain('127.0.0.1');
  });

  it('an aborted signal rejects as an abort', async () => {
    server = await startServer(() => undefined);
    const controller = new AbortController();
    const p = createPinnedTransport({ request: httpRequest })(
      req(server.port, { signal: controller.signal }),
    );
    setTimeout(() => controller.abort(), 20);
    const e = await rejection(p);
    expect(e.name).toBe('AbortError');
  });

  it('a response that arrives after a failure is closed, not returned', async () => {
    let respond: ((res: http.IncomingMessage) => void) | undefined;
    const destroyed = vi.fn();
    const fake = new EventEmitter() as http.ClientRequest;
    fake.end = (() => fake) as http.ClientRequest['end'];
    fake.destroy = (() => fake) as http.ClientRequest['destroy'];
    const request: RequestFn = (_u, _o, cb) => {
      respond = cb;
      return fake;
    };
    const p = createPinnedTransport({ request })(req(1));
    fake.emit('error', new Error('boom'));
    await rejection(p);
    respond?.({ destroy: destroyed } as unknown as http.IncomingMessage);
    expect(destroyed).toHaveBeenCalledTimes(1);
  });
});
