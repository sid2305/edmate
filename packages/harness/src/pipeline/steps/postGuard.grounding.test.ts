// Task 4.7: the postGuard step with grounding registered (the default chain). The judge is the
// gateway-level fake (testing/groundingJudge.ts); material is synthetic.
import type { Chunk, PedagogyDecision, RetrievalIndex, TurnContext } from '@edmate/contracts';
import {
  demoChunkScored,
  demoPedagogyDecision,
  demoTurnContext,
  demoTurnInput,
  usageSmall,
} from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { ANSWER_LEAK_SAFE_HINT } from '../../guardrails/answerLeak.js';
import {
  askTeacherReplyText,
  GROUNDING_JUDGE_SYSTEM,
  PREMISE_CORRECTION_REPLY,
} from '../../guardrails/grounding.js';
import { lockedReplyText } from '../../guardrails/lockedLeak.js';
import { postGuards } from '../../guardrails/postGuards.js';
import { cancelSource } from '../clock.js';
import { TurnAbort } from '../errors.js';
import {
  GROUNDED_VERDICT,
  judgeGateway,
  type JudgeVerdict,
  overlapJudge,
  UNGROUNDED_VERDICT,
} from '../../testing/groundingJudge.js';
import { memoryRetrieval } from '../../testing/memoryRetrieval.js';
import { type StreamStep, ScriptedGateway } from '../../testing/scriptedGateway.js';
import { spyGateway } from '../../testing/spyGateway.js';
import { TEST_DISTRESS_REPLY, TEST_SAFE_REPLY, testDeps } from '../../testing/testSteps.js';
import { virtualClock } from '../../testing/virtualClock.js';
import { LAST_RESORT_DISTRESS_REPLY } from '../replies.js';
import { STEP_SPEC } from '../spec.js';
import type { FallbackReplies, StepEnv } from '../types.js';
import {
  GROUNDING_JUDGE_MAX_OUTPUT_TOKENS,
  GROUNDING_JUDGE_TIMEOUT_MS,
  postGuard,
  REWRITE_SYSTEM,
} from './postGuard.js';

const NOTES = 'Floor division // divides, then rounds down to a whole number: 7 // 2 is 3.';
const chunk = (text: string, score = 0.8): Chunk => ({ ...demoChunkScored, text, score });
const CTX: TurnContext = { ...demoTurnContext, retrieved: [chunk(NOTES)] };
const explain: PedagogyDecision = { ...demoPedagogyDecision, move: 'explain', mustNotReveal: [] };
const ASK = askTeacherReplyText();
const say = (text: string): StreamStep => ({ type: 'text', text });
const used: StreamStep = { type: 'usage', usage: usageSmall };
const BUDGET = STEP_SPEC.postGuard.timeoutMs as number;

interface Setup {
  /** Scripted non-judge streams (answerLeak's rewrite). */
  rewrites?: StreamStep[][];
  judge?: JudgeVerdict | 'grounded' | 'ungrounded' | 'script';
  judgeDelayMs?: number;
  studentText?: string;
  overBudget?: boolean;
  /** A locked-check index whose every check takes this long on the turn's clock. */
  lockedCheckMs?: number;
  fallbackReplies?: Partial<FallbackReplies>;
}

