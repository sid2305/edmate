// Privacy notices (task 1.7, plan Design 8): `content/legal/privacy-notice/<market>.md`, one per
// locale-pack market plus the default `global.md`. Each file starts with YAML front matter
// (`version`, `market`, `reviewedBy`, `reviewedOn`) and the notice text follows. The accepted
// `version` is what the identity store records in `consents`.
//
// A notice is committed with `reviewedBy: pending` and a body marked `[PLACEHOLDER]` until a named
// person writes and signs it. `edmate content validate` fails on either, so the gap stays visible.
// The schema lives here, not in @edmate/contracts: nothing outside the web app and this package
// reads it.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { z } from 'zod';
import { ContentLoadError } from './loader.js';
import { DEFAULT_LOCALE_MARKET } from './localeRules.js';

/** Marks a notice body that is not the reviewed text yet; validation fails while it is there. */
export const PLACEHOLDER_MARKER = '[PLACEHOLDER]';

/** `<market>.md`, market as in a locale pack: an ISO 3166-1 alpha-2 code or `global`. */
const NOTICE_FILE = /^([A-Z]{2}|global)\.md$/;

export const PrivacyNoticeFrontMatterSchema = z.strictObject({
  /** Stored in `consents.version` (at most 64 characters there). */
  version: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9._-]+$/, 'letters, digits, ".", "_" or "-"'),
  market: z.string().regex(/^(?:[A-Z]{2}|global)$/, 'ISO 3166-1 alpha-2 code or "global"'),
  /** Who signed the notice: a name or handle, never an email (the repo is public); or `pending`. */
  reviewedBy: z
    .string()
    .max(200)
    .refine((s) => s.trim() !== '', 'must not be blank')
    .refine((s) => !/\S@\S+\.\S/.test(s), 'a name or handle, not an email address'),
  reviewedOn: z.iso.date(),
});
export type PrivacyNoticeFrontMatter = z.infer<typeof PrivacyNoticeFrontMatterSchema>;

export interface PrivacyNotice extends PrivacyNoticeFrontMatter {
  /** The notice text (Markdown), after the front matter. */
  body: string;
}

export type PrivacyNotices = ReadonlyMap<string, PrivacyNotice>;

export class PrivacyNoticeError extends Error {
  override readonly name = 'PrivacyNoticeError';
}

const isPending = (s: string): boolean => s.trim().toLowerCase() === 'pending';

/** The front matter between a leading `---` line and the next `---` line, and the body after it. */
const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

/** One notice from its text; `file` (`<market>.md`) names it in errors and must match its market. */
export function parsePrivacyNotice(text: string, file: string): PrivacyNotice {
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
  const parsed = PrivacyNoticeFrontMatterSchema.safeParse(doc);
  if (!parsed.success) {
    throw new ContentLoadError(file, `invalid privacy notice:\n${z.prettifyError(parsed.error)}`, {
      cause: parsed.error,
    });
  }
  const expected = file.replace(/\.md$/, '');
  if (parsed.data.market !== expected) {
    throw new ContentLoadError(
      file,
      `market "${parsed.data.market}" does not match the file name (expected "${expected}")`,
    );
  }
  const body = rawBody.replace(/\r\n/g, '\n');
  if (body.trim() === '') throw new ContentLoadError(file, 'the notice body is empty');
  return { ...parsed.data, body };
}

/** Non-hidden top-level entries of `dir`, sorted by code unit (never readdir order). */
function topLevel(dir: string): { name: string; isFile: boolean }[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => !e.name.startsWith('.'))
    .map((e) => ({ name: e.name, isFile: e.isFile() }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** True when `dir` has no `course.yaml` and at least one top-level file named like a notice. */
export function isPrivacyNoticesDir(dir: string): boolean {
  if (existsSync(join(dir, 'course.yaml'))) return false;
  return topLevel(dir).some((e) => e.isFile && NOTICE_FILE.test(e.name));
}

/** Every notice in `dir`, keyed by market, plus one error per bad file or unexpected entry. */
export function readPrivacyNoticesDir(dir: string): {
  notices: Map<string, PrivacyNotice>;
  errors: ContentLoadError[];
} {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(`${dir}: no such privacy-notice directory`);
  }
  const notices = new Map<string, PrivacyNotice>();
  const errors: ContentLoadError[] = [];
  for (const { name, isFile } of topLevel(dir)) {
    if (!isFile || !NOTICE_FILE.test(name)) {
      errors.push(
        new ContentLoadError(
          name,
          'unexpected entry (a privacy notice is a file named <market>.md, e.g. IN.md or global.md)',
        ),
      );
      continue;
    }
    try {
      const notice = parsePrivacyNotice(readFileSync(join(dir, name), 'utf8'), name);
      notices.set(notice.market, notice);
    } catch (e) {
      errors.push(e as ContentLoadError);
    }
  }
  return { notices, errors };
}

/** True when a person has signed `notice` and its body is no longer marked as a placeholder. */
export function noticeSigned(notice: PrivacyNotice): boolean {
  return !isPending(notice.reviewedBy) && !notice.body.includes(PLACEHOLDER_MARKER);
}

/** Validation issues: the default notice is present; each notice is signed and not a placeholder. */
export function checkPrivacyNotices(notices: PrivacyNotices): string[] {
  const issues: string[] = [];
  if (!notices.has(DEFAULT_LOCALE_MARKET)) {
    issues.push(
      `${DEFAULT_LOCALE_MARKET}.md: missing; the default notice is required (it serves every market without one)`,
    );
  }
  for (const n of notices.values()) {
    if (isPending(n.reviewedBy)) {
      issues.push(`${n.market}.md: reviewedBy is "pending"; a named person must sign this notice`);
    }
    if (n.body.includes(PLACEHOLDER_MARKER)) {
      issues.push(
        `${n.market}.md: the body is still marked ${PLACEHOLDER_MARKER}; replace it with the reviewed notice`,
      );
    }
  }
  return issues;
}

/** One issue per locale-pack market that has no notice of its own. */
export function noticeCoverageIssues(
  packMarkets: Iterable<string>,
  notices: PrivacyNotices,
): string[] {
  return [...packMarkets]
    .filter((m) => !notices.has(m))
    .map((m) => `${m}.md: missing; every locale-pack market needs its own privacy notice`);
}

/** The notice for `market`, else the default notice; throws when there is no default. */
export function pickPrivacyNotice(market: string, notices: PrivacyNotices): PrivacyNotice {
  const notice = notices.get(market) ?? notices.get(DEFAULT_LOCALE_MARKET);
  if (notice === undefined) {
    throw new PrivacyNoticeError(
      `no privacy notice for market "${market}": the default notice (${DEFAULT_LOCALE_MARKET}.md) is missing`,
    );
  }
  return notice;
}
