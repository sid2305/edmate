// The publish-gate processor (task 8.7 Phase C). One job names one run (`edmate-gate`, attempts 1).
// It re-reads the run, marks it running, builds the gate input for the run's basis, runs the
// quality gate, stores one result per case and then either publishes
// (`publish.goLive`, one transaction, called only on a passing gate) or finishes the run `failed`.
//
// Fails closed and never silently: every error after the run is marked running is logged by its
// code (ids only, never case text or a model reply) and ends the run `error` with that code;
// nothing publishes. A job for a run that is missing or no longer `queued` is a logged no-op, so a
// redelivered job never runs a gate twice.
import {
  buildScorecard,
  DEADLINE_NOT_RUN,
  generatePerAgentSuite,
  runQualityGate,
  selectGateCases,
  type GateInput,
  type GateResult,
} from '@edmate/evals';
import {
  type GateCaseResult,
  type GateRunRow,
  type GateRunSummary,
  GATE_RESULTS_MAX,
  PublishRefusedError,
  type Repositories,
  RepositoryError,
} from '@edmate/db';
import { GateJobSchema } from '@edmate/queue';
import { PermanentJobError } from '../commit/processors.js';
import { describeError, type Log } from '../log.js';
import { GateUnavailableError, type GateBasis } from './input.js';
import type { GateUsageTotals } from './ports.js';

/** A job as the processor sees it (BullMQ's Job has more). */
export interface GateJobLike {
  readonly id?: string | undefined;
  readonly name: string;
  readonly data: unknown;
}

/** `skipped`: the run was missing or not `queued` (a redelivery); nothing was done. */
export type GateOutcome = 'passed' | 'failed' | 'error' | 'skipped';

/** What a run needs to be gated: its `GateInput` and the run's usage meter. */
export interface GatePreparation {
  input: GateInput;
  usage(): GateUsageTotals;
}

/** Builds the gate for one run; throws `GateUnavailableError` when the gate can't run. */
export type PrepareGate = (run: GateRunRow, basis: GateBasis) => Promise<GatePreparation>;

export interface GateProcessorDeps {
  repos: Pick<Repositories, 'publish'>;
  prepare: PrepareGate;
  /** `runQualityGate` (tests: a scripted gate). */
  runGate?: (input: GateInput) => Promise<GateResult>;
  log: Log;
}

/** Longest teacher eval-case question stored with an agent-origin result (db limit). */
const QUESTION_MAX = 2000;
/** Longest check name and most check names stored per case (db limits). */
const CHECK_NAME_MAX = 200;
const CHECKS_MAX = 50;

/** The gate's view of a run: the teacher from the job, the rest from the run's stored basis. */
export function basisOf(teacherId: string, run: GateRunRow): GateBasis {
  return {
    teacherId,
    agentId: run.agentId,
    agentVersion: run.basis.agentVersion,
    packageVersions: Object.entries(run.basis.packageVersions)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([packageId, version]) => ({ packageId, version })),
  };
}

/** The gate's results do not line up with the cases it was given: never stored, never published. */
export class GateResultMismatchError extends Error {
  override readonly name = 'GateResultMismatchError';
  readonly code = 'result_mismatch';
}

/** `runGate` resolved without a result: a defensive guard against a misbehaving dependency. */
export class GateResultMissingError extends Error {
  override readonly name = 'GateResultMissingError';
  readonly code = 'gate_result_missing';
}

/** No changes to gate: never style-only (nothing changed is not "only the style card changed"). */
export class GateChangesEmptyError extends Error {
  override readonly name = 'GateChangesEmptyError';
  readonly code = 'no_changes';
}

/**
 * One stored result per case. The gate's results are in scope order, so the scope is rebuilt from
 * the same input (`selectGateCases` is pure) to learn each case's origin and group; any mismatch
 * throws. Only check names are kept (never a judge's reason or a model reply); an agent-origin
 * case keeps its question, which is the teacher's own eval case.
 */
export function caseResults(input: GateInput, gate: GateResult): GateCaseResult[] {
  if (input.changes.length === 0) throw new GateChangesEmptyError();
  const styleOnly = input.changes.every((c) => c === 'style_card');
  const scope = selectGateCases({
    changes: input.changes,
    platformCases: input.platformCases,
    perAgentCases: styleOnly ? undefined : generatePerAgentSuite(input.perAgent),
    // Only changes which groups must be non-empty, never which cases run.
    requireAgentLocked: false,
    styleSampleSeed: input.styleSampleSeed,
  });
  if (scope.cases.length !== gate.results.length) throw new GateResultMismatchError();
  return gate.results.map((r, i) => {
    const scoped = scope.cases[i];
    if (scoped === undefined || scoped.evalCase.id !== r.id) throw new GateResultMismatchError();
    const failedChecks = r.turns
      .flatMap((t) => t.checks.filter((c) => !c.pass).map((c) => c.name.slice(0, CHECK_NAME_MAX)))
      .slice(0, CHECKS_MAX);
    const errorCode =
      r.error === undefined ? undefined : r.error === DEADLINE_NOT_RUN ? 'not_run' : 'case_error';
    const question = scoped.evalCase.turns[0]?.student.slice(0, QUESTION_MAX);
    return {
      caseId: r.id,
      passed: r.pass,
      details: {
        origin: scoped.origin,
        group: scoped.group,
        suite: r.suite,
        failedChecks,
        ...(errorCode === undefined ? {} : { errorCode }),
        ...(scoped.origin === 'agent' && question ? { question } : {}),
      },
    };
  });
}

