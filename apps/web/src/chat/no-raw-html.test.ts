// Task 9.4 Phase B: a source scan. Nothing in the chat code or the learn pages may render raw HTML
// (4.6b safety review): no dangerouslySetInnerHTML, no innerHTML/outerHTML writes, no
// insertAdjacentHTML, no rehype-raw. This file itself is skipped (it names the patterns).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WEB = fileURLToPath(new URL('../..', import.meta.url));
const ROOTS = ['src/chat', 'app/learn'];
const SELF = fileURLToPath(import.meta.url);
const BANNED = [/dangerouslySetInnerHTML/, /\b(?:inner|outer)HTML\b/, /insertAdjacentHTML/, /rehype-raw/];

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return filesUnder(path);
    return /\.(?:tsx?|jsx?|mjs|css)$/.test(name) ? [path] : [];
  });
}

function rawHtmlHits(files: string[]): string[] {
  return files.flatMap((file) => {
    const text = readFileSync(file, 'utf8');
    return BANNED.filter((re) => re.test(text)).map((re) => `${relative(WEB, file)}: ${re.source}`);
  });
}

describe('no raw HTML in the chat', () => {
  it('scans at least the chat renderer', () => {
    const files = ROOTS.flatMap((r) => filesUnder(join(WEB, r)));
    expect(files.some((f) => f.endsWith('renderReply.tsx'))).toBe(true);
  });

  it('no chat or learn source uses a raw-HTML API', () => {
    const files = ROOTS.flatMap((r) => filesUnder(join(WEB, r))).filter((f) => f !== SELF);
    expect(rawHtmlHits(files)).toEqual([]);
  });

  it('the scan catches each banned pattern (the check itself works)', () => {
    const SAMPLE = fileURLToPath(new URL('./no-raw-html.test.ts', import.meta.url));
    // This file names every pattern, so scanning it must report all of them.
    expect(rawHtmlHits([SAMPLE])).toHaveLength(BANNED.length);
  });
});
