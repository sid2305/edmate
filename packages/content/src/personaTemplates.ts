// Reads a persona-template directory (task 3.11a) for mock-interview and viva role-play. Each
// template is `Persona`-shaped (contracts) plus a `reviewed_by` sign-off, same review contract as
// a prompt pack (task 3.6's `promptPacks.ts`), but far smaller: one flat YAML document per file,
// no markdown front matter and no body to fence (a persona template has no prose).
//
// Layout (flat; also used by 3.11b in content/skills/mock_interview/):
//   <id>@<semver>.yaml   id is a file-naming slug (e.g. "job-interview"), not the persona's name.
//     The persona's own `name` is a role name shown to the model ("Interviewer", "Viva examiner"),
//     never a specific person or teacher — the composer renders it verbatim into the prompt
//     (`compose.ts`'s `persona_name` placeholder).
// A README.md and hidden files are ignored; anything else is an issue. Issues are collected and
// sorted, never fail-fast (`promptPacks.ts` precedent).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { AgentConfigSchema, PersonaSchema } from '@edmate/contracts';
import { FAILSAFE_SCHEMA, load } from 'js-yaml';
import { z } from 'zod';
import type { ValidationResult } from './validate.js';

const TEMPLATE_FILE = /^([a-z][a-z0-9_-]*)@(.+)\.yaml$/;
const Semver = AgentConfigSchema.shape.promptPackVersion;

/** `Persona` (contracts) plus the same sign-off every prompt pack carries. */
export const PersonaTemplateSchema = PersonaSchema.extend({
  reviewedBy: z.string().min(1),
});
export type PersonaTemplate = z.infer<typeof PersonaTemplateSchema>;

/**
 * What's on disk: snake_case, plus the file-naming `version`/`kind`/`reviewed_by` triad.
 * `end_after_questions` is coerced from the FAILSAFE-loaded string (every YAML scalar comes
 * through as a string, the same reason `version` stays a string for the semver parser).
 */
const RawPersonaTemplateSchema = z.strictObject({
  id: PersonaSchema.shape.id,
  name: PersonaSchema.shape.name,
  style: PersonaSchema.shape.style.min(1),
  must_not: PersonaSchema.shape.mustNot,
  end_after_questions: z.coerce.number().pipe(PersonaSchema.shape.endAfterQuestions),
  version: Semver,
  kind: z.literal('persona'),
  reviewed_by: z.string().min(1),
});

function listFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)).split(sep).join('/'))
    .filter((rel) => !rel.split('/').some((part) => part.startsWith('.')))
    .sort();
}

/** YAML with every scalar a string, so `version: 1.0` stays "1.0" instead of the number 1. */
function yaml(text: string, file: string): unknown {
  return load(text, { filename: file, schema: FAILSAFE_SCHEMA });
}

/** Reads every template in `dir`; collects every issue (never fail-fast), sorted. */
export function readPersonaTemplateDir(dir: string): {
  templates: PersonaTemplate[];
  issues: string[];
} {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return { templates: [], issues: [`${dir}: no such persona-template directory`] };
  }
  const issues: string[] = [];
  const templates: PersonaTemplate[] = [];

  for (const file of listFiles(dir)) {
    if (file === 'README.md') continue;
    const m = TEMPLATE_FILE.exec(file);
    if (m === null) {
      issues.push(`${file}: not part of the persona-template layout (<id>@<semver>.yaml)`);
      continue;
    }
    const version = m[2] as string;
    if (!Semver.safeParse(version).success) {
      issues.push(`${file}: bad semver "${version}"`);
      continue;
    }
    let doc: unknown;
    try {
      doc = yaml(readFileSync(join(dir, file), 'utf8'), file);
    } catch (e) {
      issues.push(`${file}: invalid YAML: ${(e as Error).message}`);
      continue;
    }
    const raw = RawPersonaTemplateSchema.safeParse(doc);
    if (!raw.success) {
      issues.push(`${file}: invalid persona template: ${z.prettifyError(raw.error)}`);
      continue;
    }
    if (raw.data.version !== version) {
      issues.push(
        `${file}: the file name says version ${version} but the template says ${raw.data.version}`,
      );
      continue;
    }
    templates.push({
      id: raw.data.id,
      name: raw.data.name,
      style: raw.data.style,
      mustNot: raw.data.must_not,
      endAfterQuestions: raw.data.end_after_questions,
      reviewedBy: raw.data.reviewed_by,
    });
  }
  return { templates, issues: issues.sort() };
}

/** Every issue in the directory, like `validatePromptPackDir`. */
export function validatePersonaTemplateDir(dir: string): ValidationResult {
  const { issues } = readPersonaTemplateDir(dir);
  return { ok: issues.length === 0, issues };
}
