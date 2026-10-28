// Task 4.8: the postGuard step with adviceGuard registered (the default chain). Judges are the
// gateway-level fakes (testing/groundingJudge.ts, testing/adviceJudge.ts); all text is synthetic.
import type { Chunk, PedagogyDecision, RetrievalIndex, TurnContext } from '@edmate/contracts';
import {
  demoChunkScored,
  demoPedagogyDecision,
  demoTurnContext,
  demoTurnInput,
  usageSmall,
} from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import {
  ADVICE_JUDGE_SYSTEM,
  ADVICE_REWRITE_SYSTEM,
  adviceFallbackText,
  adviceRedirectReplyText,
} from '../../guardrails/adviceGuard.js';
import { ANSWER_LEAK_SAFE_HINT } from '../../guardrails/answerLeak.js';
import { PREMISE_CORRECTION_REPLY } from '../../guardrails/grounding.js';
import { LockedLeakDetected, lockedReplyText } from '../../guardrails/lockedLeak.js';
import { fenced } from '../../pedagogy/dataText.js';
import { adviceJudgeGateway, type AdviceVerdict, markerJudge } from '../../testing/adviceJudge.js';
import { GROUNDED_VERDICT, judgeGateway, type JudgeVerdict } from '../../testing/groundingJudge.js';
import { memoryRetrieval, retrievalWorld } from '../../testing/memoryRetrieval.js';
import {
  FIXTURE_PROMPT_PACK_VERSION,
  fixturePromptPackSet,
} from '../../testing/promptPackFixtures.js';
import {
  type ScriptedStreamCall,
  ScriptedGateway,
  type StreamStep,
} from '../../testing/scriptedGateway.js';
import { spyGateway } from '../../testing/spyGateway.js';
import { testDeps } from '../../testing/testSteps.js';
import { virtualClock } from '../../testing/virtualClock.js';
import { cancelSource } from '../clock.js';
import { AdviceJudgeUnavailable, DisclaimerLocaleGap, TurnAbort } from '../errors.js';
import type { FallbackReplies, StepEnv } from '../types.js';
import {
  ADVICE_REWRITE_MIN_MS,
  POST_GUARD_BUDGET_MS,
  postGuard,
  REWRITE_SYSTEM,
} from './postGuard.js';

const NOTES = 'Index funds hold many companies, so one company falling hurts less.';
const chunk = (text: string, score = 0.8): Chunk => ({ ...demoChunkScored, text, score });
/** The agent pins the fixture set, so the fixture frame's generic disclaimer is the one used. */
const AGENT = { ...demoTurnContext.agent, promptPackVersion: FIXTURE_PROMPT_PACK_VERSION };
const CTX: TurnContext = { ...demoTurnContext, agent: AGENT, retrieved: [chunk(NOTES)] };
const INVESTING: TurnContext = { ...CTX, agent: { ...AGENT, regulatedSubject: 'investing' } };
const GENERIC = fixturePromptPackSet.frame['generic-disclaimer'];
const INVEST_NOTE = demoTurnContext.locale.regulatedDisclaimers.investing as string;
const FALLBACK = adviceFallbackText(GENERIC);
const REDIRECT = adviceRedirectReplyText();
const explain: PedagogyDecision = { ...demoPedagogyDecision, move: 'explain', mustNotReveal: [] };
const redirect: PedagogyDecision = { ...explain, move: 'redirect' };
const LOCKED = 'Integration by parts: choose u and dv, then integrate.';
/** For the record in the test log (the harness has no DOM or Node types). */
const note = (m: string): void =>
  (globalThis as unknown as { console: { info(s: string): void } }).console.info(m);
const say = (text: string): StreamStep => ({ type: 'text', text });
const used: StreamStep = { type: 'usage', usage: usageSmall };