/** Share of cases passed, 0 when the gate ran none. */
export function passRateOf(gate: GateResult): number {
  if (gate.results.length === 0) return 0;
  return gate.results.filter((r) => r.pass).length / gate.results.length;
}

/** The run summary: gate groups, the gate's stats, and the run's model spend. */
export function runSummary(gate: GateResult, usage: GateUsageTotals | undefined): GateRunSummary {
  return {
    groups: gate.groups.map((g) => ({
      origin: g.origin,
      group: g.group,
      total: g.total,
      passed: g.passed,
      minPercent: g.minPercent,
      pass: g.pass,
      ...(g.pass === false ? { reason: g.reason } : {}),
    })),
    stats: {
      ...gate.stats,
      ...(usage === undefined
        ? {}
        : { modelCalls: usage.calls, unmeteredCalls: usage.unmetered }),
    },
    ...(usage === undefined ? {} : { costMicroUsd: Math.max(0, Math.round(usage.costMicroUsd)) }),
  };
}

/** A fixed error code word for a run that ended `error` (never an id or a message). */
export function errorCodeOf(error: unknown): string {
  if (error instanceof GateUnavailableError) return error.code;
  if (error instanceof GateResultMismatchError) return error.code;
  if (error instanceof GateResultMissingError) return error.code;
  if (error instanceof GateChangesEmptyError) return error.code;
  if (error instanceof PublishRefusedError) return error.reason;
  if (error instanceof RepositoryError) {
    return error.kind === 'scope' ? 'not_verified' : `repository_${error.kind}`;
  }
  return 'gate_error';
}

async function storeResults(
  repos: GateProcessorDeps['repos'],
  scope: { teacherId: string },
  runId: string,
  results: readonly GateCaseResult[],
): Promise<void> {
  for (let i = 0; i < results.length; i += GATE_RESULTS_MAX) {
    await repos.publish.recordResults(scope, {
      runId,
      results: results.slice(i, i + GATE_RESULTS_MAX),
    });
  }
}

export function gateProcessor(deps: GateProcessorDeps): (job: GateJobLike) => Promise<GateOutcome> {
  const runGate = deps.runGate ?? runQualityGate;
  const { log } = deps;
  return async (job) => {
    const parsed = GateJobSchema.safeParse(job.data);
    if (!parsed.success) {
      log({ level: 'error', event: 'gate.invalid_job', jobId: job.id });
      throw new PermanentJobError(`${job.name}: invalid job payload`);
    }
    const { runId, teacherId } = parsed.data;
    const scope = { teacherId };
    const ids = { runId, teacherId };

    let usage: (() => GateUsageTotals) | undefined;
    try {
      const run = await deps.repos.publish.getRun(scope, runId);
      if (run === null || run.status !== 'queued') {
        log({ level: 'info', event: 'gate.skipped', ...ids, status: run?.status ?? 'missing' });
        return 'skipped';
      }
      if (!(await deps.repos.publish.markRunning(scope, runId))) {
        log({ level: 'info', event: 'gate.skipped', ...ids, status: 'not_queued' });
        return 'skipped';
      }
      log({ level: 'info', event: 'gate.started', ...ids, changes: run.changes });
      const prepared = await deps.prepare(run, basisOf(teacherId, run));
      usage = prepared.usage;
      // The gate step's own return value (`g`) flows straight into the publish-or-fail decision
      // below as a normal, fully-typed local: no mutable closure variable, so no cast is needed to
      // read it back. `runGate` is an injected dependency; a guard (not a cast) fails closed if it
      // ever resolves without a result instead of trusting its declared return type at runtime.
      const g = await runGate(prepared.input);
      if (g === undefined) throw new GateResultMissingError();
      await storeResults(deps.repos, scope, runId, caseResults(prepared.input, g));
      if (g.pass === true) {
        const value = await deps.repos.publish.goLive(scope, {
          runId,
          passRate: passRateOf(g),
          summary: runSummary(g, prepared.usage()),
          scorecard: buildScorecard(g),
        });
        log({ level: 'info', event: 'gate.published', ...ids, agentVersion: value.agentVersion });
        return 'passed';
      }
      await deps.repos.publish.finishRun(scope, {
        runId,
        status: 'failed',
        passRate: passRateOf(g),
        summary: runSummary(g, prepared.usage()),
        scorecard: buildScorecard(g),
      });
      log({
        level: 'info',
        event: 'gate.failed',
        ...ids,
        failedCases: g.failedCaseIds.length,
      });
      return 'failed';
    } catch (error) {
      const errorCode = errorCodeOf(error);
      log({
        level: 'error',
        event: 'gate.error',
        ...ids,
        errorCode,
        ...(error instanceof GateUnavailableError ? { reason: error.reason } : {}),
        error: describeError(error),
      });
      try {
        await deps.repos.publish.finishRun(scope, {
          runId,
          status: 'error',
          summary: { groups: [], errorCode, ...costOf(usage) },
        });
      } catch (finishError) {
        // The run stays open until the next startRun closes it as stale; the job fails loudly.
        log({ level: 'error', event: 'gate.finish_failed', ...ids, error: describeError(finishError) });
        throw finishError;
      }
      return 'error';
    }
  };
}

function costOf(usage: (() => GateUsageTotals) | undefined): { costMicroUsd?: number } {
  if (usage === undefined) return {};
  return { costMicroUsd: Math.max(0, Math.round(usage().costMicroUsd)) };
}
