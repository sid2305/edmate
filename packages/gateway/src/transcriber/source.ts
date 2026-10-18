// Fetching a recording from Edmate's own storage through its signed URL (ADR-0005, Decision 5).
//
// - Only hosts on the allowlist, matched exactly against the parsed URL's host (no suffix or
//   wildcard match); an empty list refuses everything.
// - Redirects are followed by hand, only to the same host over https, at most MAX_REDIRECTS.
// - The signed URL is a bearer credential: it never appears in an error, a log line or a trace.
//   Where one has to be named it is redacted to scheme://host/path.
import { TranscriberError } from './errors.js';

type Fetch = typeof globalThis.fetch;

const MAX_REDIRECTS = 3;

/** `scheme://host/path`, without userinfo, query string or fragment. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return '[unparseable url]';
  }
}

/**
 * The allowlist as lower-case hosts. Each entry must be a bare host (optionally `:port`), so a
 * mistyped entry fails at startup instead of silently allowing nothing or too much.
 */
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
      // The entry is config, not a credential, but it is still not echoed.
      throw new Error(
        'transcriber: every allowedHosts entry must be a bare host such as storage.example.com',
      );
    }
    out.add(host);
  }
  return out;
}

export interface DownloadOptions {
  readonly allowedHosts: ReadonlySet<string>;
  readonly fetch: Fetch;
  readonly maxBytes: number;
  readonly timeoutMs: number;
}

function refuseHost(): TranscriberError {
  return new TranscriberError(
    'forbidden',
    false,
    'the recording URL is not on an allowed storage host',
  );
}

/** Parses the URL and checks its host against the allowlist. */
export function allowedUrl(url: string, allowedHosts: ReadonlySet<string>): URL {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !allowedHosts.has(u.host)) throw refuseHost();
  return u;
}

function statusError(status: number): TranscriberError {
  const http = `(HTTP ${String(status)})`;
  if (status === 401 || status === 403) {
    return new TranscriberError(
      'forbidden',
      false,
      `storage refused the signed URL ${http}; it may have expired`,
    );
  }
  if (status === 404 || status === 410) {
    return new TranscriberError(
      'not_found',
      false,
      `the recording was not found in storage ${http}`,
    );
  }
  if (status === 429)
    return new TranscriberError('rate_limited', true, `storage rate limited the download ${http}`);
  if (status >= 500) return new TranscriberError('provider_error', true, `storage failed ${http}`);
  return new TranscriberError('provider_error', false, `storage refused the download ${http}`);
}

function tooLarge(maxBytes: number): TranscriberError {
  return new TranscriberError(
    'input_too_large',
    false,
    `the recording is larger than the ${String(maxBytes)}-byte download limit`,
  );
}

/** The declared length, when it is the length of the bytes we will read (not compressed). */
function declaredLength(res: Response): number | undefined {
  const encoding = res.headers.get('content-encoding');
  if (encoding !== null && encoding.trim().toLowerCase() !== 'identity') return undefined;
  const raw = res.headers.get('content-length');
  const n = raw === null ? Number.NaN : Number(raw);
  return Number.isSafeInteger(n) && n >= 0 ? n : undefined;
}

function sizeMismatch(): TranscriberError {
  return new TranscriberError(
    'provider_error',
    true,
    'the recording download did not match its declared size',
  );
}

/**
 * Reads the body, stopping as soon as it passes `maxBytes`. With a content-length it fills one
 * buffer of that size (no second copy) and fails unless exactly that many bytes arrive: a stream
 * that ends early is a truncated download, never a shorter recording.
 */
async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = declaredLength(res);
  if (declared !== undefined && declared > maxBytes) {
    await res.body?.cancel();
    throw tooLarge(maxBytes);
  }
  if (res.body === null) return new Uint8Array(0);
  const reader = res.body.getReader();
  const fixed = declared === undefined ? undefined : new Uint8Array(declared);
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.byteLength > maxBytes) {
      await reader.cancel();
      throw tooLarge(maxBytes);
    }
    if (fixed === undefined) {
      parts.push(value);
    } else {
      if (size + value.byteLength > fixed.byteLength) {
        await reader.cancel();
        throw sizeMismatch();
      }
      fixed.set(value, size);
    }
    size += value.byteLength;
  }
  if (fixed !== undefined) {
    if (size !== fixed.byteLength) {
      throw new TranscriberError(
        'provider_error',
        true,
        `the recording download ended early (${String(size)} of ${String(fixed.byteLength)} bytes)`,
        'truncated',
      );
    }
    return fixed;
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

/** Downloads the recording. Throws a TranscriberError that never names the URL. */
export async function download(url: URL, opts: DownloadOptions): Promise<Uint8Array> {
  const signal = AbortSignal.timeout(opts.timeoutMs);
  let current = url;
  try {
    for (let hop = 0; ; hop += 1) {
      const res = await opts.fetch(current.href, { redirect: 'manual', signal });
      if (res.status >= 300 && res.status < 400) {
        await res.body?.cancel();
        const location = res.headers.get('location');
        if (location === null) {
          throw new TranscriberError(
            'provider_error',
            false,
            'storage sent a redirect with no location',
          );
        }
        const next = new URL(location, current);
        // Same host, https only: a redirect is never a way off the allowlist.
        if (next.protocol !== 'https:' || next.host !== current.host) {
          throw new TranscriberError(
            'forbidden',
            false,
            'storage redirected to another host; refused',
          );
        }
        if (hop >= MAX_REDIRECTS) {
          throw new TranscriberError('provider_error', false, 'storage redirected too many times');
        }
        current = next;
        continue;
      }
      if (res.status < 200 || res.status >= 300) {
        await res.body?.cancel();
        throw statusError(res.status);
      }
      const bytes = await readCapped(res, opts.maxBytes);
      if (bytes.byteLength === 0) {
        throw new TranscriberError('validation', false, 'the recording is empty');
      }
      return bytes;
    }
  } catch (err) {
    if (err instanceof TranscriberError) throw err;
    // The original error is dropped, not kept as `cause`: fetch errors can quote the URL.
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new TranscriberError('provider_error', true, 'the recording download timed out');
    }
    throw new TranscriberError(
      'provider_error',
      true,
      'could not download the recording from storage',
    );
  }
}
