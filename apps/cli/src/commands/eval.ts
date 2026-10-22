// `edmate eval <dir> [--fixtures <dir>] [--record] [--report <file>]` (task 3.12).
// Replay (the default) is fully offline: agent replies and judge verdicts come from recorded
// fixtures, and a missing fixture fails the run. --record makes live calls and rewrites them.
// `--models <file>` (task 7.6 Phase B) sweeps every configured model over every suite instead:
// it always implies --record (a sweep is, by definition, a live run) and never touches
// --fixtures/--report's recorded-fixture replay path.
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { ModelGateway, ModelPolicy } from '@edmate/contracts';
import {
  fileRecorder,
  loadCasesFromDir,
  loadLiveModels,
  memoryRecorder,
  NoCasesFoundError,
  resolveJudgeModel,
  runSuite,
  toJsonReport,
  toSummary,
  type EvalAgent,
  type JudgeModelConfig,
  type ReportCost,
} from '@edmate/evals';
import { memoryUsageMeter, type MemoryUsageMeter } from '@edmate/harness/testing';
import type { CliIo } from '../cli.js';
import { createJudgeGateway, type Env } from './judgeGateway.js';

export const EVAL_USAGE = `Usage: edmate eval <dir> [--fixtures <dir>] [--record] [--report <file>]
       edmate eval <dir> --models <file> [--report-dir <dir>]

Runs every .yaml/.yml eval case under <dir>.
  --fixtures <dir>    recorded agent replies and judge outputs (default: evals/fixtures)
  --record            call the agent and the judge live and rewrite the fixtures
                      (needs EDMATE_JUDGE_MODEL="<provider>:<model>" and that provider's key)
  --report <file>     also write a JSON report
Without --record nothing is called live; a missing fixture fails the run.
--record runs the real turn pipeline (task 7.6) over the demo-teacher content; it needs
ANTHROPIC_API_KEY (or EDMATE_ANTHROPIC_API_KEY) and EDMATE_JUDGE_MODEL, neither logged.

  --models <file>     sweep every model in <file> (evals/live-models.yaml's format) over every
                      suite under <dir> (a suite directory, or a directory of suite directories);
                      always live (implies --record; an error if given without it); rejected
                      together with --fixtures or --report (the sweep has its own --report-dir
                      and never touches the single-agent fixtures/report path)
  --report-dir <dir>  where the sweep writes one JSON report per (model, suite), plus a combined
                      summary.json (default: evals/reports/live)

An --models entry with provider: openai-compatible needs EDMATE_OPENAI_COMPATIBLE_API_KEY (its
baseURL comes from the entry itself, never an env var); neither key is ever logged.
`;

export interface EvalCommandDeps {
  agent: EvalAgent;
  env: Env;
  cwd: string;
  makeJudgeGateway?: (config: JudgeModelConfig, env: Env) => Promise<ModelGateway>;
  now?: () => Date;
  /**
   * Builds a fresh pipeline-backed agent for one (model, suite) run of the `--models` sweep
   * (task 7.6 Phase B). Absent: `--models` is rejected (same discipline as a missing judge
   * gateway in record mode — never silently falls back to `deps.agent`, which has no model
   * policy to sweep with).
   */
  liveAgentFor?: (opts: {
    modelPolicy: ModelPolicy;
    usage: MemoryUsageMeter;
    onUnmetered: (usage: { model: string }) => void;
    /** An `openai-compatible` entry's own base URL (task 7.6a), absent for `anthropic`. */
    baseURL?: string;
  }) => EvalAgent;
}