interface Setup {
  /** Scripted non-judge streams; route them with `match` on the request's system text. */
  streams?: ScriptedStreamCall[];
  grounding?: JudgeVerdict;
  groundingDelayMs?: number;
  advice?: AdviceVerdict | 'script';
  adviceDelayMs?: number;
  studentText?: string;
  lockedCheckMs?: number;
  lockedWorld?: boolean;
  overBudget?: boolean;
  fallbackReplies?: Partial<FallbackReplies>;
}

const rewriteOf = (system: string, text: string, delay = 0): ScriptedStreamCall => ({
  match: (r) => r.system === system,
  steps: [...(delay > 0 ? [{ type: 'delay' as const, ms: delay }] : []), say(text), used],
});
const adviceRewrite = (text: string, delay = 0) => rewriteOf(ADVICE_REWRITE_SYSTEM, text, delay);
const leakRewrite = (text: string, delay = 0) => rewriteOf(REWRITE_SYSTEM, text, delay);

function setup(o: Setup = {}) {
  const clock = virtualClock();
  const spy = spyGateway(new ScriptedGateway({ stream: o.streams ?? [] }, clock));
  const grounded = judgeGateway(spy, o.grounding ?? (() => GROUNDED_VERDICT), {
    clock,
    ...(o.groundingDelayMs === undefined ? {} : { delayMs: o.groundingDelayMs }),
  });
  const advice =
    o.advice === 'script'
      ? undefined
      : adviceJudgeGateway(grounded, o.advice ?? markerJudge, {
          clock,
          ...(o.adviceDelayMs === undefined ? {} : { delayMs: o.adviceDelayMs }),
        });
  const base = memoryRetrieval({ chunks: o.lockedWorld === true ? retrievalWorld() : [] });
  const retrieval: RetrievalIndex = {
    ...base,
    leakCheck: async (...a) => {
      await clock.sleep(o.lockedCheckMs ?? 0);
      return base.leakCheck(...a);
    },
  };
  const { deps } = testDeps({ clock, overrides: { retrieval } });
  deps.fallbackReplies = { ...deps.fallbackReplies, ...o.fallbackReplies };
  const reported: unknown[] = [];
  const env: StepEnv = {
    input: { ...demoTurnInput, text: o.studentText ?? 'How do index funds work?' },
    deps,
    cancel: cancelSource().token,
    turnId: 'turn_1',
    gateway: advice ?? grounded,
    usage: {
      record: () => undefined,
      checkBeforeCall: () => {
        if (o.overBudget === true) throw new TurnAbort('turn_cost_exceeded');
      },
    },
    report: (e) => void reported.push(e),
    track: () => undefined,
  };
  const run = (draft: string, extra: { decision?: PedagogyDecision; ctx?: TurnContext } = {}) =>
    clock.drive(
      postGuard(env, {
        ctx: extra.ctx ?? CTX,
        decision: extra.decision ?? explain,
        draft,
        sources: [chunk(NOTES).source],
      }),
    );
  const systems = () => spy.requests.map((r) => r.system);
  return {
    clock,
    spy,
    reported,
    run,
    systems,
    judged: grounded.judged,
    adviceJudged: advice?.adviceJudged ?? [],
    leakChecks: base.leakChecks,
  };
}