function setup(o: Setup = {}) {
  const clock = virtualClock();
  const spy = spyGateway(
    new ScriptedGateway({ stream: (o.rewrites ?? []).map((steps) => ({ steps })) }, clock),
  );
  const j = o.judge ?? 'grounded';
  const verdict: JudgeVerdict | undefined =
    j === 'grounded'
      ? () => GROUNDED_VERDICT
      : j === 'ungrounded'
        ? () => UNGROUNDED_VERDICT
        : j === 'script'
          ? undefined
          : j;
  const gateway =
    verdict === undefined
      ? spy
      : judgeGateway(spy, verdict, {
          clock,
          ...(o.judgeDelayMs === undefined ? {} : { delayMs: o.judgeDelayMs }),
        });
  const base = memoryRetrieval({ chunks: [] });
  const retrieval: RetrievalIndex = {
    ...base,
    leakCheck: async (...a) => {
      await clock.sleep(o.lockedCheckMs ?? 0);
      return base.leakCheck(...a);
    },
  };
  const { deps } = testDeps({
    clock,
    overrides: o.lockedCheckMs === undefined ? {} : { retrieval },
  });
  deps.fallbackReplies = { ...deps.fallbackReplies, ...o.fallbackReplies };
  const reported: unknown[] = [];
  const env: StepEnv = {
    input: { ...demoTurnInput, text: o.studentText ?? 'What does // do?' },
    deps,
    cancel: cancelSource().token,
    turnId: 'turn_1',
    gateway,
    usage: {
      record: () => undefined,
      checkBeforeCall: () => {
        if (o.overBudget === true) throw new TurnAbort('turn_cost_exceeded');
      },
    },
    report: (e) => void reported.push(e),
    track: () => undefined,
  };
  const judged = 'judged' in gateway ? gateway.judged : [];
  const run = (
    draft: string,
    extra: { decision?: PedagogyDecision; ctx?: TurnContext; raw?: string } = {},
  ) =>
    clock.drive(
      postGuard(env, {
        ctx: extra.ctx ?? CTX,
        decision: extra.decision ?? explain,
        draft,
        ...(extra.raw === undefined ? {} : { raw: extra.raw }),
        sources: [chunk(NOTES).source],
      }),
    );
  return { clock, spy, env, reported, run, judged };
}

const trace = (grounding: { ok: boolean; action?: string }[]) => {
  const pass = (g: { ok: boolean; action?: string }) => [
    { name: 'lockedLeak', ok: true },
    { name: 'answerLeak', ok: true },
    { name: 'grounding', ...g },
    { name: 'adviceGuard', ok: true },
  ];
  return grounding.flatMap(pass);
};

describe('the post registry (4.7)', () => {
  it('runs lockedLeak, answerLeak, grounding, then adviceGuard (4.8), weighted 2, 3, 4 and 4', () => {
    const names = ['lockedLeak', 'answerLeak', 'grounding', 'adviceGuard'];
    expect(postGuards.ordered().map((g) => g.name)).toEqual(names);
    expect(names.map((n) => postGuards.weight(n))).toEqual([2, 3, 4, 4]);
  });
});

