// Rule 4: ingest tests never open a socket. Web-link tests go through an injected fake fetch and
// resolver (or stubWebFetcher); this check fails if a test file reaches for a real transport.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = fileURLToPath(new URL('.', import.meta.url));

function testFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? testFiles(join(dir, e.name))
      : e.name.endsWith('.ts')
        ? [join(dir, e.name)]
        : [],
  );
}

const transport =
  /from\s+['"](?:node:)?(?:http|https|http2|net|tls|dgram|dns(?:\/promises)?|undici)['"]/;

describe('rule 4: no network in ingest tests', () => {
  it('no test file imports a network module', () => {
    const offenders = testFiles(testDir).filter((f) => transport.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('the global fetch is disabled for every test', async () => {
    await expect(globalThis.fetch('https://lessons.example.org/')).rejects.toThrow(
      /real network is off/,
    );
  });
});
