// Proves the no-network setup is loaded and holds, even after vi.restoreAllMocks().
import dgram from 'node:dgram';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net, { connect as namedConnect } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { NETWORK_OFF } from './setup/no-network.js';

const attempts: [string, () => unknown][] = [
  ['http.get', () => http.get('http://127.0.0.1:9/')],
  ['https.get', () => https.get('https://127.0.0.1:9/')],
  ['net.connect', () => net.connect(9, '127.0.0.1')],
  ['a named net connect import', () => namedConnect(9, '127.0.0.1')],
  ['dns.lookup', () => dns.lookup('localhost', () => undefined)],
  ['dgram.createSocket', () => dgram.createSocket('udp4')],
];

describe('no-network setup', () => {
  it('fetch and dns.promises.lookup reject with the OFF message', async () => {
    await expect(fetch('https://127.0.0.1:9/')).rejects.toThrow(NETWORK_OFF);
    await expect(dns.promises.lookup('localhost')).rejects.toThrow(NETWORK_OFF);
  });

  it.each(attempts)('%s throws with the OFF message', (_name, attempt) => {
    expect(attempt).toThrow(NETWORK_OFF);
  });

  it('still holds after vi.restoreAllMocks()', async () => {
    vi.restoreAllMocks();
    await expect(fetch('https://127.0.0.1:9/')).rejects.toThrow(NETWORK_OFF);
    for (const [, attempt] of attempts) expect(attempt).toThrow(NETWORK_OFF);
  });
});
