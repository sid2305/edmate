// The worker's web-link fetcher (task 8.2d, ADR-0014 Decision 10). Nothing calls it yet: task 8.2e
// wires it into the ingest processor.
//
// EDMATE_WEB_LINK_HOSTS picks the allow-list mode:
// - unset or empty: every link is refused (fail closed);
// - exactly `*`: any https host on port 443 whose addresses are all public;
// - a comma list of bare host names: exact match only.
// A malformed value throws WebLinkConfigError with a fixed code, never the value itself, so the
// caller can log it and turn off web links only.
import { createWebFetcher, systemResolveHost, type WebFetcher } from '@edmate/ingest';
import { normaliseAllowedHosts } from '@edmate/ingest';
import { createPinnedTransport, type RequestFn } from './pinnedTransport.js';

export {
  CONNECT_TIMEOUT_MS,
  createPinnedTransport,
  pinnedLookup,
  pinnedRequestOptions,
  type PinnedTransportOptions,
  type RequestFn,
} from './pinnedTransport.js';

export const WEB_LINK_HOSTS_ENV = 'EDMATE_WEB_LINK_HOSTS';

export class WebLinkConfigError extends Error {
  override readonly name = 'WebLinkConfigError';
  readonly code = 'web_link_hosts_invalid';

  constructor() {
    super(`worker: ${WEB_LINK_HOSTS_ENV} must be empty, "*" or a comma list of bare host names`);
  }
}

/** The allow-list mode from the env value; a malformed value throws WebLinkConfigError. */
export function parseWebLinkHosts(raw: string | undefined): readonly string[] | 'any-public' {
  const text = (raw ?? '').trim();
  if (text === '') return [];
  if (text === '*') return 'any-public';
  const hosts = text.split(',').map((h) => h.trim());
  try {
    return [...normaliseAllowedHosts(hosts)];
  } catch {
    throw new WebLinkConfigError();
  }
}

export interface WorkerWebFetcherDeps {
  readonly resolveHost?: (host: string) => Promise<readonly string[]>;
  readonly request?: RequestFn;
  readonly timeoutMs?: number;
}

/** The real composition: the env's mode, the system resolver and the pinned https transport. */
export function createWorkerWebFetcher(
  env: Readonly<Record<string, string | undefined>>,
  deps: WorkerWebFetcherDeps = {},
): WebFetcher {
  return createWebFetcher({
    allowedHosts: parseWebLinkHosts(env[WEB_LINK_HOSTS_ENV]),
    resolveHost: deps.resolveHost ?? systemResolveHost,
    transport: createPinnedTransport(deps.request === undefined ? {} : { request: deps.request }),
    ...(deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs }),
  });
}
