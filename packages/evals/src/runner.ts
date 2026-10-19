// Runs eval cases turn by turn (task 3.12). Every agent reply and every judge verdict goes
// through the Recorder, so a replay run is fully offline and reproduces the recorded report.
import type { ModelGateway } from '@edmate/contracts';
import { z, type ZodType } from 'zod';
import {
  EvalAgentReplySchema,
  type EvalAgent,
  type EvalAgentReply,
  type PriorTurn,
} from './agent.js';
import { judge, JudgeVerdictSchema } from './checks/judge.js';
import type { CheckResult } from './checks/result.js';
import { checkMatches, checkMustContain, checkMustNotContain } from './checks/string.js';
import {
  checkMaxChars,
  checkMaxWords,
  checkMustCiteSource,
  checkMustEscalate,
} from './checks/structure.js';
import {
  JUDGE_MODEL_VARIABLE,
  JudgeModelConfigError,
  type JudgeModelConfig,
} from './judgeModel.js';
import type { Recorder } from './recorder.js';
import type { Checks, EvalCase } from './schema.js';

export type { CheckResult } from './checks/result.js';

export interface RunOptions {
  agent: EvalAgent;
  /** Only called for a live judge call (record mode); a stub that throws is fine for replay. */
  judgeGateway: ModelGateway;
  /** The pinned judge model; required for any live judge call, stored in its fixture. */
  judgeModel?: JudgeModelConfig;
  recorder: Recorder;
}

export interface TurnResult {
  turnIndex: number;
  student: string;
  reply: string;
  checks: CheckResult[];
  pass: boolean;
}

export interface CaseResult {
  id: string;
  suite: string;
  pass: boolean;
  /** Why the case failed outside its checks: it threw (turns holds those finished), or no check ran. */
  error?: string;
  turns: TurnResult[];
}

export interface SuiteResult {
  results: CaseResult[];
  passed: number;
  failed: number;
}

/** What a recorded judge fixture holds: the verdict and which pinned model gave it. */
export const RecordedJudgeSchema = z.strictObject({
  judgeModel: z.strictObject({ provider: z.string().min(1), model: z.string().min(1) }),
  verdict: JudgeVerdictSchema,
});

function validate<T>(schema: ZodType<T>, value: unknown, what: string, key: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`${what} for "${key}" is malformed:\n${z.prettifyError(parsed.error)}`, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

/** String and structure checks, in a fixed order whatever the YAML key order. */
function staticChecks(expect: Checks, reply: EvalAgentReply): CheckResult[] {
  const out: CheckResult[] = [];
  if (expect.must_contain) out.push(checkMustContain(reply.text, expect.must_contain));
  if (expect.must_not_contain) out.push(checkMustNotContain(reply.text, expect.must_not_contain));
  if (expect.matches) out.push(checkMatches(reply.text, expect.matches));
  if (expect.max_words !== undefined) out.push(checkMaxWords(reply.text, expect.max_words));
  if (expect.max_chars !== undefined) out.push(checkMaxChars(reply.text, expect.max_chars));
  if (expect.must_cite_source !== undefined) {
    out.push(checkMustCiteSource(reply, expect.must_cite_source));
  }
  if (expect.must_escalate !== undefined) {
    out.push(checkMustEscalate(reply, expect.must_escalate));
  }
  return out;
}

/** Throws on any error; finished turns are pushed onto `turns` as they complete. */
async function runTurns(evalCase: EvalCase, opts: RunOptions, turns: TurnResult[]): Promise<void> {
  const priorTurns: PriorTurn[] = [];
  for (const [turnIndex, turn] of evalCase.turns.entries()) {
    const base = `${evalCase.id}/turn-${turnIndex}`;
    const agentKey = `${base}/agent`;
    const history = priorTurns.map((t) => ({ ...t }));
    const raw = await opts.recorder.run(agentKey, async () =>
      validate(
        EvalAgentReplySchema,
        await opts.agent.reply({
          caseId: evalCase.id,
          turnIndex,
          student: turn.student,
          priorTurns: history,
        }),
        'agent reply',
        agentKey,
      ),
    );
    const reply = validate(EvalAgentReplySchema, raw, 'agent reply', agentKey);

    const checks = turn.expect ? staticChecks(turn.expect, reply) : [];
    for (const [i, rubric] of (turn.expect?.judge ?? []).entries()) {
      const key = `${base}/judge-${i}`;
      const recorded = await opts.recorder.run(key, async () => {
        const judgeModel = opts.judgeModel;
        if (judgeModel === undefined) {
          throw new JudgeModelConfigError(
            `a live judge call needs the pinned judge model (${JUDGE_MODEL_VARIABLE})`,
          );
        }
        const verdict = await judge(opts.judgeGateway, rubric, reply.text, priorTurns);
        return { judgeModel: { ...judgeModel }, verdict };
      });
      const { verdict } = validate(RecordedJudgeSchema, recorded, 'judge output', key);
      checks.push({ name: `judge[${i}]`, pass: verdict.pass, detail: verdict.reason });
    }

    turns.push({
      turnIndex,
      student: turn.student,
      reply: reply.text,
      checks,
      pass: checks.every((c) => c.pass),
    });
    priorTurns.push({ student: turn.student, reply: reply.text });
  }
}

/** Scores finished turns. A case where no check ran fails rather than passing vacuously. */
function score(evalCase: EvalCase, turns: TurnResult[]): CaseResult {
  const { id, suite } = evalCase;
  // Belt and braces with the schema's "at least one turn with expect" rule.
  if (turns.every((t) => t.checks.length === 0)) {
    return { id, suite, pass: false, error: 'no checks ran', turns };
  }
  return { id, suite, pass: turns.every((t) => t.pass), turns };
}

/** Runs one case; throws if a call or a fixture fails. */
export async function runCase(evalCase: EvalCase, opts: RunOptions): Promise<CaseResult> {
  const turns: TurnResult[] = [];
  await runTurns(evalCase, opts, turns);
  return score(evalCase, turns);
}

/** Like runCase, but an error fails just this case, keeping the turns that finished. */
async function runCaseSafely(evalCase: EvalCase, opts: RunOptions): Promise<CaseResult> {
  const turns: TurnResult[] = [];
  try {
    await runTurns(evalCase, opts, turns);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { id: evalCase.id, suite: evalCase.suite, pass: false, error, turns };
  }
  return score(evalCase, turns);
}

/**
 * Runs cases in the order given; the loader (or a gate's own filter) decides that order. A case
 * that throws is recorded as failed with its error, and the run goes on to the next case.
 */
export async function runSuite(cases: readonly EvalCase[], opts: RunOptions): Promise<SuiteResult> {
  const results: CaseResult[] = [];
  for (const evalCase of cases) results.push(await runCaseSafely(evalCase, opts));
  const passed = results.filter((r) => r.pass).length;
  return { results, passed, failed: results.length - passed };
}
