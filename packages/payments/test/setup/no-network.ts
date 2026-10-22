// Every payments test runs with the network off: an adapter that ignored its injected transport
// and reached for the global fetch, or opened any socket, fails loudly instead of reaching a
// provider (build plan rule 4).
import net from 'node:net';
import tls from 'node:tls';
import { vi } from 'vitest';

const OFF = 'real network is off in payments tests';

function refuse(): never {
  throw new Error(OFF);
}

globalThis.fetch = () => Promise.reject(new Error(OFF));
vi.spyOn(net, 'connect').mockImplementation(refuse);
vi.spyOn(net, 'createConnection').mockImplementation(refuse);
vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(refuse);
vi.spyOn(tls, 'connect').mockImplementation(refuse);
