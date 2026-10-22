// The production PinnedTransport for web links (task 8.2d, ADR-0014 Decisions 1, 5, 6 and 8).
//
// It connects to exactly the address the fetcher checked: `node:https.request` gets a `lookup` that
// always answers with that address, so Node never asks DNS again. TLS SNI and the certificate check
// still use the URL's host name (an IP-literal host sends no SNI); certificate checks are never
// turned off. No agent (no keep-alive, no proxy), a fixed header list, no cookie jar.
//
// A server that compresses anyway is decompressed here (gzip, deflate, br) as a stream; the
// fetcher's cap counts the decompressed bytes, so a compression bomb stops at the cap. Any other
// encoding is passed through untouched and the fetcher refuses it. No error here carries the URL.
import https from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';
import type { LookupFunction } from 'node:net';
import { isIP } from 'node:net';
import type { Readable, Transform } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import type { PinnedTransport, TransportRequest, TransportResponse } from '@edmate/ingest';

/** Time to connect and receive the response headers, per hop (the body is under the fetcher's deadline). */
export const CONNECT_TIMEOUT_MS = 5_000;

export type RequestFn = (
  url: URL,
  options: https.RequestOptions,
  callback: (res: IncomingMessage) => void,
) => ClientRequest;

export interface PinnedTransportOptions {
  /** Defaults to `node:https`'s request; tests inject `node:http`'s against a local server. */
  readonly request?: RequestFn;
  readonly timeoutMs?: number;
}

const DECODERS: Readonly<Record<string, () => Transform>> = {
  gzip: createGunzip,
  'x-gzip': createGunzip,
  deflate: createInflate,
  br: createBrotliDecompress,
};

/** An error with fixed words and a name the fetcher understands; never the URL or address. */
function transportError(name: string, message: string): Error {
  return Object.assign(new Error(`web link transport: ${message}`), { name });
}

/** A `lookup` that answers every question with the pinned address (both callback forms). */
export function pinnedLookup(address: string, family: 4 | 6): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all === true) {
      callback(null, [{ address, family }]);
      return;
    }
    callback(null, address, family);
  };
}

/** `autoSelectFamily` is a socket option Node passes through; @types/node's RequestOptions omits it. */
export type PinnedRequestOptions = https.RequestOptions & { readonly autoSelectFamily: false };

/** The request options for one pinned request; exported so the safety rules can be asserted. */
export function pinnedRequestOptions(req: TransportRequest): PinnedRequestOptions {
  const host = req.url.hostname.replace(/^\[(.*)\]$/, '$1').replace(/\.$/, '');
  return {
    method: 'GET',
    headers: { ...req.headers },
    lookup: pinnedLookup(req.address, req.family),
    family: req.family,
    autoSelectFamily: false,
    agent: false,
    // Explicit: it overrides NODE_TLS_REJECT_UNAUTHORIZED=0 anywhere in the worker's env.
    rejectUnauthorized: true,
    signal: req.signal,
    // SNI must be a host name, never an IP literal (RFC 6066).
    ...(isIP(host) === 0 ? { servername: host } : {}),
  };
}

function wrap(res: IncomingMessage): TransportResponse {
  const encoding = (res.headers['content-encoding'] ?? '').trim().toLowerCase();
  const makeDecoder = DECODERS[encoding];
  let body: Readable = res;
  const dropped = new Set<string>();
  if (makeDecoder !== undefined) {
    const decoder = makeDecoder();
    res.on('error', (err) => decoder.destroy(err));
    body = res.pipe(decoder);
    dropped.add('content-encoding').add('content-length');
  }
  return {
    status: res.statusCode ?? 0,
    header(name) {
      const key = name.toLowerCase();
      if (dropped.has(key)) return undefined;
      const value = res.headers[key];
      return Array.isArray(value) ? value.join(', ') : value;
    },
    body,
    cancel() {
      body.destroy();
      res.destroy();
    },
  };
}

export function createPinnedTransport(opts: PinnedTransportOptions = {}): PinnedTransport {
  const request: RequestFn = opts.request ?? ((u, o, cb) => https.request(u, o, cb));
  const timeoutMs = opts.timeoutMs ?? CONNECT_TIMEOUT_MS;

  return (req) =>
    new Promise<TransportResponse>((resolve, reject) => {
      let settled = false;
      const fail = (err: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      };
      let client: ClientRequest;
      try {
        client = request(req.url, pinnedRequestOptions(req), (res) => {
          if (settled) {
            res.destroy();
            return;
          }
          settled = true;
          clearTimeout(timer);
          resolve(wrap(res));
        });
      } catch {
        // The raw error can quote the URL; no timer is armed yet, so nothing is left to fire.
        settled = true;
        reject(transportError('Error', 'the connection failed'));
        return;
      }
      const timer = setTimeout(() => {
        fail(transportError('TimeoutError', 'no response in time'));
        client.destroy();
      }, timeoutMs);
      client.on('error', (err) => {
        const name = err.name === 'AbortError' ? 'AbortError' : 'Error';
        fail(transportError(name, 'the connection failed'));
      });
      client.end();
    });
}
