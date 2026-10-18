// `edmate eval <dir> [--fixtures <dir>] [--record] [--report <file>]` (task 3.12).
// Replay (the default) is fully offline: agent replies and judge verdicts come from recorded
// fixtures, and a missing fixture fails the run. --record makes live calls and rewrites them.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { ModelGateway } from '@edmate/contracts';
import {
  fileRecorder,
  loadCasesFromDir,
  resolveJudgeModel,
  runSuite,
  toJsonReport,
  toSummary,
  type EvalAgent,
  type JudgeModelConfig,
} from '@edmate/evals';
import type { CliIo } from '../cli.js';
import { createJudgeGateway, type Env } from './judgeGateway.js';

export const EVAL_USAGE = `Usage: edmate eval <dir> [--fixtures <dir>] [--record] [--report <file>]

Runs every .yaml/.yml eval case under <dir>.
  --fixtures <dir>  recorded agent replies and judge outputs (default: evals/fixtures)
  --record          call the agent and the judge live and rewrite the fixtures
                    (needs EDMATE_JUDGE_MODEL="<provider>:<model>" and that provider's key)
  --report <file>   also write a JSON report
Without --record nothing is called live; a missing fixture fails the run.
No agent under test is wired yet (it arrives with the harness pipeline), so --record
fails until one is.
`;

export interface EvalCommandDeps {
  agent: EvalAgent;
  env: Env;
  cwd: string;
  makeJudgeGateway?: (config: JudgeModelConfig, env: Env) => Promise<ModelGateway>;
  now?: () => Date;
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
    const { results, failed } = await runSuite(cases, {
      agent: deps.agent,
      judgeGateway,
      ...(judgeModel === undefined ? {} : { judgeModel }),
      recorder: fileRecorder(fixturesDir, values.record ? 'record' : 'replay'),
    });
    io.stdout(toSummary(results));
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
