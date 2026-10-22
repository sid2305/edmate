// Fetching a teacher's web link, SSRF-safe (tasks 5.1 and 8.2d; the policy is ADR-0014).
//
// - Every hop is checked by the pure shape rules in linkUrl.ts (https on port 443, no userinfo, no
//   internal name, a public IP literal, not YouTube) and, in list mode, an exact-host allow-list.
// - A name is resolved ONCE per hop; every address must be public, and the first is pinned. The
//   transport connects to exactly that address, with no second lookup, so a DNS-rebinding host
//   can't answer public to the check and private to the connection.
// - Redirects are followed by hand, at most MAX_REDIRECTS, each re-checked and re-pinned. Only HTML
//   is accepted, the body is capped (decompressed bytes) while it streams, and one deadline covers
//   every hop: DNS, connection and body.
// - The URL never appears in an error: it can carry a token in its query string or path.
import { IngestError } from '../errors.js';
import { errorCode, isIpLiteral, isPublicAddress, NO_SUCH_NAME } from './address.js';
import { bareHostName, webLinkRefusal, type WebLinkRefusal } from './linkUrl.js';

const MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 15_000;
const HTML_TYPES = new Set(['text/html', 'application/xhtml+xml']);

/** A page is capped at 5 MB, counted after any decompression (ADR-0014 Decision 5). */
export const WEB_PAGE_MAX_BYTES = 5 * 1024 * 1024;

/** The only request headers ever sent: no cookie, no authorization, no compression asked for. */
export const WEB_FETCH_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'user-agent': 'EdmateBot/0.1',
  accept: 'text/html,application/xhtml+xml',
  'accept-encoding': 'identity',
});

export interface FetchedPage {
  readonly html: string;
}

/** The port web-link ingestion reads through; tests use stubWebFetcher. */
export interface WebFetcher {
  fetchPage(url: string): Promise<FetchedPage>;
}

/** One request to one already-checked address. */
export interface TransportRequest {
  readonly url: URL;
  /** The checked public address to connect to; the transport must not look the host up again. */
  readonly address: string;
  readonly family: 4 | 6;
  readonly headers: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}

/**
 * A response as the fetcher reads it. A transport that decompresses the body must drop
 * `content-encoding` and `content-length`; one that can't decode an encoding leaves the header,
 * and the fetcher refuses the page.
 */
export interface TransportResponse {
  readonly status: number;
  /** A header value by lower-case name, or undefined. */
  header(name: string): string | undefined;
  readonly body: AsyncIterable<Uint8Array>;
  /** Stop reading and close the connection; safe to call more than once. */
  cancel(): Promise<void> | void;
}

/** Connects to `address` only (production: apps/worker/src/webLink/pinnedTransport.ts). */
export type PinnedTransport = (req: TransportRequest) => Promise<TransportResponse>;

export interface WebFetcherOptions {
  /** Bare host names matched exactly, or 'any-public' for any host that passes every check. */
  readonly allowedHosts: readonly string[] | 'any-public';
  readonly transport: PinnedTransport;
  /**
   * Every address a host name resolves to; production passes systemResolveHost. The signal aborts
   * at the deadline so a slow lookup can be cancelled. A rejection whose `code` is ENOTFOUND,
   * ENODATA or ENONAME means "no such name"; any other rejection is a retryable DNS failure.
   */
  readonly resolveHost: (host: string, signal: AbortSignal) => Promise<readonly string[]>;
  readonly maxBytes?: number;
  /** One deadline for the whole fetch, every hop and DNS lookup included. */
  readonly timeoutMs?: number;
}

/** Letters, digits and hyphens in dot-separated labels: no `*` wildcard, no empty label. */
const HOST_NAME = /^(?:[a-z0-9-]+\.)*[a-z0-9-]+$/;

