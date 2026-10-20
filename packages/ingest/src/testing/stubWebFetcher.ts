// A WebFetcher that serves recorded HTML from memory: every web-link test goes through this (or
// the real fetcher with a fake transport), never the network (rule 4).
import { IngestError } from '../errors.js';
import type { FetchedPage, WebFetcher } from '../fetch/webFetch.js';

export interface StubWebFetcher extends WebFetcher {
  /** Every URL asked for, in order. */
  readonly requests: readonly string[];
}

export function stubWebFetcher(pages: Readonly<Record<string, string>>): StubWebFetcher {
  const recorded = new Map(Object.entries(pages));
  const requests: string[] = [];
  return {
    requests,
    fetchPage(url: string): Promise<FetchedPage> {
      requests.push(url);
      const html = recorded.get(url);
      return html === undefined
        ? Promise.reject(new IngestError('not_found', false, 'no recorded page for this web link'))
        : Promise.resolve({ html });
    },
  };
}
