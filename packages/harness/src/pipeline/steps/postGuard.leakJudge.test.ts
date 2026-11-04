// Task 4.5b: the postGuard step with answerLeak's paraphrase judge wired in. The judge is the
// gateway-level fake (testing/leakJudge.ts); material is synthetic.
import type { PedagogyDecision, TurnContext } from '@edmate/contracts';
import { demoPedagogyDecision, demoTurnContext, demoTurnInput } from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { ANSWER_LEAK_SAFE_HINT } from '../../guardrails/answerLeak.js';
import { postGuards } from '../../guardrails/postGuards.js';
import { cancelSource } from '../clock.js';
import {
  CLEAN_LEAK_VERDICT,
  LEAK_VERDICT,
  leakJudgeGateway,
  type LeakVerdict,
  paraphraseJudge,
} from '../../testing/leakJudge.js';
import { type StreamStep, ScriptedGateway } from '../../testing/scriptedGateway.js';
import { spyGateway } from '../../testing/spyGateway.js';
import { testDeps } from '../../testing/testSteps.js';
import { virtualClock } from '../../testing/virtualClock.js';
import { STEP_SPEC } from '../spec.js';
import type { StepEnv } from '../types.js';
import { ANSWER_LEAK_JUDGE_WEIGHT, postGuard } from './postGuard.js';

const CTX: TurnContext = demoTurnContext;
// A move that does not need grounding coverage (DELIVERS, grounding.ts), so only answerLeak's own
// matcher and judge decide the outcome in these tests.
const explain: PedagogyDecision = { ...demoPedagogyDecision, move: 'redirect' };
const BUDGET = STEP_SPEC.postGuard.timeoutMs as number;

interface Setup {
  verdict?: 'clean' | 'leak' | LeakVerdict | 'script';
  rewrites?: StreamStep[][];
  judgeDelayMs?: number;
}

function setup(o: Setup = {}) {
  const clock = virtualClock();
  const spy = spyGateway(
    new ScriptedGateway({ stream: (o.rewrites ?? []).map((steps) => ({ steps })) }, clock),
  );
  const v = o.verdict ?? 'clean';
  const verdict: LeakVerdict =
    v === 'clean' ? () => CLEAN_LEAK_VERDICT : v === 'leak' ? () => LEAK_VERDICT : v === 'script' ? paraphraseJudge : v;
  const gateway =
    v === 'script'
      ? spy
      : leakJudgeGateway(spy, verdict, {
          clock,
          ...(o.judgeDelayMs === undefined ? {} : { delayMs: o.judgeDelayMs }),
        });
  const { deps } = testDeps({ clock });
  const env: StepEnv = {
    input: { ...demoTurnInput, text: 'Is the answer warm?' },
    deps,
    cancel: cancelSource().token,
    turnId: 'turn_1',
    gateway,
    usage: { record: () => undefined, checkBeforeCall: () => undefined },
    report: () => undefined,
    track: () => undefined,
  };
  const judged = 'leakJudged' in gateway ? gateway.leakJudged : [];
  const run = (draft: string, decision: PedagogyDecision = explain) =>
    clock.drive(postGuard(env, { ctx: CTX, decision, draft, sources: [] }));
  return { clock, spy, run, judged };
}

describe('postGuard: answerLeak’s paraphrase judge (4.5b)', () => {
  it('a non-numeric key: the judge is called, its clean verdict passes the reply', async () => {
    const s = setup({ verdict: 'clean' });
    const r = await s.run('Think about a fire.', { ...explain, mustNotReveal: ['Warm'] });
    expect(r).toMatchObject({ result: 'ok' });
    expect(s.judged).toHaveLength(1);
  });

  it('an all-numeric key: the judge is never called', async () => {
    const s = setup({ verdict: 'clean' });
    const r = await s.run('Trace each line.', { ...explain, mustNotReveal: ['16'] });
    expect(r).toMatchObject({ result: 'ok' });
    expect(s.judged).toEqual([]);
  });

  it('a leak verdict with no rewrite configured replaces the reply with the safe hint', async () => {
    const s = setup({ verdict: 'leak' });
    const r = await s.run('Think about a fire.', { ...explain, mustNotReveal: ['Warm'] });
    expect(r).toMatchObject({ result: 'replace', text: ANSWER_LEAK_SAFE_HINT });
  });

  it('a turn with a non-numeric key weighs answerLeak higher, so it gets a larger time share', async () => {
    const names = postGuards.ordered().map((g) => g.name);
    const base = names.map((n) => postGuards.weight(n));
    expect(base[names.indexOf('answerLeak')]).toBeLessThan(ANSWER_LEAK_JUDGE_WEIGHT);
  });

  it('a judge that times out fails closed to the safe hint, inside the step budget', async () => {
    const s = setup({ verdict: 'clean', judgeDelayMs: 60_000 });
    const t0 = s.clock.now();
    const r = await s.run('Think about a fire.', { ...explain, mustNotReveal: ['Warm'] });
    expect(r).toMatchObject({ result: 'replace', text: ANSWER_LEAK_SAFE_HINT });
    expect(s.clock.now() - t0).toBeLessThan(BUDGET);
  });
});
