// A real pack or persona template must never ship with leftover fixture/placeholder prose (task
// 3.11a; the real content lands in 3.11b). Passes trivially until then: neither directory exists
// yet, so there is nothing to scan.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '../../..');
const DIRS = [
  join(REPO_ROOT, 'content/prompt-packs'),
  join(REPO_ROOT, 'content/skills'),
  join(REPO_ROOT, 'content/locales'), // task 3.10
  join(REPO_ROOT, 'content/legal'), // task 1.7
];

function listFiles(dir: string): string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)).split(sep).join('/'))
    .sort();
}

describe('no "fixture" prose in the real content directories', () => {
  it.each(DIRS)('%s', (dir) => {
    const offenders = listFiles(dir)
      .filter((rel) => readFileSync(join(dir, rel), 'utf8').toLowerCase().includes('fixture'))
      .sort();
    expect(offenders).toEqual([]);
  });
});