describe('postGuard: adviceGuard on a teaching turn', () => {
  it('a hard hit: one rewrite of the fenced, scrubbed draft, accepted with the disclaimer; no judge, no teacher', async () => {
    const s = setup({
      streams: [adviceRewrite('Index funds spread money across many companies.')],
    });
    const draft = 'You should sell your mutual funds this month. Call me on +91 98765 43210.';
    const r = await s.run(draft, { decision: { ...explain, mustNotReveal: ['SECRETWORD'] } });
    expect(r).toMatchObject({
      result: 'replace',
      text: `Index funds spread money across many companies.\n\n${GENERIC}`,
    });
    expect(r).not.toHaveProperty('escalateToTeacher');
    expect(r).not.toHaveProperty('groundingRewrote');
    expect(s.adviceJudged).toEqual([]);
    const req = s.spy.requests[0];
    expect(req?.system).toBe(ADVICE_REWRITE_SYSTEM);
    expect(req?.tier).toBe('small');
    const content = req?.messages[0]?.content;
    expect(content).toBe(
      fenced('You should sell your mutual funds this month. Call me on [phone].'),
    );
    expect(JSON.stringify(req)).not.toContain('SECRETWORD');
    expect(r.guards.map((g) => `${g.name}:${String(g.ok)}`)).toEqual([
      'lockedLeak:true',
      'answerLeak:true',
      'grounding:true',
      'adviceGuard:false',
      'personaBoundary:true',
      'tone:true',
      'lockedLeak:true',
      'answerLeak:true',
      'grounding:true',
      'adviceGuard:true',
      'personaBoundary:true',
      'tone:true',
    ]);
  });

  it('a Hinglish reply to a decision request: the judge flags it once, the rewrite replaces it; no second judge call on the verification pass', async () => {
    const s = setup({
      studentText: 'Konsi tablet le lun?',
      streams: [adviceRewrite('Doctors choose medicine after looking at the whole picture.')],
    });
    const r = await s.run('Haan, yeh tablet le lo, din mein do baar.');
    expect(r).toMatchObject({
      result: 'replace',
      text: `Doctors choose medicine after looking at the whole picture.\n\n${GENERIC}`,
    });
    expect(s.adviceJudged).toHaveLength(1);
    expect(s.adviceJudged[0]?.system).toBe(ADVICE_JUDGE_SYSTEM);
    expect(s.adviceJudged[0]?.tier).toBe('small');
  });

  it('a rewrite that holds the answer key ends in the answer hint (verification pass)', async () => {
    const s = setup({ streams: [adviceRewrite('Shares are parts of a company; x is 16.')] });
    const r = await s.run('You should buy that stock now.', {
      decision: { ...explain, mustNotReveal: ['16'] },
    });
    expect(r).toMatchObject({ result: 'replace', text: ANSWER_LEAK_SAFE_HINT });
  });

  it('a rewrite that holds locked material ends in the locked reply (verification pass), reported', async () => {
    const s = setup({
      lockedWorld: true,
      streams: [adviceRewrite(`Shares are parts of a company. ${LOCKED}`)],
    });
    const r = await s.run('You should buy that stock now.');
    expect(r).toMatchObject({ result: 'replace', text: lockedReplyText('Free') });
    expect(s.reported).toContainEqual(new LockedLeakDetected('reply'));
  });

  it('the judge times out: the fixed fallback with the disclaimer, a code-only report, no rewrite, no teacher', async () => {
    const s = setup({ studentText: 'Should I buy it?', adviceDelayMs: 60_000 });
    const r = await s.run('Haan, le lo.');
    expect(r).toMatchObject({ result: 'replace', text: FALLBACK });
    expect(r).not.toHaveProperty('escalateToTeacher');
    expect(s.reported).toContainEqual(new AdviceJudgeUnavailable());
    expect(s.systems()).not.toContain(ADVICE_REWRITE_SYSTEM);
  });

  it('the judge call fails (no script) or the turn is at its cost ceiling: the fixed fallback', async () => {
    const failed = setup({ studentText: 'Should I buy it?', advice: 'script' });
    expect(await failed.run('Haan, le lo.')).toMatchObject({ text: FALLBACK });
    expect(failed.reported).toContainEqual(new AdviceJudgeUnavailable());
    // On a teaching turn grounding's judge meets the ceiling first (its safe reply); on a
    // redirect adviceGuard is the only judge, and falls back to the redirect reply.
    const ceiling = setup({ studentText: 'Should I buy it?', overBudget: true });
    expect(await ceiling.run('Haan, le lo.', { decision: redirect })).toMatchObject({
      text: REDIRECT,
    });
    expect(ceiling.reported).toContainEqual(new AdviceJudgeUnavailable());
    expect(ceiling.adviceJudged).toEqual([]);
  });

  it('too little of the slice left after the judge: no rewrite call, the fixed fallback', async () => {
    const s = setup({
      studentText: 'Should I buy it?',
      groundingDelayMs: 350,
      adviceDelayMs: 420,
      streams: [adviceRewrite('never used')],
    });
    const r = await s.run('Haan, le lo.');
    expect(r).toMatchObject({ result: 'replace', text: FALLBACK });
    expect(s.systems()).not.toContain(ADVICE_REWRITE_SYSTEM);
    expect(ADVICE_REWRITE_MIN_MS).toBe(200);
  });

  it('no signal: no advice judge call, the reply passes unchanged', async () => {
    const s = setup();
    // No number either: a bare number is a signal (4.8 fix round 1).
    const r = await s.run('Index funds hold many companies.');
    expect(r).toMatchObject({ result: 'ok' });
    expect(s.adviceJudged).toEqual([]);
  });
});