/** The allow-list as bare lower-case host names; a mistyped entry fails at startup, not later. */
export function normaliseAllowedHosts(hosts: readonly string[]): ReadonlySet<string> {
  const out = new Set<string>();
  for (const raw of hosts) {
    let host: string | undefined;
    try {
      const u = new URL(`https://${raw}`);
      host = u.port === '' ? bareHostName(u.hostname) : undefined;
    } catch {
      host = undefined;
    }
    const plain = host !== undefined && (HOST_NAME.test(host) || isIpLiteral(host));
    if (host === undefined || !plain || host !== bareHostName(raw)) {
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

const REFUSAL_WORDS: Readonly<Record<Exclude<WebLinkRefusal, 'youtube_unsupported'>, string>> = {
  invalid_url: 'is not a valid URL',
  not_https: 'is not https',
  has_credentials: 'carries a user name or password',
  too_long: 'is too long',
  bad_port: 'names a port other than 443',
  internal_name: 'names an internal host',
  private_address: 'points at a non-public address',
};

function refusalError(code: WebLinkRefusal): IngestError {
  return code === 'youtube_unsupported'
    ? new IngestError('unsupported', false, "YouTube links aren't fetched")
    : forbidden(REFUSAL_WORDS[code]);
}

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

/** The declared length, when it is a usable number. */
function declaredLength(res: TransportResponse): number | undefined {
  const raw = res.header('content-length');
  const n = raw === undefined ? Number.NaN : Number(raw);
  return Number.isSafeInteger(n) && n >= 0 ? n : undefined;
}

async function readCapped(
  res: TransportResponse,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const encoding = (res.header('content-encoding') ?? '').trim().toLowerCase();
  if (encoding !== 'identity' && encoding !== '') {
    throw new IngestError('unsupported', false, 'the web page uses an unsupported encoding');
  }
  const declared = declaredLength(res);
  if (declared !== undefined && declared > maxBytes) throw tooLarge(maxBytes);
  const parts: Uint8Array[] = [];
  let size = 0;
  const chunks = res.body[Symbol.asyncIterator]();
  for (;;) {
    // Each read races the deadline, so a body that trickles can't outlive it.
    const step = await untilAborted(chunks.next(), signal);
    if (step.done === true) break;
    const chunk = step.value;
    size += chunk.byteLength;
    if (size > maxBytes) throw tooLarge(maxBytes);
    parts.push(chunk);
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

/**
 * Settles with `p`, or rejects as soon as the signal aborts (a slow DNS answer can't stall). `p` is
 * always handled first, so a rejection that arrives after the abort is never left unhandled.
 */
function untilAborted<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(new Error('aborted'));
    };
    p.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * One refusal for "no such name" and "a non-public address", so a teacher can't use the answer to
 * learn which internal names exist.
 */
const unreachableHost = (): IngestError => forbidden("names a host that isn't a public site");

/** Closing a response never replaces the real outcome; the port says cancel() is safe to call. */
async function quietCancel(res: TransportResponse): Promise<void> {
  try {
    await res.cancel();
  } catch {
    // Nothing to report: the response is being dropped either way.
  }
}

interface Target {
  readonly address: string;
  readonly family: 4 | 6;
}

const unbracket = (host: string): string => host.replace(/^\[(.*)\]$/, '$1');
const familyOf = (address: string): 4 | 6 => (address.includes(':') ? 6 : 4);

export function createWebFetcher(opts: WebFetcherOptions): WebFetcher {
  const allowed =
    opts.allowedHosts === 'any-public' ? undefined : normaliseAllowedHosts(opts.allowedHosts);
  const maxBytes = opts.maxBytes ?? WEB_PAGE_MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  /** Shape rules, the allow-list, then one lookup whose every answer must be public. */
  async function checkTarget(u: URL, signal: AbortSignal): Promise<Target> {
    const refusal = webLinkRefusal(u);
    if (refusal !== undefined) throw refusalError(refusal);
    const host = bareHostName(u.hostname);
    if (allowed !== undefined && !allowed.has(host)) throw forbidden('is not on an allowed host');
    if (isIpLiteral(host)) {
      const address = unbracket(host);
      return { address, family: familyOf(address) };
    }
    let addresses: readonly string[];
    try {
      addresses = await untilAborted(opts.resolveHost(host, signal), signal);
    } catch (err) {
      signal.throwIfAborted();
      if (NO_SUCH_NAME.has(errorCode(err))) throw unreachableHost();
      throw new IngestError('provider_error', true, "the web link's host could not be looked up");
    }
    const [first] = addresses;
    if (first === undefined || !addresses.every(isPublicAddress)) throw unreachableHost();
    return { address: first, family: familyOf(first) };
  }

  /** One hop's response: the redirect target to follow next, or the page. */
  async function readResponse(
    res: TransportResponse,
    current: URL,
    hop: number,
    signal: AbortSignal,
  ): Promise<URL | FetchedPage> {
    if (res.status >= 300 && res.status < 400) {
      const location = res.header('location');
      if (location === undefined) {
        throw new IngestError('provider_error', false, 'the site sent a redirect with no location');
      }
      if (hop >= MAX_REDIRECTS) {
        throw new IngestError('provider_error', false, 'the site redirected too many times');
      }
      try {
        return new URL(location, current);
      } catch {
        throw new IngestError('provider_error', false, 'the site sent an unusable redirect');
      }
    }
    if (res.status < 200 || res.status >= 300) throw statusError(res.status);
    const contentType = res.header('content-type') ?? '';
    const mime = contentType.replace(/;.*$/s, '').trim().toLowerCase();
    if (!HTML_TYPES.has(mime)) {
      throw new IngestError('unsupported', false, 'the web link is not an HTML page');
    }
    const bytes = await readCapped(res, maxBytes, signal);
    if (bytes.byteLength === 0) throw new IngestError('validation', false, 'the web page is empty');
    return { html: decode(bytes, contentType) };
  }

  async function fetchPage(url: string): Promise<FetchedPage> {
    let current: URL;
    try {
      current = new URL(url);
    } catch {
      throw new IngestError('validation', false, 'the web link is not a valid URL');
    }
    // A plain timer (not AbortSignal.timeout), cleared when the fetch ends.
    const deadline = new AbortController();
    const timer = setTimeout(() => {
      deadline.abort(new DOMException('the web page download timed out', 'TimeoutError'));
    }, timeoutMs);
    const { signal } = deadline;
    try {
      for (let hop = 0; ; hop += 1) {
        const target = await checkTarget(current, signal);
        const res = await untilAborted(
          opts.transport({
            url: current,
            address: target.address,
            family: target.family,
            headers: WEB_FETCH_HEADERS,
            signal,
          }),
          signal,
        );
        let next: URL | FetchedPage;
        try {
          next = await readResponse(res, current, hop, signal);
        } finally {
          await quietCancel(res);
        }
        if (!(next instanceof URL)) return next;
        current = next;
      }
    } catch (err) {
      if (err instanceof IngestError) throw err;
      // The original error is dropped, not kept as `cause`: transport errors can quote the URL.
      const timeout =
        signal.aborted ||
        (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError'));
      if (timeout) throw new IngestError('provider_error', true, 'the web page download timed out');
      throw new IngestError('provider_error', true, 'could not download the web page');
    } finally {
      clearTimeout(timer);
    }
  }

  return { fetchPage };
}