/** Stands in for the judge in replay: the recorder never calls it while fixtures exist. */
export const replayJudgeGateway: ModelGateway = {
  stream: () => {
    throw new Error('replay mode: judge gateway not wired; run with --record');
  },
  generateObject: () =>
    Promise.reject(new Error('replay mode: judge gateway not wired; run with --record')),
  embed: () => Promise.reject(new Error('replay mode: judge gateway not wired; run with --record')),
};

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function runEvalCommand(
  args: readonly string[],
  io: CliIo,
  deps: EvalCommandDeps,
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...args],
      allowPositionals: true,
      strict: true,
      options: {
        fixtures: { type: 'string' },
        record: { type: 'boolean', default: false },
        report: { type: 'string' },
        models: { type: 'string' },
        'report-dir': { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (e) {
    io.stderr(`edmate eval: ${message(e)}\n\n${EVAL_USAGE}`);
    return 1;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    io.stdout(EVAL_USAGE);
    return 0;
  }
  const [suiteArg, ...extra] = positionals;
  if (suiteArg === undefined || extra.length > 0) {
    io.stderr(`edmate eval: expected exactly one suite directory\n\n${EVAL_USAGE}`);
    return 1;
  }

  if (values.models !== undefined) {
    if (!values.record) {
      io.stderr(`edmate eval: --models needs --record (the sweep is always a live run)\n\n${EVAL_USAGE}`);
      return 1;
    }
    if (values.fixtures !== undefined || values.report !== undefined) {
      io.stderr(
        `edmate eval: --models cannot be combined with --fixtures or --report (use --report-dir)\n\n${EVAL_USAGE}`,
      );
      return 1;
    }
    if (deps.liveAgentFor === undefined) {
      io.stderr(`edmate eval: --models is not wired for this agent (no liveAgentFor)\n`);
      return 1;
    }
    try {
      return await runModelSweep(suiteArg, values, io, deps);
    } catch (e) {
      io.stderr(`edmate eval: ${message(e)}\n`);
      return 1;
    }
  }

  try {
    const suiteDir = resolve(deps.cwd, suiteArg);
    const fixturesDir = resolve(deps.cwd, values.fixtures ?? 'evals/fixtures');
    const cases = loadCasesFromDir(suiteDir);
    let judgeGateway = replayJudgeGateway;
    let judgeModel: JudgeModelConfig | undefined;
    if (values.record) {
      judgeModel = resolveJudgeModel(deps.env);
      judgeGateway = await (deps.makeJudgeGateway ?? createJudgeGateway)(judgeModel, deps.env);
    }
    const recorder = fileRecorder(fixturesDir, values.record ? 'record' : 'replay');
    const { results, failed } = await runSuite(cases, {
      agent: deps.agent,
      judgeGateway,
      ...(judgeModel === undefined ? {} : { judgeModel }),
      recorder,
    });
    io.stdout(toSummary(results, { overwritten: recorder.overwritten() }));
    if (values.report !== undefined) {
      const reportPath = resolve(deps.cwd, values.report);
      const generatedAt = (deps.now ?? (() => new Date()))().toISOString();
      mkdirSync(dirname(reportPath), { recursive: true });
      writeFileSync(
        reportPath,
        JSON.stringify(toJsonReport(results, { suite: suiteArg, generatedAt }), null, 2) + '\n',
      );
    }
    return failed === 0 ? 0 : 1;
  } catch (e) {
    io.stderr(`edmate eval: ${message(e)}\n`);
    return 1;
  }
}

/**
 * `<dir>` may itself be one suite (no subdirectories), or a directory of suite directories (its
 * immediate subdirectories are the suites). An empty suite directory (`evals/suites/pedagogy`'s
 * `.gitkeep` only, 7.2 not done yet) is zero cases, never an error (plan's own requirement).
 */
function listSweepSuites(dir: string): { name: string; dir: string }[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const subdirs = entries.filter((e) => e.isDirectory());
  if (subdirs.length === 0) return [{ name: basename(dir), dir }];
  return subdirs
    .map((e) => ({ name: e.name, dir: join(dir, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Loads a suite's cases, or `[]` for an empty suite directory (never an error, plan's own rule).
 * Detects "empty" by `NoCasesFoundError`'s type (task 7.6a), never by matching its message text. */
function loadSweepCases(dir: string) {
  try {
    return loadCasesFromDir(dir);
  } catch (e) {
    if (e instanceof NoCasesFoundError) return [];
    throw e;
  }
}

/** One row of `summary.json`: either a completed (model, suite) run, or (task 7.6a) a failed one
 * that never produced a report — `error` is the only field set, so a reader can tell the two
 * apart without guessing from missing numbers. */
type SweepSummaryRow =
  | { model: string; suite: string; passed: number; total: number; cost: ReportCost }
  | { model: string; suite: string; error: string };

/** One (model, suite) run's cost, from its own fresh usage meter (plan's "by tier" design, lead
 * answer Q3: split by the tier a call actually used, not by model). */
function sweepCost(usage: MemoryUsageMeter, unpricedCalls: number, totalTurns: number): ReportCost {
  let sum = 0;
  const byTier: Record<string, number> = {};
  for (const row of usage.rows) {
    sum += row.usage.costMicroUsd;
    byTier[row.usage.tier] = (byTier[row.usage.tier] ?? 0) + row.usage.costMicroUsd;
  }
  return { perTurnMicroUsd: totalTurns === 0 ? 0 : sum / totalTurns, byTier, unpricedCalls };
}

/** `edmate eval <dir> --models <file> [--report-dir <dir>]` (task 7.6 Phase B). One report per
 * (model, suite) pair under `--report-dir`, plus a combined `summary.json`. Never touches
 * `--fixtures`/single-suite `--report`'s recorded-fixture path (`memoryRecorder`, not
 * `fileRecorder`: a sweep's replies are evidence, not fixtures to replay later). */
async function runModelSweep(
  suiteArg: string,
  values: { models?: string; 'report-dir'?: string },
  io: CliIo,
  deps: EvalCommandDeps,
): Promise<number> {
  const entries = loadLiveModels(resolve(deps.cwd, values.models!));
  const suites = listSweepSuites(resolve(deps.cwd, suiteArg));
  const judgeModel = resolveJudgeModel(deps.env);
  const judgeGateway = await (deps.makeJudgeGateway ?? createJudgeGateway)(judgeModel, deps.env);
  const reportDir = resolve(deps.cwd, values['report-dir'] ?? 'evals/reports/live');
  const generatedAt = (deps.now ?? (() => new Date()))().toISOString();
  const summary: SweepSummaryRow[] = [];
  let anyFailed = false;

  for (const entry of entries) {
    const target = { provider: entry.provider, model: entry.model };
    const modelPolicy: ModelPolicy = { tiers: { small: target, main: target } };
    for (const suite of suites) {
      // Task 7.6a: one pair's throw (a loader problem, an agent-construction failure, a live
      // call error) is recorded here and never aborts the rest of the sweep — earlier and later
      // pairs' reports still land on disk and in this summary.
      try {
        const cases = loadSweepCases(suite.dir);
        let cost: ReportCost;
        let report;
        if (cases.length === 0) {
          cost = { perTurnMicroUsd: 0, byTier: {}, unpricedCalls: 0 };
          report = toJsonReport([], { suite: suite.name, generatedAt, model: entry.label, cost });
        } else {
          const usage = memoryUsageMeter();
          let unpricedCalls = 0;
          const agent = deps.liveAgentFor!({
            modelPolicy,
            usage,
            onUnmetered: () => {
              unpricedCalls += 1;
            },
            ...(entry.baseURL === undefined ? {} : { baseURL: entry.baseURL }),
          });
          const { results, failed } = await runSuite(cases, {
            agent,
            judgeGateway,
            judgeModel,
            recorder: memoryRecorder('record'),
          });
          if (failed > 0) anyFailed = true;
          const totalTurns = results.reduce((n, r) => n + r.turns.length, 0);
          cost = sweepCost(usage, unpricedCalls, totalTurns);
          report = toJsonReport(results, { suite: suite.name, generatedAt, model: entry.label, cost });
        }
        const reportPath = join(reportDir, entry.label, `${suite.name}.json`);
        mkdirSync(dirname(reportPath), { recursive: true });
        writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
        summary.push({ model: entry.label, suite: suite.name, passed: report.passed, total: report.total, cost });
      } catch (e) {
        anyFailed = true;
        const errorMessage = message(e);
        io.stderr(`edmate eval: ${entry.label} / ${suite.name} failed: ${errorMessage}\n`);
        summary.push({ model: entry.label, suite: suite.name, error: errorMessage });
      }
    }
  }

  const summaryPath = join(reportDir, 'summary.json');
  mkdirSync(dirname(summaryPath), { recursive: true });
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n');
  io.stdout(
    summary
      .map((r) =>
        'error' in r
          ? `${r.model} / ${r.suite}: FAILED: ${r.error}`
          : `${r.model} / ${r.suite}: ${r.passed}/${r.total} passed, ` +
            `${r.cost.perTurnMicroUsd} microUSD/turn` +
            (r.cost.unpricedCalls > 0 ? ` (${r.cost.unpricedCalls} unpriced calls)` : ''),
      )
      .join('\n') + '\n',
  );
  return anyFailed ? 1 : 0;
}

/** The agent `edmate eval` uses until the harness pipeline exists: it refuses every call. */
export const unwiredAgent: EvalAgent = {
  reply: () =>
    Promise.reject(
      new Error(
        'no agent under test is wired into the CLI yet (it arrives with the harness pipeline); ' +
          'replay needs recorded agent fixtures',
      ),
    ),
};
