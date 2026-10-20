// Fetching a teacher's web link, SSRF-safe. Modelled on the gateway's recording download
// (packages/gateway/src/transcriber/source.ts):
//
// - https only, no userinfo, and the URL's host (with port) must match the allowlist exactly; an
//   empty list refuses everything.
// - The host must reach public addresses only: an IP literal is checked as it stands, a name is
//   resolved and every address it resolves to must be public (no loopback, private, link-local or
//   cloud metadata address). This runs again on every redirect hop.
// - Redirects are followed by hand, at most MAX_REDIRECTS, and only to targets passing the same
//   checks; only HTML is accepted, and the body is capped while it streams.
// - The URL never appears in an error: it can carry a token in its query string.
import { IngestError } from '../errors.js';
import { MAX_DOCUMENT_BYTES } from '../types.js';
import { isIpLiteral, isPublicAddress } from './address.js';

type Fetch = typeof globalThis.fetch;

const MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 15_000;
const HTML_TYPES = new Set(['text/html', 'application/xhtml+xml']);

export interface FetchedPage {
  readonly html: string;
}

/** The port web-link ingestion reads through; tests use stubWebFetcher. */
export interface WebFetcher {
  fetchPage(url: string): Promise<FetchedPage>;
}

export interface WebFetcherOptions {
  /** Bare hosts (optionally `:port`) from the composition root, matched exactly. */
  readonly allowedHosts: readonly string[];
  readonly fetch: Fetch;
  /** Every address a host name resolves to; production passes systemResolveHost. */
  readonly resolveHost: (host: string) => Promise<readonly string[]>;
  readonly maxBytes?: number;
  readonly timeoutMs?: number;
}

/** `scheme://host/path`, without userinfo, query string or fragment. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return '[unparseable url]';
  }
}

/** The allowlist as lower-case hosts; a mistyped entry fails at startup, not silently later. */
export function normaliseAllowedHosts(hosts: readonly string[]): ReadonlySet<string> {
  const out = new Set<string>();
  for (const raw of hosts) {
    let host: string | undefined;
    try {
      host = new URL(`https://${raw}`).host;
    } catch {
      host = undefined;
    }
    if (host === undefined || host === '' || host !== raw.toLowerCase()) {
      throw new Error(
        'ingest: every allowedHosts entry must be a bare host such as docs.example.org',
      );
    }
    out.add(host);
  }
  return out;
}

const forbidden = (why: string): IngestError =>
  new IngestError('forbidden', false, `the web link ${why}; refused`);

function statusError(status: number): IngestError {
  const http = `(HTTP ${String(status)})`;
  if (status === 401 || status === 403)
    return new IngestError('forbidden', false, `the site refused access ${http}`);
  if (status === 404 || status === 410)
    return new IngestError('not_found', false, `the web page was not found ${http}`);
  if (status === 429)
    return new IngestError('rate_limited', true, `the site rate limited the download ${http}`);
  if (status >= 500) return new IngestError('provider_error', true, `the site failed ${http}`);
  return new IngestError('provider_error', false, `the site refused the download ${http}`);
}

const tooLarge = (maxBytes: number): IngestError =>
  new IngestError(
    'input_too_large',
    false,
    `the web page is larger than the ${String(maxBytes)}-byte limit`,
  );

/** The declared length, when it is the length of the bytes we will read (not compressed). */
function declaredLength(res: Response): number | undefined {
  const encoding = res.headers.get('content-encoding');
  if (encoding !== null && encoding.trim().toLowerCase() !== 'identity') return undefined;
  const raw = res.headers.get('content-length');
  const n = raw === null ? Number.NaN : Number(raw);
  return Number.isSafeInteger(n) && n >= 0 ? n : undefined;
}

async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = declaredLength(res);
  if (declared !== undefined && declared > maxBytes) {
    await res.body?.cancel();
    throw tooLarge(maxBytes);
  }
  if (res.body === null) return new Uint8Array(0);
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw tooLarge(maxBytes);
    }
    parts.push(value);
  }
  if (declared !== undefined && size !== declared) {
    throw new IngestError('provider_error', true, 'the web page download ended early');
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

function decode(bytes: Uint8Array, contentType: string): string {
  const label = /charset\s*=\s*"?([^;"\s]+)/i.exec(contentType)?.[1];
  try {
    return new TextDecoder(label ?? 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

export function createWebFetcher(opts: WebFetcherOptions): WebFetcher {
  const allowed = normaliseAllowedHosts(opts.allowedHosts);
  const maxBytes = opts.maxBytes ?? MAX_DOCUMENT_BYTES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  /** Scheme, userinfo, allowlist, then the addresses the host reaches. */
  async function checkTarget(u: URL): Promise<void> {
    if (u.protocol !== 'https:') throw forbidden('is not https');
    if (u.username !== '' || u.password !== '') throw forbidden('carries a user name or password');
    if (!allowed.has(u.host)) throw forbidden('is not on an allowed host');
    if (isIpLiteral(u.hostname)) {
      if (!isPublicAddress(u.hostname)) throw forbidden('points at a non-public address');
      return;
    }
    let addresses: readonly string[];
    try {
      addresses = await opts.resolveHost(u.hostname);
    } catch {
      addresses = [];
    }
    if (addresses.length === 0) {
      throw new IngestError('not_found', false, "the web link's host could not be resolved");
    }
    if (!addresses.every(isPublicAddress)) throw forbidden('resolves to a non-public address');
  }

  async function fetchPage(url: string): Promise<FetchedPage> {
    let current: URL;
    try {
      current = new URL(url);
    } catch {
      throw new IngestError('validation', false, 'the web link is not a valid URL');
    }
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      for (let hop = 0; ; hop += 1) {
        await checkTarget(current);
        const res = await opts.fetch(current.href, { redirect: 'manual', signal });
        if (res.status >= 300 && res.status < 400) {
          await res.body?.cancel();
          const location = res.headers.get('location');
          if (location === null) {
            throw new IngestError(
              'provider_error',
              false,
              'the site sent a redirect with no location',
            );
          }
          if (hop >= MAX_REDIRECTS) {
            throw new IngestError('provider_error', false, 'the site redirected too many times');
          }
          current = new URL(location, current);
          continue;
        }
        if (res.status < 200 || res.status >= 300) {
          await res.body?.cancel();
          throw statusError(res.status);
        }
        const contentType = res.headers.get('content-type') ?? '';
        const mime = contentType.replace(/;.*$/s, '').trim().toLowerCase();
        if (!HTML_TYPES.has(mime)) {
          await res.body?.cancel();
          throw new IngestError('unsupported', false, 'the web link is not an HTML page');
        }
        const bytes = await readCapped(res, maxBytes);
        if (bytes.byteLength === 0)
          throw new IngestError('validation', false, 'the web page is empty');
        return { html: decode(bytes, contentType) };
      }
    } catch (err) {
      if (err instanceof IngestError) throw err;
      // The original error is dropped, not kept as `cause`: fetch errors can quote the URL.
      if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
        throw new IngestError('provider_error', true, 'the web page download timed out');
      }
      throw new IngestError('provider_error', true, 'could not download the web page');
    }
  }

  return { fetchPage };
}
