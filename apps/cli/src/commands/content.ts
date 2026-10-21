// `edmate content validate [dir]` (task 1.8): a thin wrapper over @edmate/content. Reads
// local files only; no network, no database.
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { validateContentDir } from '@edmate/content';
import type { CliIo } from '../cli.js';

export const DEFAULT_CONTENT_DIR = 'content/demo-teacher';

export const CONTENT_USAGE = `Usage: edmate content validate [dir]

Validates content under <dir> (default: ${DEFAULT_CONTENT_DIR}) against its schemas
and content rules (licence coverage, reviewer, counts, references). Exits 1 and
prints every issue found if any file or rule fails.
<dir> may also be a locale-packs directory (e.g. content/locales): each
<market>.yaml is checked against the LocalePack schema, and helplines and
compliance must be signed off by a person (not "pending"); PII patterns must
compile with the flags gu and pass the safe-regex check.
<dir> may also be a privacy-notice directory (e.g. content/legal/privacy-notice):
each <market>.md needs front matter (version, market, reviewedBy, reviewedOn),
a default global.md, a person's sign-off (not "pending") and no [PLACEHOLDER].
A relative <dir> is looked up under the current directory, then under the
workspace root (the folder holding pnpm-workspace.yaml).
`;

export interface ContentCommandDeps {
  cwd: string;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function workspaceRoot(from: string): string | undefined {
  for (let dir = from; ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    if (dirname(dir) === dir) return undefined;
  }
}

/** `arg` under cwd; if that does not exist and `arg` is relative, under the workspace root. */
function resolveDir(cwd: string, arg: string): string {
  const local = resolve(cwd, arg);
  if (existsSync(local) || isAbsolute(arg)) return local;
  const root = workspaceRoot(cwd);
  const fromRoot = root === undefined ? undefined : resolve(root, arg);
  return fromRoot !== undefined && existsSync(fromRoot) ? fromRoot : local;
}

/** Each issue as a bullet; continuation lines (zod's pretty errors) indented under it. */
function formatIssues(issues: readonly string[]): string {
  return issues.map((i) => `  - ${i.split('\n').join('\n    ')}\n`).join('');
}

export function runContentCommand(
  args: readonly string[],
  io: CliIo,
  deps: ContentCommandDeps,
): number {
  const [sub, ...rest] = args;
  if (sub === '-h' || sub === '--help') {
    io.stdout(CONTENT_USAGE);
    return 0;
  }
  if (sub !== 'validate') {
    const why = sub === undefined ? 'expected a subcommand' : `unknown subcommand '${sub}'`;
    io.stderr(`edmate content: ${why}\n\n${CONTENT_USAGE}`);
    return 1;
  }
  let parsed;
  try {
    parsed = parseArgs({
      args: rest,
      allowPositionals: true,
      strict: true,
      options: { help: { type: 'boolean', short: 'h', default: false } },
    });
  } catch (e) {
    io.stderr(`edmate content validate: ${message(e)}\n\n${CONTENT_USAGE}`);
    return 1;
  }
  if (parsed.values.help) {
    io.stdout(CONTENT_USAGE);
    return 0;
  }
  if (parsed.positionals.length > 1) {
    io.stderr(`edmate content validate: expected at most one directory\n\n${CONTENT_USAGE}`);
    return 1;
  }
  const dir = resolveDir(deps.cwd, parsed.positionals[0] ?? DEFAULT_CONTENT_DIR);
  const { ok, issues } = validateContentDir(dir);
  if (ok) {
    io.stdout(`edmate content validate: ${dir}: ok\n`);
    return 0;
  }
  const n = issues.length;
  io.stderr(
    `edmate content validate: ${dir}: ${n} ${n === 1 ? 'issue' : 'issues'}\n${formatIssues(issues)}`,
  );
  return 1;
}
