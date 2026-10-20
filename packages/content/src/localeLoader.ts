// Reads locale packs (task 3.10): `content/locales/<market>.yaml`, one file per market plus the
// default pack `global.yaml`. The schema is the frozen contract `LocalePackSchema` (a pack has no
// server-assigned ids to leave out, so there is no draft schema). Like the teacher-content loader,
// `readLocalePacksDir` collects every bad file instead of stopping at the first.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { type LocalePack, LocalePackSchema } from '@edmate/contracts';
import { load } from 'js-yaml';
import { z } from 'zod';
import { ContentLoadError } from './loader.js';

/** `<market>.yaml`, where market is an ISO 3166-1 alpha-2 code or `global` (the contract's format). */
const PACK_FILE = /^([A-Z]{2}|global)\.yaml$/;

function readText(path: string, file: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (cause) {
    throw new ContentLoadError(file, `cannot read: ${(cause as Error).message}`, { cause });
  }
}

/** One pack file, parsed and validated; its `market` must match the file name. */
export function readLocalePack(path: string): LocalePack {
  const file = basename(path);
  const text = readText(path, file);
  let doc: unknown;
  try {
    doc = load(text, { filename: file });
  } catch (cause) {
    throw new ContentLoadError(file, `invalid YAML: ${(cause as Error).message}`, { cause });
  }
  const parsed = LocalePackSchema.safeParse(doc);
  if (!parsed.success) {
    throw new ContentLoadError(file, `invalid locale pack:\n${z.prettifyError(parsed.error)}`, {
      cause: parsed.error,
    });
  }
  const expected = file.replace(/\.yaml$/, '');
  if (parsed.data.market !== expected) {
    throw new ContentLoadError(
      file,
      `market "${parsed.data.market}" does not match the file name (expected "${expected}")`,
    );
  }
  return parsed.data;
}

/** Non-hidden top-level entries of `dir`, sorted by code unit (never readdir order). */
function topLevel(dir: string): { name: string; isFile: boolean }[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => !e.name.startsWith('.'))
    .map((e) => ({ name: e.name, isFile: e.isFile() }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** True when `dir` has no `course.yaml` and at least one top-level file named like a pack. */
export function isLocalePacksDir(dir: string): boolean {
  if (existsSync(join(dir, 'course.yaml'))) return false;
  return topLevel(dir).some((e) => e.isFile && PACK_FILE.test(e.name));
}

/** Every pack in `dir`, keyed by market, plus one error per bad file or unexpected entry. */
export function readLocalePacksDir(dir: string): {
  packs: Map<string, LocalePack>;
  errors: ContentLoadError[];
} {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(`${dir}: no such locale-packs directory`);
  }
  const packs = new Map<string, LocalePack>();
  const errors: ContentLoadError[] = [];
  for (const { name, isFile } of topLevel(dir)) {
    if (!isFile || !PACK_FILE.test(name)) {
      errors.push(
        new ContentLoadError(
          name,
          'unexpected entry (a locale pack is a file named <market>.yaml, e.g. IN.yaml or global.yaml)',
        ),
      );
      continue;
    }
    try {
      const pack = readLocalePack(join(dir, name));
      packs.set(pack.market, pack);
    } catch (e) {
      errors.push(e as ContentLoadError);
    }
  }
  return { packs, errors };
}