describe('postGuard: the disclaimer', () => {
  it('a regulated agent asked for a decision: the market disclaimer is appended; grounding ignores it (its judge is asked once)', async () => {
    const s = setup({ studentText: 'Should I invest in index funds?' });
    const draft = 'Index funds hold many companies, so one company falling hurts less [1].';
    const r = await s.run(draft, { ctx: INVESTING });
    expect(r).toMatchObject({ result: 'replace', text: `${draft}\n\n${INVEST_NOTE}` });
    expect(r).not.toHaveProperty('escalateToTeacher');
    // The market has an investing text: no locale-gap metric.
    expect(s.reported.filter((e) => e instanceof DisclaimerLocaleGap)).toEqual([]);
    expect(s.judged).toHaveLength(1);
    expect(s.adviceJudged).toHaveLength(1);
  });

  it('the generic disclaimer comes from the pinned prompt-pack set; an unknown set falls back to the built-in copy', async () => {
    const s = setup({ studentText: 'What dose should I take?' });
    const health = { ...CTX, agent: { ...AGENT, regulatedSubject: 'health' as const } };
    const r = await s.run('Doses depend on many things [1].', { ctx: health });
    expect(r).toMatchObject({ text: `Doses depend on many things [1].\n\n${GENERIC}` });
    // A regulated agent whose market has no text for its subject: a code-only metric (fix round 1).
    const gap = s.reported.filter((e) => e instanceof DisclaimerLocaleGap);
    expect(gap).toEqual([new DisclaimerLocaleGap('health')]);
    expect((gap[0] as DisclaimerLocaleGap).message).not.toContain('Doses');

    const t = setup({ studentText: 'What dose should I take?' });
    const unknown = { ...health, agent: { ...health.agent, promptPackVersion: '9.9.9' } };
    const out = await t.run('Doses depend on many things [1].', { ctx: unknown });
    expect(out).toMatchObject({
      text:
        'Doses depend on many things [1].\n\nThis is general education, not personal advice. ' +
        'For your own situation, talk to a qualified professional.',
    });
  });
});

