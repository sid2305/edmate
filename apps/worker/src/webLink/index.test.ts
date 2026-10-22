// The worker's web-link composition (task 8.2d, ADR-0014 Decision 10): env parsing, and the real
// composition refusing internal targets before any connection is opened.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IngestError } from '@edmate/ingest';
import { startServer, toLocalServer, type TestServer } from '../../test/webLinkServer.js';
import {
  createWorkerWebFetcher,
  parseWebLinkHosts,
  WEB_LINK_HOSTS_ENV,
  WebLinkConfigError,
} from './index.js';

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function code(p: Promise<unknown>): Promise<string> {
  const e = await p.then(
    () => undefined,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(IngestError);
  return (e as IngestError).code;
}

describe('parseWebLinkHosts', () => {
  it('unset, empty or blank refuses everything', () => {
    expect(parseWebLinkHosts(undefined)).toEqual([]);
    expect(parseWebLinkHosts('')).toEqual([]);
    expect(parseWebLinkHosts('  ')).toEqual([]);
  });

  it('exactly * is any public host', () => {
    expect(parseWebLinkHosts('*')).toBe('any-public');
    expect(parseWebLinkHosts(' * ')).toBe('any-public');
  });

  it('a comma list is normalised to bare lower-case host names', () => {
    expect(parseWebLinkHosts('Docs.Example.org, lessons.example.org')).toEqual([
      'docs.example.org',
      'lessons.example.org',
    ]);
  });

  it.each([
    'https://docs.example.org',
    'docs.example.org:8443',
    'docs.example.org,,lessons.example.org',
    '*,docs.example.org',
    '*.example.org',
    'docs.example.org/path',
  ])('a malformed value (%s) fails with a code, never the value', (raw) => {
    let caught: unknown;
    try {
      parseWebLinkHosts(raw);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(WebLinkConfigError);
    const e = caught as WebLinkConfigError;
    expect(e.code).toBe('web_link_hosts_invalid');
    expect(e.message).toContain(WEB_LINK_HOSTS_ENV);
    expect(e.message).not.toContain('example.org');
  });
});

describe('createWorkerWebFetcher: the real composition', () => {
  it('a malformed env value fails at construction', () => {
    expect(() => createWorkerWebFetcher({ [WEB_LINK_HOSTS_ENV]: 'a b' })).toThrow(
      WebLinkConfigError,
    );
  });

  it('refuses loopback and internal names with zero connections, in every mode', async () => {
    server = await startServer((_q, res) => res.end('<p>should never be served</p>'));
    const local = toLocalServer(server.port);
    const resolveHost = vi.fn(() => Promise.resolve(['127.0.0.1']));
    for (const mode of [undefined, '*', 'localhost,127.0.0.1,teacher-site.test']) {
      const f = createWorkerWebFetcher(
        { [WEB_LINK_HOSTS_ENV]: mode },
        { request: local.request, resolveHost },
      );
      expect(await code(f.fetchPage('https://127.0.0.1/'))).toBe('forbidden');
      expect(await code(f.fetchPage('https://localhost/'))).toBe('forbidden');
      expect(await code(f.fetchPage('https://localhost./'))).toBe('forbidden');
      expect(await code(f.fetchPage('https://[::1]/'))).toBe('forbidden');
      expect(await code(f.fetchPage('https://teacher-site.test/'))).toBe('forbidden');
    }
    expect(server.connections()).toBe(0);
    expect(local.pinned).toEqual([]);
  });

  it('unset refuses even a public host, with zero connections and no lookup', async () => {
    server = await startServer((_q, res) => res.end('<p>x</p>'));
    const local = toLocalServer(server.port);
    const resolveHost = vi.fn(() => Promise.resolve(['93.184.216.34']));
    const f = createWorkerWebFetcher({}, { request: local.request, resolveHost });
    expect(await code(f.fetchPage('https://teacher-site.test/'))).toBe('forbidden');
    expect(resolveHost).not.toHaveBeenCalled();
    expect(server.connections()).toBe(0);
  });

  it('a listed public host is fetched through the pinned transport', async () => {
    server = await startServer((_q, res) => {
      res.setHeader('content-type', 'text/html');
      res.end('<p>listed</p>');
    });
    const local = toLocalServer(server.port);
    const f = createWorkerWebFetcher(
      { [WEB_LINK_HOSTS_ENV]: 'teacher-site.test' },
      {
        request: local.request,
        resolveHost: () => Promise.resolve(['93.184.216.34']),
        timeoutMs: 5_000,
      },
    );
    await expect(f.fetchPage('https://teacher-site.test/a')).resolves.toEqual({
      html: '<p>listed</p>',
    });
    expect(local.pinned).toEqual(['93.184.216.34']);
    expect(server.connections()).toBe(1);
  });
});
