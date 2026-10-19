// Structural checks for the platform eval suites under `evals/suites/` (task 4.0). Every case is
// loaded through 3.12's loader (so it must parse against EvalCaseSchema), then held to the
// suite-layout rules the eval author follows. Nothing here runs a case against an agent.
import { existsSync, readdirSync } from 'node:fs';
import { basename, join, sep } from 'node:path';
import { loadCasesWithFiles } from './loader.js';
import type { EvalCase } from './schema.js';

/** The literal placeholder a case carries until a named human signs it off. */
export const PENDING_REVIEWER = 'pending';

/** The nine guard folders 4.0 seeds, relative to the suites root. */
export const GUARD_FOLDERS = [
  'safety/pii',
  'safety/distress',
  'safety/moderation',
  'safety/jailbreak',
  'locked',
  'leak',
  'grounding',
  'advice',
  'persona',
] as const;

export const MIN_CASES_PER_GUARD = 30;

export interface SuiteRules {
  /** Folders (relative to the root, `/`-separated) that must each hold at least `minCases`. */
  guardFolders: readonly string[];
  minCases: number;
  /** Allowed values of `package` (the demo teacher's package names). */
  packages: readonly string[];
  /** true: a `reviewed_by: pending` case is a problem (set once the human has signed off). */
  requireReviewed: boolean;
  /** true: an empty or missing guard folder is a problem; false: it is reported as not seeded. */
  requireAllGuards: boolean;
}

export interface LoadedCase {
  /** Path relative to the suites root, `/`-separated. */
  file: string;
  evalCase: EvalCase;
}

export interface SuiteReport {
  /** Top-level suite folders that hold at least one case file, sorted. */
  suites: string[];
  cases: LoadedCase[];
  /** Case count per guard folder (0 when missing or empty). */
  guardCounts: Record<string, number>;
  /** Guard folders with no cases yet, allowed only while `requireAllGuards` is false. */
  unseeded: string[];
  /** Every rule broken, one line each; empty means the suites are valid. */
  problems: string[];
}

function hasCaseFiles(dir: string): boolean {
  return readdirSync(dir, { recursive: true, withFileTypes: true }).some(
    (e) => e.isFile() && /\.ya?ml$/.test(e.name),
  );
}

function toPosix(path: string): string {
  return path.split(sep).join('/');
}

function caseRuleProblems(file: string, c: EvalCase, rules: SuiteRules): string[] {
  const topFolder = file.split('/')[0];
  const problems: string[] = [];
  const stem = basename(file).replace(/\.ya?ml$/, '');
  if (stem !== c.id) problems.push(`${file}: file name must be "<id>.yaml" (id is "${c.id}")`);
  if (c.suite !== topFolder) {
    problems.push(`${file}: suite is "${c.suite}", expected "${topFolder}" (its top folder)`);
  }
  if (!c.id.startsWith(`${topFolder}-`)) {
    problems.push(`${file}: id "${c.id}" must start with "${topFolder}-"`);
  }
  if (!rules.packages.includes(c.package)) {
    problems.push(`${file}: package "${c.package}" is not one of: ${rules.packages.join(', ')}`);
  }
  if (rules.requireReviewed && c.reviewed_by.trim().toLowerCase() === PENDING_REVIEWER) {
    problems.push(`${file}: reviewed_by is still "${PENDING_REVIEWER}"`);
  }
  return problems;
}

/**
 * Loads every suite under `root` and checks it against `rules`. Load errors (bad YAML, a case
 * that fails the schema, a duplicate id inside one suite) are reported per suite, not thrown,
 * so one broken file doesn't hide the rest.
 */
export function validateSuites(root: string, rules: SuiteRules): SuiteReport {
  const problems: string[] = [];
  const cases: LoadedCase[] = [];
  const suites = readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && hasCaseFiles(join(root, e.name)))
    .map((e) => e.name)
    .sort();

  const failedSuites = new Set<string>();
  for (const suite of suites) {
    const dir = join(root, suite);
    let loaded: ReturnType<typeof loadCasesWithFiles>;
    try {
      loaded = loadCasesWithFiles(dir);
    } catch (error) {
      problems.push(`${suite}: ${(error as Error).message}`);
      failedSuites.add(suite);
      continue;
    }
    for (const { file, evalCase } of loaded) {
      cases.push({ file: `${suite}/${toPosix(file)}`, evalCase });
    }
  }

  const firstFileById = new Map<string, string>();
  for (const { file, evalCase } of cases) {
    problems.push(...caseRuleProblems(file, evalCase, rules));
    const earlier = firstFileById.get(evalCase.id);
    if (earlier === undefined) firstFileById.set(evalCase.id, file);
    else problems.push(`${file}: duplicate case id "${evalCase.id}" (also in ${earlier})`);
  }

  const guardCounts: Record<string, number> = {};
  const unseeded: string[] = [];
  for (const guard of rules.guardFolders) {
    const count = cases.filter((c) => c.file.startsWith(`${guard}/`)).length;
    guardCounts[guard] = count;
    if (count === 0) {
      const topFolder = guard.split('/')[0] as string;
      if (rules.requireAllGuards) {
        if (failedSuites.has(topFolder)) problems.push(`${guard}: suite failed to load`);
        else {
          const where = existsSync(join(root, guard)) ? 'has no cases' : 'is missing';
          problems.push(`${guard}: guard folder ${where}`);
        }
      } else {
        unseeded.push(guard);
      }
    } else if (count < rules.minCases) {
      problems.push(`${guard}: ${count} cases, needs at least ${rules.minCases}`);
    }
  }

  return { suites, cases, guardCounts, unseeded, problems };
}
