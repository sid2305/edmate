// `edmate gate demo --change <kind> [--change <kind>...] [--fixtures <dir>] [--seed <s>]
// [--report <file>]` (task 7.4 Phase C): CLI parity for the quality gate (packages/evals'
// `runQualityGate`), scoped by change. Offline only (lead note, 21 Oct 2026): replay mode from
// recorded fixtures, never --record and never a live model call. A missing fixture fails the
// case (`MissingFixtureError`) and so the gate (closed); there is no way to pass --record through
// this command's flags.
//
// Thresholds for the `feedback`/`revision` suites and platform `accuracy` cases are not decided
// yet (blocker B-40): a full-scope change (`first_publish`/`prompt_pack_bump`) over today's real
// suites would otherwise fail with the first `GateScopeError` it hits, naming only one suite. This
// command checks the whole platform suite up front instead and names every suite/group that has
// no threshold or no cases, so the human sees the whole gap at once and nothing is invented here.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  buildScorecard,
  CHANGE_KINDS,
  fileRecorder,
  GATE_THRESHOLDS,
  loadCasesFromDir,
  runQualityGate,
  type ChangeKind,
  type EvalCase,
  type GateGroup,
  type Recorder,
} from '@edmate/evals';
import type { CliIo } from '../cli.js';
import { unwiredAgent, replayJudgeGateway } from './eval.js';
import { loadDemoPerAgentInput } from './gate/demoInput.js';

export const GATE_USAGE = `Usage: edmate gate demo --change <kind> [--change <kind>...]
       [--fixtures <dir>] [--seed <s>] [--report <file>]

Runs the quality gate for the demo agent, scoped by change, fully offline: every agent reply and
judge verdict comes from a recorded fixture (default: evals/fixtures); a missing fixture fails
the case, and so the gate. There is no --record here; run "edmate eval --record" first to fill
the fixtures a scope needs.

<agent> must be "demo" until the publish flow (8.7) wires real teachers.

  --change <kind>   repeatable; one of: ${CHANGE_KINDS.join(', ')}
  --fixtures <dir>  recorded agent/judge fixtures (default: evals/fixtures)
  --seed <s>        rotates the style-card sample (default: "")
  --report <file>   also write the GateResult as JSON
  --scorecard <file> also write the Scorecard (per-agent pass rates) as JSON

Exits 0 only when every group in scope passes its publish threshold. Exits 1 on any failure,
including when a full-scope change needs a suite or group with no decided threshold yet (named,
not guessed at).
`;