describe('postGuard: grounding', () => {
  it('a grounded reply passes unchanged; one judge call on the small tier, its usage kept', async () => {
    const s = setup();
    const r = await s.run('Floor division rounds down to a whole number [1].');
    expect(r).toEqual({ result: 'ok', guards: trace([{ ok: true }]), usage: [usageSmall] });
    expect(s.judged).toHaveLength(1);
    expect(s.judged[0]).toMatchObject({
      tier: 'small',
      system: GROUNDING_JUDGE_SYSTEM,
      maxOutputTokens: GROUNDING_JUDGE_MAX_OUTPUT_TOKENS,
    });
    expect(s.judged[0]?.messages).toHaveLength(1);
    expect(s.spy.requests).toEqual([]);
  });

  it('an ungrounded reply becomes the ask-teacher reply, escalated by its reason code; the verification pass does not re-trip', async () => {
    const s = setup({ judge: 'ungrounded' });
    const r = await s.run('Python 4 makes // exact.');
    expect(r).toEqual({
      result: 'replace',
      text: ASK,
      escalateToTeacher: true,
      groundingRewrote: true,
      guards: trace([{ ok: false, action: 'rewrite' }, { ok: true }]),
      usage: [usageSmall],
    });
    expect(s.judged).toHaveLength(1);
  });

  it('a premise correction or a number fix is replaced but never escalated', async () => {
    const s = setup({ studentText: '7 // 2 is 4, right?' });
    expect(await s.run('Yes, that is right!')).toEqual({
      result: 'replace',
      text: PREMISE_CORRECTION_REPLY,
      groundingRewrote: true,
      guards: trace([{ ok: false, action: 'rewrite' }, { ok: true }]),
      usage: [],
    });
    const fix = setup();
    const r = await fix.run('Here 7 // 2 is 4, it rounds down [1].');
    expect(r).toMatchObject({
      result: 'replace',
      text: 'Here 7 // 2 is 3, it rounds down [1].',
    });
    expect(r).not.toHaveProperty('escalateToTeacher');
    // The fixed text was judged once; the verification pass reused that verdict.
    expect(fix.judged).toHaveLength(1);
    expect(r.usage).toEqual([usageSmall]);
  });

  it('a number fix that would show the answer key ends in the hint and never shows the key (lead answer 4)', async () => {
    const s = setup();
    const decision = { ...explain, mustNotReveal: ['42'] };
    const r = await s.run('So 40 + 2 is 41 [1].', { decision });
    expect(r).toMatchObject({ result: 'replace', text: ANSWER_LEAK_SAFE_HINT });
    expect(JSON.stringify(r)).not.toContain('42');
  });

  it('a judge that times out fails closed to the SAFE reply: no teacher, a code-only report (fix round 1)', async () => {
    const s = setup({ judge: 'grounded', judgeDelayMs: 60_000 });
    const t0 = s.clock.now();
    const r = await s.run('Floor division rounds down [1].');
    expect(r).toMatchObject({ result: 'replace', text: TEST_SAFE_REPLY, groundingRewrote: true });
    expect(r).not.toHaveProperty('escalateToTeacher');
    expect(s.clock.now() - t0).toBeLessThan(BUDGET);
    expect(s.clock.now() - t0).toBeLessThanOrEqual(GROUNDING_JUDGE_TIMEOUT_MS + 1);
    expect(s.reported.map(String)).toEqual([
      'GroundingJudgeUnavailable: grounding judge unavailable: sent the safe reply',
    ]);
  });

  it('fails closed when the judge call errors (reported) or the turn is at its cost ceiling', async () => {
    const failing = setup({
      judge: 'script',
      rewrites: [[say('{"grounded":'), { type: 'error', code: 'provider_error' }]],
    });
    const out = await failing.run('Floor division rounds down [1].');
    expect(out).toMatchObject({ text: TEST_SAFE_REPLY });
    expect(out).not.toHaveProperty('escalateToTeacher');
    expect(failing.reported.map((e) => (e as Error).name)).toEqual([
      'ScriptedProviderError',
      'GroundingJudgeUnavailable',
    ]);

    const broke = setup({ overBudget: true });
    expect(await broke.run('Floor division rounds down [1].')).toMatchObject({
      text: TEST_SAFE_REPLY,
    });
    expect(broke.judged).toEqual([]);
    expect(broke.reported.map((e) => (e as Error).name)).toEqual([
      'TurnAbort',
      'GroundingJudgeUnavailable',
    ]);
  });

  it('a judge that answers anything but the strict verdict is "not grounded"; one that calls a tool gave no answer', async () => {
    const chatty = setup({ judge: () => 'Looks grounded to me! {"grounded": true}' });
    expect(await chatty.run('Floor division rounds down [1].')).toMatchObject({
      text: ASK,
      escalateToTeacher: true,
    });
    expect(chatty.reported).toEqual([]);
    const tool = setup({
      judge: 'script',
      rewrites: [[{ type: 'tool_call', id: 'c1', name: 'calculator', args: {} }, used]],
    });
    expect(await tool.run('Floor division rounds down [1].')).toMatchObject({
      text: TEST_SAFE_REPLY,
    });
  });

  it('uses the locale’s ask-teacher reply; an empty, oversized or failing one gives the built-in one', async () => {
    const calls: string[] = [];
    const locale = setup({
      judge: 'ungrounded',
      fallbackReplies: {
        askTeacher: (lang) => {
          calls.push(lang);
          return 'LOCALE ASK';
        },
      },
    });
    expect(await locale.run('Python 4 makes // exact.')).toMatchObject({ text: 'LOCALE ASK' });
    expect(calls).toEqual([demoTurnInput.lang]);
    for (const askTeacher of [() => '  ', () => 'x'.repeat(9_000)]) {
      const b = setup({ judge: 'ungrounded', fallbackReplies: { askTeacher } });
      expect(await b.run('Python 4 makes // exact.')).toMatchObject({ text: ASK });
    }
    const throwing = setup({
      judge: 'ungrounded',
      fallbackReplies: {
        askTeacher: () => {
          throw new RangeError('locale broke');
        },
      },
    });
    expect(await throwing.run('Python 4 makes // exact.')).toMatchObject({ text: ASK });
    expect(throwing.reported[0]).toBeInstanceOf(RangeError);
  });

  it('fixed texts pass with no judge call: safe, distress, last-resort, hint, locked, ask-teacher (lead answer 3)', async () => {
    const s = setup({ judge: 'ungrounded' });
    for (const text of [
      TEST_SAFE_REPLY,
      TEST_DISTRESS_REPLY,
      LAST_RESORT_DISTRESS_REPLY,
      ANSWER_LEAK_SAFE_HINT,
      lockedReplyText('Free'),
      ASK,
      PREMISE_CORRECTION_REPLY,
    ]) {
      expect(await s.run(text), text).toMatchObject({ result: 'ok' });
    }
    expect(s.judged).toEqual([]);
  });

  it('a failing safe or distress text is reported and simply not on the fixed list', async () => {
    const s = setup({
      judge: 'ungrounded',
      fallbackReplies: {
        distress: () => {
          throw new RangeError('no pack');
        },
      },
    });
    expect(await s.run(TEST_SAFE_REPLY)).toMatchObject({ result: 'ok' });
    expect(s.reported.map((e) => (e as Error).name)).toEqual(['RangeError']);
  });

  it('redirect and locked turns are not judged', async () => {
    const s = setup({ judge: 'ungrounded' });
    for (const move of ['redirect', 'locked'] as const) {
      expect(
        await s.run('Let us get back to your course.', { decision: { ...explain, move } }),
      ).toMatchObject({ result: 'ok' });
    }
    expect(s.judged).toEqual([]);
  });

  it('the overlap judge (non-circular fake) passes material-backed replies and catches invented ones', async () => {
    const s = setup({ judge: overlapJudge });
    expect(
      await s.run('Floor division divides, then rounds down to a whole number [1].'),
    ).toMatchObject({ result: 'ok' });
    expect(
      await s.run('Floor division is faster than normal division on every computer.'),
    ).toMatchObject({ result: 'replace', text: ASK, escalateToTeacher: true });
  });
});

