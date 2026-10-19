// Loads eval cases from a directory of YAML files (task 3.12). Order comes from sorting the
// relative paths, never from readdir, so every run sees the same sequence. A bad file throws;
// nothing is ever skipped silently.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { load } from 'js-yaml';
import { z } from 'zod';
import { EvalCaseSchema, type EvalCase } from './schema.js';

export class CaseLoadError extends Error {
  override readonly name = 'CaseLoadError';

  constructor(
    readonly filePath: string,
    detail: string,
    options?: { cause?: unknown },
  ) {
    super(`${filePath}: ${detail}`, options);
  }
}

function listCaseFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.ya?ml$/.test(e.name))
    .map((e) => relative(dir, join(e.parentPath, e.name)).split(sep).join('/'))
    .sort();
}

function loadOne(filePath: string): EvalCase {
  let doc: unknown;
  try {
    doc = load(readFileSync(filePath, 'utf8'), { filename: filePath });
  } catch (cause) {
    throw new CaseLoadError(filePath, `invalid YAML: ${(cause as Error).message}`, { cause });
  }
  const parsed = EvalCaseSchema.safeParse(doc);
  if (!parsed.success) {
    throw new CaseLoadError(filePath, `invalid eval case:\n${z.prettifyError(parsed.error)}`, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

export interface LoadedCaseFile {
  /** Path relative to `dir`, `/`-separated. */
  file: string;
  evalCase: EvalCase;
}

/**
 * Every `.yaml`/`.yml` under `dir` (recursive), validated, in sorted relative-path order, each
 * paired with the relative path it came from. Callers that need to report problems against a
 * specific file (not just the case) should use this instead of re-listing the directory
 * themselves, which can drift from the order `loadCasesFromDir` actually loaded.
 */
export function loadCasesWithFiles(dir: string): LoadedCaseFile[] {
  const files = listCaseFiles(dir);
  if (files.length === 0) throw new Error(`${dir}: no .yaml or .yml cases found`);
  const seen = new Map<string, string>();
  return files.map((file) => {
    const filePath = join(dir, file);
    const evalCase = loadOne(filePath);
    const earlier = seen.get(evalCase.id);
    if (earlier !== undefined) {
      throw new CaseLoadError(filePath, `duplicate case id "${evalCase.id}" (also in ${earlier})`);
    }
    seen.set(evalCase.id, filePath);
    return { file, evalCase };
  });
}

/** Every `.yaml`/`.yml` under `dir` (recursive), validated, in sorted relative-path order. */
export function loadCasesFromDir(dir: string): EvalCase[] {
  return loadCasesWithFiles(dir).map((c) => c.evalCase);
}
