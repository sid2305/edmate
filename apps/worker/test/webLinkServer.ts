// A local node:http server on 127.0.0.1 for the web-link transport tests (task 8.2d). Tests never
// touch the real internet; a local TLS server would need a committed private key, so the
// transport's injected `request` is node:http's against this server.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { RequestFn } from '../src/webLink/pinnedTransport.js';

export interface SeenRequest {
  readonly url: string;
  readonly headers: http.IncomingHttpHeaders;
}

export interface TestServer {
  readonly port: number;
  readonly seen: SeenRequest[];
  connections(): number;
  close(): Promise<void>;
}

export async function startServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<TestServer> {
  const seen: SeenRequest[] = [];
  let connections = 0;
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url ?? '', headers: req.headers });
    handler(req, res);
  });
  server.on('connection', () => {
    connections += 1;
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    port,
    seen,
    connections: () => connections,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export interface Redirected {
  readonly request: RequestFn;
  /** The address each request's pinned lookup answered with. */
  readonly pinned: string[];
}

/**
 * A `request` that turns the fetcher's https:443 request into plain http on the local server's
 * port. It keeps every option the transport set, records the address the pinned lookup gives,
 * and then pins the socket to 127.0.0.1 so a test can never reach a public address.
 */
export function toLocalServer(port: number): Redirected {
  const pinned: string[] = [];
  const request: RequestFn = (url, options, callback) => {
    options.lookup?.(url.hostname, {}, (err, address) => {
      if (err === null && typeof address === 'string') pinned.push(address);
    });
    const local = new URL(`http://${url.host}:${String(port)}${url.pathname}${url.search}`);
    return http.request(
      local,
      {
        ...options,
        lookup: (_h, _o, cb) => {
          cb(null, '127.0.0.1', 4);
        },
      },
      callback,
    );
  };
  return { request, pinned };
}
