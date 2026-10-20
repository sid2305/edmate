import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stubWebFetcher } from '../../src/testing/index.js';

const recorded = readFileSync(
  new URL('../fixtures/html/decimals-flat.html', import.meta.url),
  'utf8',
);
const URL_A = 'https://lessons.example.org/decimals';

describe('stubWebFetcher', () => {
  it('round-trips a recorded page and records each request', async () => {
    const stub = stubWebFetcher({ [URL_A]: recorded });
    await expect(stub.fetchPage(URL_A)).resolves.toEqual({ html: recorded });
    expect(stub.requests).toEqual([URL_A]);
  });

  it('an unknown URL is not_found, like a 404 from the real fetcher', async () => {
    const stub = stubWebFetcher({});
    await expect(stub.fetchPage(URL_A)).rejects.toMatchObject({
      name: 'IngestError',
      code: 'not_found',
    });
    expect(stub.requests).toEqual([URL_A]);
  });

  it('later edits to the source map do not change what the stub serves', async () => {
    const pages: Record<string, string> = { [URL_A]: '<p>one</p>' };
    const stub = stubWebFetcher(pages);
    pages[URL_A] = '<p>two</p>';
    await expect(stub.fetchPage(URL_A)).resolves.toEqual({ html: '<p>one</p>' });
  });
});