describe('postGuard: redirect replies (4.7 safety review)', () => {
  const STUDENT = 'Python chhodo, mere paas 10,000 rupees hain, kaunsa stock khareedun?';
  const ADVICE = 'Python chhodo! Yeh wala stock khareed lo, pakka double hoga.';

  it('a redirect that answers the advice anyway gets the redirect reply: no rewrite, no teacher', async () => {
    const s = setup({ studentText: STUDENT });
    const r = await s.run(ADVICE, { decision: redirect });
    expect(r).toMatchObject({ result: 'replace', text: REDIRECT });
    expect(r).not.toHaveProperty('escalateToTeacher');
    expect(s.spy.requests).toEqual([]);
    // grounding does not judge redirects; adviceGuard does.
    expect(s.judged).toEqual([]);
    expect(s.adviceJudged).toHaveLength(1);
  });

  it('the locale’s redirect reply is used; an empty or failing one gives the built-in one (reported)', async () => {
    const own = 'Locale redirect: let us get back to the course.';
    const s = setup({ studentText: STUDENT, fallbackReplies: { redirect: () => own } });
    expect(await s.run(ADVICE, { decision: redirect })).toMatchObject({ text: own });
    const empty = setup({ studentText: STUDENT, fallbackReplies: { redirect: () => ' ' } });
    expect(await empty.run(ADVICE, { decision: redirect })).toMatchObject({ text: REDIRECT });
    const boom = new Error('locale down');
    const failing = setup({
      studentText: STUDENT,
      fallbackReplies: {
        redirect: () => {
          throw boom;
        },
      },
    });
    expect(await failing.run(ADVICE, { decision: redirect })).toMatchObject({ text: REDIRECT });
    expect(failing.reported).toContain(boom);
  });

  it('a clean redirect passes unchanged', async () => {
    const s = setup({ studentText: STUDENT });
    const clean =
      "That's outside this course, so I can't help with it here. Shall we get back to Python?";
    expect(await s.run(clean, { decision: redirect })).toMatchObject({ result: 'ok' });
  });
});

describe('postGuard: adviceGuard’s fixed texts pass every guard', () => {
  it('the fallback: no index call, no judge, even when a word of it is in the answer key', async () => {
    const s = setup({ lockedWorld: true, studentText: 'Should I buy it?' });
    const r = await s.run(FALLBACK, { decision: { ...explain, mustNotReveal: ['general'] } });
    expect(r).toMatchObject({ result: 'ok' });
    expect(s.leakChecks).toEqual([]);
    expect(s.judged).toEqual([]);
    expect(s.adviceJudged).toEqual([]);
  });

  it('the redirect reply, on a teaching turn too', async () => {
    const s = setup({ lockedWorld: true, studentText: 'Should I buy it?' });
    expect(await s.run(REDIRECT)).toMatchObject({ result: 'ok' });
    expect(s.leakChecks).toEqual([]);
    expect(s.judged).toEqual([]);
  });

  it('grounding’s PREMISE_CORRECTION_REPLY passes untouched, even on a regulated agent (item 7)', async () => {
    const s = setup({ studentText: 'Should I buy it?' });
    const r = await s.run(PREMISE_CORRECTION_REPLY, { ctx: INVESTING });
    expect(r).toMatchObject({ result: 'ok' });
    expect(s.judged).toEqual([]);
    expect(s.adviceJudged).toEqual([]);
  });
});