export interface GateCommandDeps {
  cwd: string;
  /** evals/suites by default (task 7.4 Phase C); a test may point elsewhere. */
  suitesDir?: string;
  /** content/demo-teacher by default; a test may point elsewhere. */
  contentDir?: string;
  /**
   * Test injection only: replaces the real `fileRecorder` built from `--fixtures`. Either way the
   * gate stays offline (lead note 1): this command only ever runs a recorder in replay mode.
   */
  recorder?: Recorder;
  now?: () => Date;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const DISTRESS_PREFIX = 'safety-distress-';

/**
 * For a full-scope change: suites present in `platformCases` that have no gate threshold, and
 * threshold groups with zero matching platform cases today. Either one fails a full-scope gate
 * closed (blocker B-40) rather than inventing a threshold or quietly passing an empty group.
 */
function fullScopeGaps(platformCases: readonly EvalCase[]): {
  noThreshold: string[];
  emptyGroups: GateGroup[];
} {
  const knownSuites = new Set(Object.keys(GATE_THRESHOLDS));
  const noThreshold = [
    ...new Set(platformCases.map((c) => c.suite).filter((s) => !knownSuites.has(s))),
  ].sort();
  const counts = new Map<GateGroup, number>(
    (Object.keys(GATE_THRESHOLDS) as GateGroup[]).map((g) => [g, 0]),
  );
  for (const c of platformCases) {
    if (!knownSuites.has(c.suite)) continue;
    const group = (
      c.suite === 'safety' && c.id.startsWith(DISTRESS_PREFIX) ? 'safety-distress' : c.suite
    ) as GateGroup;
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  const emptyGroups = (Object.keys(GATE_THRESHOLDS) as GateGroup[]).filter(
    (g) => (counts.get(g) ?? 0) === 0,
  );
  return { noThreshold, emptyGroups };
}

export async function runGateCommand(
  args: readonly string[],
  io: CliIo,
  deps: GateCommandDeps,
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...args],
      allowPositionals: true,
      strict: true,
      options: {
        change: { type: 'string', multiple: true },
        fixtures: { type: 'string' },
        seed: { type: 'string' },
        report: { type: 'string' },
        scorecard: { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (e) {
    io.stderr(`edmate gate: ${message(e)}\n\n${GATE_USAGE}`);
    return 1;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    io.stdout(GATE_USAGE);
    return 0;
  }
  const [agentArg, ...extra] = positionals;
  if (agentArg === undefined || extra.length > 0) {
    io.stderr(`edmate gate: expected exactly one agent id\n\n${GATE_USAGE}`);
    return 1;
  }
  if (agentArg !== 'demo') {
    io.stderr(
      `edmate gate: only "demo" is supported until the publish flow (8.7); got "${agentArg}"\n\n${GATE_USAGE}`,
    );
    return 1;
  }
  const changes = values.change ?? [];
  if (changes.length === 0) {
    io.stderr(`edmate gate: at least one --change <kind> is required\n\n${GATE_USAGE}`);
    return 1;
  }
  for (const kind of changes) {
    if (!(CHANGE_KINDS as readonly string[]).includes(kind)) {
      io.stderr(
        `edmate gate: unknown --change kind "${kind}" (one of: ${CHANGE_KINDS.join(', ')})\n\n${GATE_USAGE}`,
      );
      return 1;
    }
  }

  try {
    const suitesDir = resolve(deps.cwd, deps.suitesDir ?? 'evals/suites');
    const platformCases = loadCasesFromDir(suitesDir);
    const isFullScope = changes.includes('first_publish') || changes.includes('prompt_pack_bump');
    if (isFullScope) {
      const gaps = fullScopeGaps(platformCases);
      if (gaps.noThreshold.length > 0 || gaps.emptyGroups.length > 0) {
        const lines = [
          'edmate gate: this change needs the full platform suite, but it is not ready yet (blocker B-40):',
        ];
        if (gaps.noThreshold.length > 0) {
          lines.push(`  no gate threshold decided for suite(s): ${gaps.noThreshold.join(', ')}`);
        }
        if (gaps.emptyGroups.length > 0) {
          lines.push(`  no platform cases yet for group(s): ${gaps.emptyGroups.join(', ')}`);
        }
        io.stderr(lines.join('\n') + '\n');
        return 1;
      }
    }

    const perAgent = loadDemoPerAgentInput(deps.contentDir);
    const recorder =
      deps.recorder ?? fileRecorder(resolve(deps.cwd, values.fixtures ?? 'evals/fixtures'), 'replay');

    const result = await runQualityGate({
      changes: changes as ChangeKind[],
      platformCases,
      perAgent,
      agentFor: () => unwiredAgent,
      judgeGateway: replayJudgeGateway,
      recorder,
      styleSampleSeed: values.seed ?? '',
    });

    const lines = result.groups.map(
      (g) => `${g.origin}:${g.group} ${g.passed}/${g.total} ${g.pass ? 'pass' : 'FAIL'}`,
    );
    lines.push(`estimatedSeconds: ${result.stats.estimatedSeconds}`);
    if (!result.pass) lines.push(`failed: ${result.failedCaseIds.join(', ')}`);
    io.stdout(lines.join('\n') + '\n');

    if (values.report !== undefined) {
      const reportPath = resolve(deps.cwd, values.report);
      mkdirSync(dirname(reportPath), { recursive: true });
      writeFileSync(reportPath, JSON.stringify(result, null, 2) + '\n');
    }
    if (values.scorecard !== undefined) {
      const scorecardPath = resolve(deps.cwd, values.scorecard);
      mkdirSync(dirname(scorecardPath), { recursive: true });
      writeFileSync(
        scorecardPath,
        JSON.stringify(buildScorecard(result), null, 2) + '\n',
      );
    }
    return result.pass ? 0 : 1;
  } catch (e) {
    io.stderr(`edmate gate: ${message(e)}\n`);
    return 1;
  }
}
