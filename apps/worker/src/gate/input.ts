// The gate input (task 8.7 Phase B): maps a publish run's basis (the candidate agent version and the
// pinned package versions) to packages/evals' `GateInput`. Fails closed: a missing suites dir, zero
// platform cases, no packages or a missing pinned package throws `GateUnavailableError`; a broken
// case file or an over-cap teacher eval case list throws as is. Nothing is ever skipped silently.
import { statSync } from 'node:fs';
import type { ModelGateway, PackageConfig } from '@edmate/contracts';
import type { Repositories } from '@edmate/db';
import {
  agentPackagesFromConfigs,
  answerableFromTeacherEvalCases,
  defaultGateDeadlineMs,
  loadCasesFromDir,
  memoryRecorder,
  NoCasesFoundError,
  type ChangeKind,
  type EvalAgent,
  type EvalCase,
  type GateInput,
  type JudgeModelConfig,
} from '@edmate/evals';

/** What a publish run pins: Phase A stores this as `eval_runs.basis` (the gate reads only these). */
export interface GateBasis {
  teacherId: string;
  agentId: string;
  /** The candidate agent version the run cut. */
  agentVersion: number;
  /** Every package of the agent, at the version the run snapshotted. */
  packageVersions: readonly { packageId: string; version: number }[];
}

export type GateUnavailableReason =
  | 'no_packages'
  | 'package_missing'
  | 'suites_missing'
  | 'no_platform_cases'
  | 'content_missing'
  | 'dev_model'
  | 'provider_key'
  | 'judge_model'
  | 'judge_provider';

/** The gate cannot run as configured; the run ends `error` with code `gate_unavailable`. */
export class GateUnavailableError extends Error {
  override readonly name = 'GateUnavailableError';
  readonly code = 'gate_unavailable';

  constructor(readonly reason: GateUnavailableReason) {
    super(`gate_unavailable: ${reason}`);
  }
}

export interface BuildGateInputOptions {
  repos: Pick<Repositories, 'packageVersions' | 'teacherEvalCases'>;
  basis: GateBasis;
  changes: readonly ChangeKind[];
  /** The platform suites (`EDMATE_EVAL_SUITES_DIR`, `evals/suites` in the repo). */
  suitesDir: string;
  /** The gate agent for one pinned candidate package (see `gateAgentFactory` in agent.ts). */
  agentFor(pkg: PackageConfig): EvalAgent;
  judgeGateway: ModelGateway;
  judgeModel: JudgeModelConfig;
  concurrency?: number;
  styleSampleSeed?: string;
  now?: () => number;
}

const FREE_LABEL = 'free';
const PAID_LABEL = 'paid';

/**
 * The candidate package a case's `package` names: the package with that id, else for a platform
 * suite's `free`/`paid` label the widest package of that tier (free = price 0), ties by id.
 * Undefined when nothing fits.
 */
export function packageForLabel(
  packages: readonly PackageConfig[],
  label: string,
): PackageConfig | undefined {
  const exact = packages.find((p) => p.id === label);
  if (exact !== undefined) return exact;
  if (label !== FREE_LABEL && label !== PAID_LABEL) return undefined;
  const wantFree = label === FREE_LABEL;
  return packages
    .filter((p) => (p.pricePerMonth.amountMinor === 0) === wantFree)
    .sort((a, b) => b.moduleIds.length - a.moduleIds.length || a.id.localeCompare(b.id))[0];
}

/** Every case for a label no candidate package fits fails, by name: never a silent pass. */
function noPackageAgent(label: string): EvalAgent {
  return {
    reply: () => Promise.reject(new Error(`gate: no candidate package for "${label}"`)),
  };
}

function loadPlatformCases(suitesDir: string): EvalCase[] {
  let isDir: boolean;
  try {
    isDir = statSync(suitesDir).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) throw new GateUnavailableError('suites_missing');
  let cases: EvalCase[];
  try {
    cases = loadCasesFromDir(suitesDir);
  } catch (error) {
    if (error instanceof NoCasesFoundError) throw new GateUnavailableError('no_platform_cases');
    throw error;
  }
  if (cases.length === 0) throw new GateUnavailableError('no_platform_cases');
  return cases;
}

async function loadPackages(
  repos: BuildGateInputOptions['repos'],
  basis: GateBasis,
): Promise<PackageConfig[]> {
  if (basis.packageVersions.length === 0) throw new GateUnavailableError('no_packages');
  const scope = { teacherId: basis.teacherId };
  const packages = await Promise.all(
    basis.packageVersions.map((ref) => repos.packageVersions.get(scope, ref)),
  );
  return packages.map((pkg) => {
    if (pkg === null || pkg.agentId !== basis.agentId) {
      throw new GateUnavailableError('package_missing');
    }
    return pkg;
  });
}

export async function buildGateInput(opts: BuildGateInputOptions): Promise<GateInput> {
  const { basis } = opts;
  const packages = await loadPackages(opts.repos, basis);
  const platformCases = loadPlatformCases(opts.suitesDir);
  const rows = await opts.repos.teacherEvalCases.listForTeacher({ teacherId: basis.teacherId });
  return {
    changes: [...opts.changes],
    platformCases,
    perAgent: {
      teacherId: basis.teacherId,
      agentId: basis.agentId,
      packages: agentPackagesFromConfigs(
        packages,
        (c) => `package_versions#${c.id}@${c.version}`,
      ),
      answerable: answerableFromTeacherEvalCases(rows),
      // No out-of-course source exists for a real teacher yet (handoff decision).
      outOfCourse: [],
    },
    agentFor: (label) => {
      const pkg = packageForLabel(packages, label);
      return pkg === undefined ? noPackageAgent(label) : opts.agentFor(pkg);
    },
    judgeGateway: opts.judgeGateway,
    judgeModel: opts.judgeModel,
    // Live run: every reply and verdict is produced now; the in-memory store is dropped after.
    recorder: memoryRecorder('record'),
    deadlineMs: defaultGateDeadlineMs(opts.changes),
    ...(opts.concurrency === undefined ? {} : { concurrency: opts.concurrency }),
    ...(opts.styleSampleSeed === undefined ? {} : { styleSampleSeed: opts.styleSampleSeed }),
    ...(opts.now === undefined ? {} : { now: opts.now }),
  };
}
