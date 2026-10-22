// Reads a prompt-pack directory (task 3.6) for the composition root, which passes the library to
// the harness as `deps.promptPacks`. File IO lives here, outside the pure harness; the harness
// validates the packs themselves (required packs, placeholders, frame sections).
//
// Layout (flat; also used by 3.11 in content/prompt-packs/):
//   set@<semver>.yaml   manifest: version, reviewed_by, packs: { <name>: <semver>, ... }
//   <name>@<semver>.md  `---` YAML front matter (name, version, kind, reviewed_by), then the body
// A README.md and hidden files are ignored; anything else is an issue. Pack files no manifest
// refers to are allowed (older versions stay on disk).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { AgentConfigSchema } from '@edmate/contracts';
import {
  createPromptPackLibrary,
  parsePromptPackSet,
  PromptPackError,
  type PromptPackLibrary,
  type PromptPackSet,
  type RawPromptPackSet,
} from '@edmate/harness';
import { FAILSAFE_SCHEMA, load } from 'js-yaml';
import { z } from 'zod';
import { comparePersonaVersions } from './personaTemplates.js';
import type { ValidationResult } from './validate.js';

const SET_FILE = /^set@(.+)\.yaml$/;
const PACK_FILE = /^([a-z_]+)@(.+)\.md$/;
const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const Semver = AgentConfigSchema.shape.promptPackVersion;

const ManifestSchema = z.strictObject({
  version: z.string(),
  reviewed_by: z.string().min(1),
  packs: z.record(z.string(), z.string()),
});

const FrontMatterSchema = z.strictObject({
  name: z.string(),
  version: z.string(),
  kind: z.string(),
  reviewed_by: z.string(),
});

interface PackFile {
  kind: string;
  reviewedBy: string;
  body: string;
}

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

/** Reads every set in `dir`; collects every issue (never fail-fast), sorted. */
export function readPromptPackDir(dir: string): { sets: PromptPackSet[]; issues: string[] } {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return { sets: [], issues: [`${dir}: no such prompt-pack directory`] };
  }
  const issues: string[] = [];
  const packs = new Map<string, PackFile>();
  const setFiles: { file: string; version: string }[] = [];

  for (const file of listFiles(dir)) {
    if (file === 'README.md') continue;
    const set = SET_FILE.exec(file);
    const pack = PACK_FILE.exec(file);
    const version = set?.[1] ?? pack?.[2];
    if (version === undefined) {
      issues.push(
        `${file}: not part of the prompt-pack layout (set@<semver>.yaml or <name>@<semver>.md)`,
      );
      continue;
    }
    if (!Semver.safeParse(version).success) {
      issues.push(`${file}: bad semver "${version}"`);
      continue;
    }
    if (set !== null) {
      setFiles.push({ file, version });
      continue;
    }
    const name = pack?.[1] as string;
    const p = readPack(dir, file, issues);
    if (p === undefined) continue;
    if (p.name !== name || p.version !== version) {
      issues.push(
        `${file}: the file name says ${name}@${version} but the front matter says ${p.name}@${p.version}`,
      );
    }
    packs.set(`${name}@${version}`, p.pack);
  }

  if (setFiles.length === 0) issues.push('no set@<semver>.yaml manifest');
  const sets: PromptPackSet[] = [];
  for (const s of setFiles) {
    const parsed = readSet(dir, s.file, s.version, packs, issues);
    if (parsed !== undefined) sets.push(parsed);
  }
  try {
    createPromptPackLibrary(sets);
  } catch (e) {
    issues.push((e as Error).message);
  }
  return { sets, issues: issues.sort() };
}

function readPack(
  dir: string,
  file: string,
  issues: string[],
): { name: string; version: string; pack: PackFile } | undefined {
  const text = readFileSync(join(dir, file), 'utf8');
  const m = FRONT_MATTER.exec(text);
  if (m === null) {
    issues.push(`${file}: no front matter (the file must start with a --- block)`);
    return undefined;
  }
  let fm: z.infer<typeof FrontMatterSchema>;
  try {
    fm = FrontMatterSchema.parse(yaml(m[1] as string, file));
  } catch (e) {
    const detail = e instanceof z.ZodError ? z.prettifyError(e) : (e as Error).message;
    issues.push(`${file}: invalid front matter: ${detail}`);
    return undefined;
  }
  return {
    name: fm.name,
    version: fm.version,
    pack: { kind: fm.kind, reviewedBy: fm.reviewed_by, body: text.slice(m[0].length) },
  };
}

