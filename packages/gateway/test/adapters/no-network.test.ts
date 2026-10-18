// Rule 4: no real network in tests. Two checks: the global fetch is replaced for every test
// (test/setup/no-network.ts), and no test file reaches for a socket some other way.
import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const TEST = fileURLToPath(new URL('..', import.meta.url));
const files = readdirSync(TEST, { recursive: true, encoding: 'utf8' })
  .filter((f) => f.endsWith('.ts'))
  .map((f) => ({ path: f.split(sep).join('/'), text: readFileSync(join(TEST, f), 'utf8') }));

describe('no real network in gateway tests', () => {
  it('scans the real test tree', () => {
    const paths = files.map((f) => f.path);
    expect(paths).toContain('helpers/fetch-mock.ts');
    expect(paths).toContain('adapters/contract-suite.ts');
  });

  it('the global fetch is the setup stub, which always rejects', async () => {
    await expect(globalThis.fetch('https://api.anthropic.com/v1/messages')).rejects.toThrow(
      'real network is off',
    );
  });

  it('no test imports a network module', () => {
    const banned =
      /from\s+['"](?:node:)?(?:http|https|http2|net|tls|dgram|dns)['"]|from\s+['"](?:undici|msw|axios|node-fetch)['"]/;
    const offenders = files.filter((f) => banned.test(f.text)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('URLs handed to adapters use reserved .invalid hosts or are only asserted on', () => {
    // Real provider hosts may appear only in assertions about where requests would go.
    const realHost = /https?:\/\/(?![^/'"`\s]*\.invalid\b)[^/'"`\s]+/g;
    const allowed = new Set(['https://api.anthropic.com']);
    const offenders = files
      .flatMap((f) => (f.text.match(realHost) ?? []).map((url) => `${f.path}: ${url}`))
      .filter((hit) => !allowed.has(hit.slice(hit.indexOf(': ') + 2)));
    expect(offenders).toEqual([]);
  });
});
