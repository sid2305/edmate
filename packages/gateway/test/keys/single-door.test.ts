// Keys enter through one door (src/keys) and leave only through Secret.reveal() in src/keys or
// the provider adapters (src/adapters, task 2.2). A source-level check that this stays true.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../../src', import.meta.url));

const files = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
  .filter((f) => f.endsWith('.ts'))
  .map((f) => ({ path: f.split(sep).join('/'), text: readFileSync(join(SRC, f), 'utf8') }));

const under = (dir: string) => (f: { path: string }) => f.path.startsWith(`${dir}/`);

describe('single door for provider keys', () => {
  it('scans the real source tree', () => {
    const paths = files.map((f) => f.path);
    expect(paths).toContain('keys/secret.ts');
    expect(paths).toContain('keys/load.ts');
    expect(paths).toContain('index.ts');
    expect(relative(SRC, join(SRC, 'keys'))).toBe('keys');
  });

  it('no src file reads process.env (the caller passes the env in)', () => {
    const offenders = files.filter((f) => /process\s*\.\s*env/.test(f.text)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('.reveal( appears only under src/keys/ and src/adapters/', () => {
    const allowed = (f: { path: string }) => under('keys')(f) || under('adapters')(f);
    const offenders = files
      .filter((f) => !allowed(f) && /\.reveal\s*\(/.test(f.text))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('src/keys/ makes no console calls', () => {
    const keysFiles = files.filter(under('keys'));
    expect(keysFiles.length > 0).toBe(true);
    const offenders = keysFiles.filter((f) => /\bconsole\s*\./.test(f.text)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});
