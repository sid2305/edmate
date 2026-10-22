// Rights declaration (task 12.3 Phase A): one global file,
// `content/legal/rights-declaration/global.md`, declared with YAML front matter (`version`,
// `reviewedBy`, `reviewedOn`) followed by the policy text. Unlike the privacy notices (task 1.7,
// one file per market), the rights declaration a teacher signs does not vary by market, so there
// is a single file, not a directory scan.
//
// The file is committed with `reviewedBy: pending` and a body marked `[PLACEHOLDER]` until a
// named person writes and signs it. This package does not wire it into
// `edmate content validate` (see task 12.3's plan); a dedicated test reads the real file
// directly, same as `realPrivacyNotices.test.ts`.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { load } from 'js-yaml';
import { z } from 'zod';
import { ContentLoadError } from './loader.js';

/** Marks a declaration body that is not the reviewed text yet. */
export const PLACEHOLDER_MARKER = '[PLACEHOLDER]';

export const RightsDeclarationFrontMatterSchema = z.strictObject({
  version: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9._-]+$/, 'letters, digits, ".", "_" or "-"'),
  /** Who signed the declaration: a name or handle, never an email (the repo is public); or `pending`. */
  reviewedBy: z
    .string()
    .max(200)
    .refine((s) => s.trim() !== '', 'must not be blank')
    .refine((s) => !/\S@\S+\.\S/.test(s), 'a name or handle, not an email address'),
  reviewedOn: z.iso.date(),
});
export type RightsDeclarationFrontMatter = z.infer<typeof RightsDeclarationFrontMatterSchema>;

export interface RightsDeclaration extends RightsDeclarationFrontMatter {
  /** The declaration text (Markdown), after the front matter. */
  body: string;
}

const isPending = (s: string): boolean => s.trim().toLowerCase() === 'pending';

/** The front matter between a leading `---` line and the next `---` line, and the body after it. */
const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

/** The rights declaration from its text; `file` names it in errors (e.g. `global.md`). */
export function parseRightsDeclaration(text: string, file = 'global.md'): RightsDeclaration {
  const m = FRONT_MATTER.exec(text);
  if (m === null) {
    throw new ContentLoadError(file, 'no front matter (the file must start with a "---" block)');
  }
  const [, yaml = '', rawBody = ''] = m;
  let doc: unknown;
  try {
    doc = load(yaml, { filename: file });
  } catch (cause) {
    throw new ContentLoadError(file, `invalid YAML: ${(cause as Error).message}`, { cause });
  }
  const parsed = RightsDeclarationFrontMatterSchema.safeParse(doc);
  if (!parsed.success) {
    throw new ContentLoadError(
      file,
      `invalid rights declaration:\n${z.prettifyError(parsed.error)}`,
      { cause: parsed.error },
    );
  }
  const body = rawBody.replace(/\r\n/g, '\n');
  if (body.trim() === '') throw new ContentLoadError(file, 'the declaration body is empty');
  return { ...parsed.data, body };
}

/** Reads and parses the rights declaration at `path` (e.g. `content/legal/rights-declaration/global.md`). */
export function readRightsDeclaration(path: string): RightsDeclaration {
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`${path}: no such rights-declaration file`);
  }
  return parseRightsDeclaration(readFileSync(path, 'utf8'), path);
}

/** True when a person has signed `doc` and its body is no longer marked as a placeholder. */
export function rightsDeclarationSigned(doc: RightsDeclaration): boolean {
  return !isPending(doc.reviewedBy) && !doc.body.includes(PLACEHOLDER_MARKER);
}
