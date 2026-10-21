// `validateContentDir` (task 1.8): file errors plus every content rule, collected, never
// fail-fast. It dispatches on what the directory holds: a `course.yaml` means a teacher
// content tree; otherwise top-level `<market>.yaml` files mean a locale-packs directory (3.10),
// and top-level `<market>.md` files mean a privacy-notice directory (1.7).
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readContentTree } from './loader.js';
import { isLocalePacksDir, readLocalePacksDir } from './localeLoader.js';
import { checkLocalePacks } from './localeRules.js';
import { checkPrivacyNotices, isPrivacyNoticesDir, readPrivacyNoticesDir } from './privacyNotices.js';
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
  if (isLocalePacksDir(dir)) {
    const { packs, errors } = readLocalePacksDir(dir);
    return result([...errors.map((e) => e.message), ...checkLocalePacks(packs)]);
  }
  if (isPrivacyNoticesDir(dir)) {
    const { notices, errors } = readPrivacyNoticesDir(dir);
    return result([...errors.map((e) => e.message), ...checkPrivacyNotices(notices)]);
  }
  if (!existsSync(join(dir, 'course.yaml'))) {
    return result(['course.yaml: missing; not a recognised content directory']);
  }
  const { tree, errors } = readContentTree(dir);
  return result([...errors.map((e) => e.message), ...CONTENT_RULES.flatMap((rule) => rule(tree))]);
}
