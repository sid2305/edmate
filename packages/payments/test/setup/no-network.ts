// Every payments test runs with the network off: an adapter that ignored its injected transport
// and reached for the global fetch, or opened any socket, DNS lookup or UDP socket, fails loudly
// instead of reaching a provider (build plan rule 4). The replacements are plain assignments, not
// spies, so vi.restoreAllMocks() or `restoreMocks: true` can't undo them, and they are re-applied
// before every test in case a test reassigned one. syncBuiltinESMExports() carries them to named
// imports (`import { connect } from 'node:net'`).
import dgram from 'node:dgram';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import tls from 'node:tls';
import { beforeEach } from 'vitest';

export const NETWORK_OFF = 'real network is off in payments tests';

function refuse(): never {
  throw new Error(NETWORK_OFF);
}

function networkOff(): void {
  globalThis.fetch = () => Promise.reject(new Error(NETWORK_OFF));
  net.connect = refuse;
  net.createConnection = refuse;
  net.Socket.prototype.connect = refuse;
  tls.connect = refuse;
  http.get = refuse;
  http.request = refuse;
  https.get = refuse;
  https.request = refuse;
  dns.lookup = refuse as unknown as typeof dns.lookup;
  dns.resolve = refuse as unknown as typeof dns.resolve;
  dns.promises.lookup = (() =>
    Promise.reject(new Error(NETWORK_OFF))) as unknown as typeof dns.promises.lookup;
  dgram.createSocket = refuse;
  syncBuiltinESMExports();
}

networkOff();
beforeEach(networkOff);