describe('postGuard: three model or port calls in one turn (lead answer 1)', () => {
  // A locked check, answerLeak's rewrite and grounding's judge, at realistic scripted delays.
  // With adviceGuard in the chain (4.8; rules-only weight on this turn, which holds no advice
  // signal) every slice is a little smaller than with three guards: after a ~330 ms rewrite the
  // judge gets about 530 ms of its 600 ms timeout. postGuard.advice.test.ts stacks all four.
  it.each([
    { locked: 100, rewrite: 300, judge: 400 },
    { locked: 120, rewrite: 330, judge: 520 },
    { locked: 140, rewrite: 330, judge: 530 },
  ])(
    'locked $locked ms, rewrite $rewrite ms, judge $judge ms: all three used, done inside the step',
    { timeout: 5_000 },
    async (d) => {
      const s = setup({
        lockedCheckMs: d.locked,
        judgeDelayMs: d.judge,
        rewrites: [[{ type: 'delay', ms: d.rewrite }, say('Look at the last line again.'), used]],
      });
      const t0 = s.clock.now();
      const r = await s.run('Long enough reply for a check: x ends as 16 here.', {
        decision: { ...explain, move: 'hint', mustNotReveal: ['16'] },
      });
      const took = s.clock.now() - t0;
      expect(r).toMatchObject({ result: 'replace', text: 'Look at the last line again.' });
      expect(s.spy.requests.map((q) => q.system)).toEqual([REWRITE_SYSTEM]);
      expect(s.judged).toHaveLength(1);
      expect(took).toBeLessThan(BUDGET);
      // The three calls run one after another and the step takes their sum, nothing more: on the
      // verification pass the short rewrite needs no index call (under 8 tokens) and the judge's
      // verdict on it is remembered.
      expect(took).toBe(d.locked + d.rewrite + d.judge);
    },
  );

  it(
    'every call hanging still ends inside the step, failing closed',
    { timeout: 5_000 },
    async () => {
      const s = setup({
        lockedCheckMs: 60_000,
        judgeDelayMs: 60_000,
        rewrites: [[{ type: 'delay', ms: 60_000 }, say('late'), used]],
      });
      const t0 = s.clock.now();
      const r = await s.run('Long enough reply for a check: x ends as 16 here.', {
        decision: { ...explain, mustNotReveal: ['16'] },
      });
      expect(r).toMatchObject({ result: 'replace' });
      expect(s.clock.now() - t0).toBeLessThan(BUDGET);
    },
  );
});
