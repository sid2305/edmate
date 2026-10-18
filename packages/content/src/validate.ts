// `validateContentDir` (task 1.8): file errors plus every content rule, collected, never
// fail-fast. It dispatches on what the directory holds: a `course.yaml` means a teacher
// content tree. Task 3.10 adds a branch for locale packs here.
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readContentTree } from './loader.js';
import { CONTENT_RULES } from './rules.js';

export interface ValidationResult {
  ok: boolean;
  issues: string[];
}

function result(issues: string[]): ValidationResult {
  return { ok: issues.length === 0, issues };
}

export function validateContentDir(dir: string): ValidationResult {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return result([`${dir}: no such content directory`]);
  }
  if (!existsSync(join(dir, 'course.yaml'))) {
    return result(['course.yaml: missing; not a recognised content directory']);
  }
  const { tree, errors } = readContentTree(dir);
  return result([...errors.map((e) => e.message), ...CONTENT_RULES.flatMap((rule) => rule(tree))]);
}
