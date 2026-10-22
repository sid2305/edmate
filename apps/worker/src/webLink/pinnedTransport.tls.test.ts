// The pinned transport over real TLS (task 8.2e, from the 8.2d review): a local https server on
// 127.0.0.1 with a throwaway self-signed certificate for `teacher-site.test`, made by the openssl
// CLI in a temp directory when the suite starts and deleted when it ends (never committed). The
// name is not in DNS, so a request that lands proves the pin; the server records the SNI name.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TLSSocket } from 'node:tls';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { WEB_FETCH_HEADERS, type TransportRequest, type TransportResponse } from '@edmate/ingest';
import { createPinnedTransport, type RequestFn } from './pinnedTransport.js';

const NAME = 'teacher-site.test';
let dir = '';
let key = '';
let cert = '';

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'edmate-tls-'));
  const keyFile = join(dir, 'key.pem');
  const certFile = join(dir, 'cert.pem');
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'ec',
      '-pkeyopt',
      'ec_paramgen_curve:prime256v1',
      '-nodes',
      '-keyout',
      keyFile,
      '-out',
      certFile,
      '-days',
      '1',
      '-subj',
      `/CN=${NAME}`,
      '-addext',
      `subjectAltName=DNS:${NAME}`,
    ],
    { stdio: 'ignore' },
  );
  key = readFileSync(keyFile, 'utf8');
  cert = readFileSync(certFile, 'utf8');
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

interface TlsServer {
  readonly port: number;
  readonly sni: (string | false | null)[];
  connections(): number;
  requests(): number;
  close(): Promise<void>;
}

let server: TlsServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function startTls(): Promise<TlsServer> {
  const sni: (string | false | null)[] = [];
  let connections = 0;
  let requests = 0;
  const s = https.createServer({ key, cert }, (_q, res) => {
    requests += 1;
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<p>over tls</p>');
  });
  s.on('connection', () => {
    connections += 1;
  });
  s.on('secureConnection', (socket: TLSSocket) => {
    sni.push(socket.servername);
  });
  s.on('tlsClientError', () => undefined);
  await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', resolve));
  const { port } = s.address() as AddressInfo;
  return {
    port,
    sni,
    connections: () => connections,
    requests: () => requests,
    close: () =>
      new Promise<void>((resolve) => {
        s.closeAllConnections();
        s.close(() => resolve());
      }),
  };
}

function req(port: number, host = NAME): TransportRequest {
  return {
    url: new URL(`https://${host}:${String(port)}/page?key=leak-marker-qz`),
    address: '127.0.0.1',
    family: 4,
    headers: WEB_FETCH_HEADERS,
    signal: AbortSignal.timeout(10_000),
  };
}

/** https.request that also trusts the throwaway certificate (and nothing else changes). */
const trusting: RequestFn = (u, o, cb) => https.request(u, { ...o, ca: cert }, cb);

async function text(res: TransportResponse): Promise<string> {
  const parts: Buffer[] = [];
  for await (const c of res.body) parts.push(Buffer.from(c));
  return Buffer.concat(parts).toString('utf8');
}

describe('createPinnedTransport over TLS', () => {
  it('a trusted certificate for the URL host lands on the pinned address with SNI set', async () => {
    server = await startTls();
    const res = await createPinnedTransport({ request: trusting })(req(server.port));
    expect(res.status).toBe(200);
    expect(await text(res)).toBe('<p>over tls</p>');
    await res.cancel();
    expect(server.sni).toEqual([NAME]);
    expect(server.connections()).toBe(1);
  });

  it('the default https.request refuses an untrusted certificate: one connection, no request', async () => {
    server = await startTls();
    const p = createPinnedTransport()(req(server.port));
    await expect(p).rejects.toThrow('web link transport: the connection failed');
    expect(server.connections()).toBe(1);
    expect(server.requests()).toBe(0);
  });

  it('certificate checks stay on even with NODE_TLS_REJECT_UNAUTHORIZED=0 in the env', async () => {
    server = await startTls();
    const before = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    try {
      await expect(createPinnedTransport()(req(server.port))).rejects.toThrow(
        'the connection failed',
      );
      expect(server.requests()).toBe(0);
    } finally {
      if (before === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = before;
    }
  });

  it('the certificate is checked against the URL host, not the pinned address', async () => {
    server = await startTls();
    const p = createPinnedTransport({ request: trusting })(req(server.port, 'other-site.test'));
    await expect(p).rejects.toThrow('web link transport: the connection failed');
    expect(server.sni).toEqual([]);
    expect(server.requests()).toBe(0);
  });
});