describe('postGuard: four judge-capable guards in one turn (lead answer 11)', () => {
  // A locked check (its own 150 ms cap), answerLeak's rewrite, grounding's judge, adviceGuard's
  // judge and adviceGuard's rewrite, each model call at `ms`. The reply leaks the key; the leak
  // rewrite brings in advice. Whatever each slice allows, the step ends inside its budget and
  // nothing unsafe is shown.
  it.each([300, 450, 600])(
    'model calls at %i ms: done inside the 2 s step, nothing unsafe shown',
    { timeout: 20_000 },
    async (ms) => {
      const s = setup({
        studentText: 'Should I buy shares with my savings?',
        lockedCheckMs: 120,
        groundingDelayMs: ms,
        adviceDelayMs: ms,
        streams: [
          leakRewrite('Look at the last line again. Haan, yeh coin le lo.', ms),
          adviceRewrite('Look at the last line again.', ms),
        ],
      });
      const t0 = s.clock.now();
      const r = await s.run('Long enough reply for a check: x ends as 16 here.', {
        decision: { ...explain, move: 'hint', mustNotReveal: ['16'] },
      });
      const took = s.clock.now() - t0;
      expect(took).toBeLessThan(POST_GUARD_BUDGET_MS);
      expect(r).toMatchObject({ result: 'replace' });
      const shown = 'text' in r ? r.text : '';
      expect(shown).not.toContain('16');
      expect(shown).not.toContain('le lo');
      note(
        `4.8 stacking at ${String(ms)} ms: ${String(took)} ms; calls: ` +
          `${
            s
              .systems()
              .map((x) => (x === REWRITE_SYSTEM ? 'leak-rewrite' : 'advice-rewrite'))
              .join(', ') || 'none'
          }, ` +
          `grounding judge ${String(s.judged.length)}, advice judge ${String(s.adviceJudged.length)}; ` +
          `shown: ${shown === ANSWER_LEAK_SAFE_HINT ? 'hint' : shown.slice(0, 40)}`,
      );
    },
  );

  it(
    'all five calls made in one turn (leak rewrite 200 ms, judges 220 ms, advice rewrite 180 ms), inside the step, failing closed',
    { timeout: 20_000 },
    async () => {
      const s = setup({
        studentText: 'Should I buy shares with my savings?',
        lockedCheckMs: 80,
        groundingDelayMs: 220,
        adviceDelayMs: 220,
        streams: [
          leakRewrite('Look at the last line again. Haan, yeh coin le lo.', 200),
          adviceRewrite('Look at the last line again.', 180),
        ],
      });
      const t0 = s.clock.now();
      const r = await s.run('Long enough reply for a check: x ends as 16 here.', {
        decision: { ...explain, move: 'hint', mustNotReveal: ['16'] },
      });
      const took = s.clock.now() - t0;
      expect(s.systems()).toEqual([REWRITE_SYSTEM, ADVICE_REWRITE_SYSTEM]);
      expect(s.judged.length).toBeGreaterThanOrEqual(1);
      expect(s.adviceJudged).toHaveLength(1);
      expect(took).toBeLessThan(POST_GUARD_BUDGET_MS);
      const shown = 'text' in r ? r.text : '';
      expect(shown).not.toContain('16');
      expect(shown).not.toContain('le lo');
      note(`4.8 all five calls: ${String(took)} ms; shown: ${shown.slice(0, 40)}`);
    },
  );

  it(
    'a decision request on a teaching turn at 260 ms: grounding judge, advice judge and advice rewrite all used, inside the step',
    { timeout: 20_000 },
    async () => {
      const s = setup({
        studentText: 'Should I buy shares with my savings?',
        lockedCheckMs: 100,
        groundingDelayMs: 260,
        adviceDelayMs: 260,
        streams: [adviceRewrite('Shares are parts of a company.', 260)],
      });
      const t0 = s.clock.now();
      const r = await s.run('Index funds hold many companies [1]. Haan, yeh fund le lo.');
      const took = s.clock.now() - t0;
      expect(s.judged.length).toBeGreaterThanOrEqual(1);
      expect(s.adviceJudged).toHaveLength(1);
      expect(s.systems()).toEqual([ADVICE_REWRITE_SYSTEM]);
      expect(took).toBeLessThan(POST_GUARD_BUDGET_MS);
      expect('text' in r ? r.text : '').not.toContain('le lo');
      note(`4.8 grounding + advice judge + advice rewrite at 260 ms: ${String(took)} ms`);
    },
  );

  it(
    'every call hanging still ends inside the step, failing closed',
    { timeout: 20_000 },
    async () => {
      const s = setup({
        studentText: 'Should I buy shares?',
        lockedCheckMs: 60_000,
        groundingDelayMs: 60_000,
        adviceDelayMs: 60_000,
        streams: [leakRewrite('late', 60_000), adviceRewrite('late', 60_000)],
      });
      const t0 = s.clock.now();
      const r = await s.run('Long enough reply for a check: x ends as 16 here. Yeh le lo.', {
        decision: { ...explain, mustNotReveal: ['16'] },
      });
      expect(r).toMatchObject({ result: 'replace' });
      expect(s.clock.now() - t0).toBeLessThan(POST_GUARD_BUDGET_MS);
    },
  );
});
