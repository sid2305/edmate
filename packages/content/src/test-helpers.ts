// Test helpers: per-rule broken trees are made by copying the valid fixture to a temp dir and
// changing one file, so each test shows exactly one violation.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';

export const VALID = new URL('../test/fixtures/valid', import.meta.url).pathname;
export const BROKEN_ALL = new URL('../test/fixtures/broken-all', import.meta.url).pathname;
/** A made-up locale-packs directory: a default pack and one fictional market, XX. */
export const LOCALES_VALID = new URL('../test/fixtures/locales/valid', import.meta.url).pathname;

const temps: string[] = [];
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'edmate-content-'));
  temps.push(dir);
  return dir;
}

/** A writable copy of the valid fixture tree. */
export function copyValid(): string {
  const dir = tempDir();
  cpSync(VALID, dir, { recursive: true });
  return dir;
}

/** A writable copy of the made-up locale-packs directory. */
export function copyLocalesValid(): string {
  const dir = tempDir();
  cpSync(LOCALES_VALID, dir, { recursive: true });
  return dir;
}

/** Rewrites `rel` under `dir` with `edit(oldText)`. */
export function edit(dir: string, rel: string, change: (old: string) => string): void {
  const path = join(dir, rel);
  writeFileSync(path, change(readFileSync(path, 'utf8')));
}