function readSet(
  dir: string,
  file: string,
  version: string,
  packs: ReadonlyMap<string, PackFile>,
  issues: string[],
): PromptPackSet | undefined {
  let doc: unknown;
  try {
    doc = yaml(readFileSync(join(dir, file), 'utf8'), file);
  } catch (e) {
    issues.push(`${file}: invalid YAML: ${(e as Error).message}`);
    return undefined;
  }
  const m = ManifestSchema.safeParse(doc);
  if (!m.success) {
    issues.push(`${file}: invalid manifest: ${z.prettifyError(m.error)}`);
    return undefined;
  }
  if (m.data.version !== version) {
    issues.push(`${file}: the file name says ${version} but the manifest says ${m.data.version}`);
    return undefined;
  }
  const raw: RawPromptPackSet = { version, reviewedBy: m.data.reviewed_by, packs: {} };
  let missing = false;
  for (const [name, v] of Object.entries(m.data.packs)) {
    const p = packs.get(`${name}@${v}`);
    if (p === undefined) {
      issues.push(`${file}: pack ${name}@${v} not found (no ${name}@${v}.md)`);
      missing = true;
      continue;
    }
    raw.packs[name] = {
      version: v,
      kind: p.kind as RawPromptPackSet['packs'][string]['kind'],
      reviewedBy: p.reviewedBy,
      body: p.body,
    };
  }
  if (missing) return undefined;
  try {
    return parsePromptPackSet(raw);
  } catch (e) {
    if (!(e instanceof PromptPackError)) throw e;
    for (const i of e.issues) issues.push(locate(file, m.data.packs, i.path, i.message));
    return undefined;
  }
}

/** Points a harness issue (`packs.coach.body`) at the pack's own file when there is one. */
function locate(
  setFile: string,
  manifest: Readonly<Record<string, string>>,
  path: string,
  message: string,
): string {
  const [, name, rest] = /^packs\.([^.]+)(?:\.(.+))?$/.exec(path) ?? [];
  const v = name === undefined ? undefined : manifest[name];
  if (name === undefined || v === undefined) return `${setFile}: ${path}: ${message}`;
  return `${name}@${v}.md: ${rest === undefined ? '' : `${rest}: `}${message}`;
}

/** Every issue in the directory, like `validateContentDir`. */
export function validatePromptPackDir(dir: string): ValidationResult {
  const { issues } = readPromptPackDir(dir);
  return { ok: issues.length === 0, issues };
}

const signed = (reviewedBy: string): boolean => reviewedBy.trim().toLowerCase() !== 'pending';

/**
 * A set is signed when its manifest and every pack it pins carry a reviewer (task 5.8a, lead
 * answer 1): a signed manifest never lets a pending pack go live. `pending` is matched trimmed
 * and case-insensitively, like the persona templates.
 */
export function isSignedSet(set: Readonly<PromptPackSet>): boolean {
  return signed(set.reviewedBy) && Object.values(set.packs).every((p) => signed(p.reviewedBy));
}

/**
 * The highest-precedence signed set (semver; build metadata ignored, a release above its
 * prereleases), or `undefined` when none is signed. The CLI and the seed pin this at run time,
 * so a newly signed set goes live with no code change.
 */
export function newestSignedSet(library: PromptPackLibrary): PromptPackSet | undefined {
  let best: PromptPackSet | undefined;
  for (const set of library.values()) {
    if (!isSignedSet(set)) continue;
    if (best === undefined || comparePersonaVersions(set.version, best.version) > 0) best = set;
  }
  return best;
}

/** The library for `deps.promptPacks`; throws listing every issue if the directory has any. */
export function readPromptPackLibrary(dir: string): PromptPackLibrary {
  const { sets, issues } = readPromptPackDir(dir);
  if (issues.length > 0) throw new Error(`invalid prompt packs in ${dir}:\n${issues.join('\n')}`);
  return createPromptPackLibrary(sets);
}
