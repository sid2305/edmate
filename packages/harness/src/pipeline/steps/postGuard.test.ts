// Tasks 4.5 and 4.6: the postGuard step. Keys and material are synthetic ("16", retrievalWorld).
import type { GuardResult, PedagogyDecision, RetrievalIndex, Usage } from '@edmate/contracts';
import {
  demoPedagogyDecision,
  demoSafetyAlert,
  demoTurnContext,
  demoTurnInput,
  usageSmall,
} from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { ANSWER_LEAK_SAFE_HINT, type PostGuardCtx } from '../../guardrails/answerLeak.js';
import type { Guard } from '../../guardrails/guard.js';
import { LockedLeakDetected, lockedReplyText } from '../../guardrails/lockedLeak.js';
import { GUARD_ORDER } from '../../guardrails/order.js';
import { cancelSource } from '../clock.js';
import { TurnAbort } from '../errors.js';
import { fakeGuard } from '../../testing/guardFixtures.js';
import { type StreamStep, ScriptedGateway } from '../../testing/scriptedGateway.js';
import { spyGateway } from '../../testing/spyGateway.js';
import { memoryRetrieval, retrievalWorld } from '../../testing/memoryRetrieval.js';
import { TEST_SAFE_REPLY, testDeps } from '../../testing/testSteps.js';
import { virtualClock } from '../../testing/virtualClock.js';
import { STEP_SPEC } from '../spec.js';
import type { StepEnv } from '../types.js';
import {
  createPostGuard,
  POST_GUARD_MARGIN_MS,
  PostGuardFailed,
  postGuard,
  postGuardSliceMs,
  REWRITE_SYSTEM,
} from './postGuard.js';

const KEY = '16';
const decision: PedagogyDecision = { ...demoPedagogyDecision, mustNotReveal: [KEY] };
const say = (text: string): StreamStep => ({ type: 'text', text });
const used: StreamStep = { type: 'usage', usage: usageSmall };

function setup(
  rewrites: StreamStep[][] = [],
  o: {
    overBudget?: boolean;
    studentText?: string;
    retrieval?: RetrievalIndex;
    lockedReply?: (lang: string, packageName?: string) => string;
  } = {},
) {
  const clock = virtualClock();
  const spy = spyGateway(
    new ScriptedGateway({ stream: rewrites.map((steps) => ({ steps })) }, clock),
  );
  const { deps } = testDeps({
    clock,
    overrides: o.retrieval === undefined ? {} : { retrieval: o.retrieval },
  });
  if (o.lockedReply !== undefined) {
    deps.fallbackReplies = { ...deps.fallbackReplies, lockedReply: o.lockedReply };
  }
  const reported: unknown[] = [];
  const env: StepEnv = {
    input: { ...demoTurnInput, text: o.studentText ?? 'What is x at the end?' },
    deps,
    cancel: cancelSource().token,
    turnId: 'turn_1',
    gateway: spy,
    usage: {
      record: () => undefined,
      checkBeforeCall: () => {
        if (o.overBudget === true) throw new TurnAbort('turn_cost_exceeded');
      },
    },
    report: (e) => void reported.push(e),
    track: () => undefined,
  };
  const run = (
    draft: string,
    extra: { raw?: string; withheld?: boolean; locked?: 'hit' | 'failed' } = {},
    step = postGuard,
  ) => clock.drive(step(env, { ctx: demoTurnContext, decision, draft, ...extra }));
  return { clock, spy, env, reported, run };
}

const hint = (guards: unknown[], usage: Usage[] = []) => ({
  result: 'replace',
  text: ANSWER_LEAK_SAFE_HINT,
  guards,
  usage,
});
const leakTrace = [
  { name: 'lockedLeak', ok: true },
  { name: 'answerLeak', ok: false, action: 'rewrite' },
  { name: 'lockedLeak', ok: true },
  { name: 'answerLeak', ok: true },
];
const cleanTrace = [
  { name: 'lockedLeak', ok: true },
  { name: 'answerLeak', ok: true },
];

describe('postGuard: answerLeak', () => {
  it('a clean reply is ok', async () => {
    const s = setup();
    expect(await s.run('Trace it line by line. What is x after line two?')).toEqual({
      result: 'ok',
      guards: cleanTrace,
      usage: [],
    });
    expect(s.spy.requests).toEqual([]);
  });

  it('a leak is rewritten once on the small tier, re-checked, and the rewrite replaces the reply', async () => {
    const s = setup([[say('Look at the last line again. '), say('What does it do?'), used]]);
    const r = await s.run('Easy: x ends as 16.');
    expect(r).toEqual({
      result: 'replace',
      text: 'Look at the last line again. What does it do?',
      guards: leakTrace,
      usage: [usageSmall],
    });
    expect(s.spy.requests).toHaveLength(1);
    expect(s.spy.requests[0]).toMatchObject({
      tier: 'small',
      system: REWRITE_SYSTEM,
      messages: [{ role: 'user', content: 'Easy: x ends as 16.' }],
    });
  });

  it('a rewrite that still leaks gives the hint', async () => {
    const s = setup([[say('Fine: sixteen.'), used]]);
    expect(await s.run('x ends as 16.')).toEqual(hint(leakTrace, [usageSmall]));
  });

  it('a rewrite stream that fails gives the hint and is reported', async () => {
    const s = setup([[say('Look'), { type: 'error', code: 'provider_error' }]]);
    expect(await s.run('x ends as 16.')).toEqual(hint(leakTrace));
    expect(s.reported.map((e) => (e as Error).name)).toEqual(['ScriptedProviderError']);
  });

  it('a rewrite that calls a tool gives the hint', async () => {
    const s = setup([
      [{ type: 'tool_call', id: 'c1', name: 'calculator', args: {} }, say('x'), used],
    ]);
    expect(await s.run('x ends as 16.')).toEqual(hint(leakTrace));
  });

  it('a rewrite past its share of the slice gives the hint, inside the step budget', async () => {
    const s = setup([[{ type: 'delay', ms: 60_000 }, say('late'), used]]);
    const t0 = s.clock.now();
    expect(await s.run('x ends as 16.')).toEqual(hint(leakTrace));
    expect(s.clock.now() - t0).toBeLessThan(STEP_SPEC.postGuard.timeoutMs as number);
  });

  it('a turn at its cost ceiling makes no rewrite call: the hint', async () => {
    const s = setup([], { overBudget: true });
    expect(await s.run('x ends as 16.')).toEqual(hint(leakTrace));
    expect(s.spy.requests).toEqual([]);
    expect(s.reported.map((e) => (e as Error).name)).toEqual(['TurnAbort']);
  });

  it('a withheld leak: the chain judges the full model text, and its one rewrite of it is used', async () => {
    const s = setup([[say('Good question. Look at the last line again.'), used]]);
    const r = await s.run('Good question. ', { raw: 'Good question. It is 16.', withheld: true });
    expect(r).toEqual({
      result: 'replace',
      text: 'Good question. Look at the last line again.',
      guards: leakTrace,
      usage: [usageSmall],
    });
    expect(s.spy.requests[0]?.messages).toEqual([
      { role: 'user', content: 'Good question. It is 16.' },
    ]);
  });

  it('a withheld leak whose rewrite fails gives the hint', async () => {
    const s = setup();
    expect(
      await s.run('Good question. ', { raw: 'Good question. It is 16.', withheld: true }),
    ).toEqual(hint(leakTrace));
    expect(s.reported.map((e) => (e as Error).name)).toEqual(['ScriptedGatewayError']);
  });

  it('a withheld leak no guard rewrites (no raw kept) still gives the hint', async () => {
    const s = setup();
    expect(await s.run('Good question. ', { withheld: true })).toEqual(hint(cleanTrace));
  });

  it('a withheld leak still reaches the other post guards: an escalate is caught', async () => {
    const s = setup();
    const step = createPostGuard([
      fakeGuard<PostGuardCtx>('answerLeak', 'post', () => ({ ok: true })),
      fakeGuard<PostGuardCtx>('tone', 'post', (text) =>
        text.includes('hurt')
          ? { ok: false, action: 'escalate', alert: demoSafetyAlert }
          : { ok: true },
      ),
    ]);
    const r = await s.run(
      'Fine. ',
      { raw: 'Fine. I want to hurt myself, 16.', withheld: true },
      step,
    );
    expect(r).toMatchObject({ result: 'escalate', alert: demoSafetyAlert });
    // A failure or block on a known leak is the hint, whoever blocked.
    const blocking = createPostGuard([
      fakeGuard<PostGuardCtx>('tone', 'post', () => ({ ok: false, action: 'block', reason: 'x' })),
    ]);
    expect(await s.run('Fine. ', { raw: 'Fine. 16.', withheld: true }, blocking)).toMatchObject({
      text: ANSWER_LEAK_SAFE_HINT,
    });
    const failing = createPostGuard([
      fakeGuard<PostGuardCtx>('tone', 'post', () => {
        throw new Error('boom');
      }),
    ]);
    expect(await s.run('Fine. ', { raw: 'Fine. 16.', withheld: true }, failing)).toMatchObject({
      text: ANSWER_LEAK_SAFE_HINT,
    });
  });

  it('checks the full model text, not only the shown draft', async () => {
    const s = setup();
    expect(await s.run('Good question. ', { raw: 'Good question. It is 16.' })).toEqual(
      hint(leakTrace),
    );
    // Clean full text: the chain runs on the draft as usual.
    expect(await s.run('Good. ', { raw: 'Good. Try again.', withheld: false })).toMatchObject({
      result: 'ok',
    });
  });

  it('lets the student’s own code be quoted back', async () => {
    const s = setup([], { studentText: 'elif marks >= 80 print Distinction' });
    const step = postGuard;
    const r = await s.clock.drive(
      step(s.env, {
        ctx: demoTurnContext,
        decision: { ...decision, mustNotReveal: ['marks >= 80'] },
        draft: 'Your line marks >= 80 never runs. Why?',
      }),
    );
    expect(r.result).toBe('ok');
  });
});

describe('postGuard: chain outcomes (fake guards)', () => {
  const result = (r: GuardResult) => (): GuardResult => r;
  const g = (name: string, behaviour: () => GuardResult | Promise<GuardResult>) =>
    fakeGuard<PostGuardCtx>(name, 'post', behaviour);

  it('escalate is forwarded with its alert and text', async () => {
    const s = setup();
    const step = createPostGuard([
      g('answerLeak', result({ ok: true })),
      g('tone', result({ ok: false, action: 'escalate', alert: demoSafetyAlert })),
    ]);
    expect(await s.run('draft', {}, step)).toEqual({
      result: 'escalate',
      alert: demoSafetyAlert,
      text: 'draft',
      guards: [
        { name: 'answerLeak', ok: true },
        { name: 'tone', ok: false, action: 'escalate' },
      ],
      usage: [],
    });
  });

  it('a block by another guard gives the safe reply', async () => {
    const s = setup();
    const step = createPostGuard([g('tone', result({ ok: false, action: 'block', reason: 'x' }))]);
    expect(await s.run('draft', {}, step)).toMatchObject({
      result: 'replace',
      text: TEST_SAFE_REPLY,
    });
  });

  it('a block by answerLeak, or after its rewrite, gives the hint', async () => {
    const s = setup();
    const byLeak = createPostGuard([
      g('answerLeak', result({ ok: false, action: 'block', reason: 'x' })),
    ]);
    expect(await s.run('draft', {}, byLeak)).toMatchObject({ text: ANSWER_LEAK_SAFE_HINT });
    const after = createPostGuard([
      g('answerLeak', result({ ok: false, action: 'rewrite', text: 'r', reason: 'x' })),
      g('tone', result({ ok: false, action: 'rewrite', text: 'r2', reason: 'x' })),
    ]);
    expect(await s.run('draft', {}, after)).toMatchObject({ text: ANSWER_LEAK_SAFE_HINT });
  });

  it('a failed chain is reported and fails closed', async () => {
    const s = setup();
    const boom = (): GuardResult => {
      throw new Error('boom');
    };
    expect(await s.run('draft', {}, createPostGuard([g('tone', boom)]))).toMatchObject({
      text: TEST_SAFE_REPLY,
    });
    expect(await s.run('draft', {}, createPostGuard([g('answerLeak', boom)]))).toMatchObject({
      text: ANSWER_LEAK_SAFE_HINT,
    });
    expect(s.reported).toHaveLength(2);
    expect(s.reported[0]).toBeInstanceOf(PostGuardFailed);
    expect(String(s.reported[0])).toBe(
      'PostGuardFailed: post guard chain failed: error (tone) Error',
    );
    expect(String(s.reported[1])).toBe(
      'PostGuardFailed: post guard chain failed: error (answerLeak) Error',
    );
    const leakFailed = createPostGuard([
      g('answerLeak', result({ ok: false, action: 'rewrite', text: 'r', reason: 'x' })),
      g('tone', boom),
    ]);
    expect(await s.run('draft', {}, leakFailed)).toMatchObject({ text: ANSWER_LEAK_SAFE_HINT });
  });

  it('an empty chain fails closed (never an unchecked reply)', async () => {
    const s = setup();
    expect(await s.run('draft', {}, createPostGuard([]))).toMatchObject({
      result: 'replace',
      text: TEST_SAFE_REPLY,
    });
  });
});

describe('postGuard: time', () => {
  it('each guard’s slice is the budget less the margin over two passes of every guard', () => {
    const budget = (STEP_SPEC.postGuard.timeoutMs as number) - POST_GUARD_MARGIN_MS;
    expect(postGuardSliceMs(1)).toBe(budget / 2);
    expect(postGuardSliceMs(6)).toBe(Math.floor(budget / 12));
    expect(postGuardSliceMs(0)).toBe(budget / 2);
  });

  it('a 6-guard chain that rewrites and uses almost all of every slice ends inside the step', async () => {
    const s = setup();
    const slice = postGuardSliceMs(6);
    const slow = (name: string, first: GuardResult): Guard<PostGuardCtx> => {
      let calls = 0;
      return fakeGuard<PostGuardCtx>(name, 'post', async () => {
        await s.clock.sleep(slice - 1);
        return calls++ === 0 ? first : { ok: true };
      });
    };
    const names = GUARD_ORDER.post;
    const guards = names.map((n, i) =>
      slow(n, i === 0 ? { ok: false, action: 'rewrite', text: 'r', reason: 'x' } : { ok: true }),
    );
    const t0 = s.clock.now();
    const r = await s.run('draft', {}, createPostGuard(guards));
    expect(r).toMatchObject({ result: 'replace', text: 'r' });
    expect(r.guards).toHaveLength(12);
    expect(s.clock.now() - t0).toBe(12 * (slice - 1));
    expect(s.clock.now() - t0).toBeLessThan(STEP_SPEC.postGuard.timeoutMs as number);
  });

  it('a hanging guard times out at its slice and fails closed', async () => {
    const s = setup();
    const hang = fakeGuard<PostGuardCtx>('tone', 'post', () => new Promise(() => undefined));
    const t0 = s.clock.now();
    expect(await s.run('draft', {}, createPostGuard([hang]))).toMatchObject({
      text: TEST_SAFE_REPLY,
    });
    expect(s.clock.now() - t0).toBe(postGuardSliceMs(1));
  });
});

describe('postGuard: lockedLeak (4.6)', () => {
  // demoTurnContext: the preview entitlement (allowed mod_test_01), package "Free", name_package.
  const LOCKED = 'Integration by parts: choose u and dv, then integrate.';
  const REPLY = lockedReplyText('Free');
  const world = () => memoryRetrieval({ chunks: retrievalWorld() });
  const hitTrace = [
    { name: 'lockedLeak', ok: false, action: 'rewrite' },
    { name: 'answerLeak', ok: true },
    { name: 'lockedLeak', ok: true },
    { name: 'answerLeak', ok: true },
  ];

  it('a reply holding a locked span is replaced whole by the locked reply, and reported', async () => {
    const r = world();
    const s = setup([], { retrieval: r });
    expect(await s.run(`Good question. Here it is: ${LOCKED} Hope that helps.`)).toEqual({
      result: 'replace',
      text: REPLY,
      guards: hitTrace,
      usage: [],
    });
    expect(REPLY).toContain('Free');
    expect(s.reported).toEqual([new LockedLeakDetected('reply')]);
    expect(r.leakChecks.map((c) => c.scope)).toEqual([
      { teacherId: 'tch_test_01', allowedModuleIds: ['mod_test_01'] },
    ]);
  }, 5_000);

  it('runs before answerLeak: the rewriter never receives a locked span', async () => {
    const s = setup([[say('Look again.'), used]], { retrieval: world() });
    const r = await s.run(`It is 16. ${LOCKED}`);
    expect(r).toMatchObject({ result: 'replace', text: REPLY });
    expect(s.spy.requests).toEqual([]);
    // Withheld answer leak plus locked text in the unseen part: still no rewrite call.
    const w = setup([[say('Look again.'), used]], { retrieval: world() });
    const out = await w.run('Good. ', { raw: `Good. It is 16. ${LOCKED}`, withheld: true });
    expect(out).toMatchObject({ result: 'replace', text: REPLY });
    expect(w.spy.requests).toEqual([]);
  }, 5_000);

  it('a reply with no locked span is checked and passes unchanged', async () => {
    const s = setup([], { retrieval: world() });
    const allowed = 'Fractions name equal parts of a whole, so think about the parts.';
    expect(await s.run(allowed)).toEqual({ result: 'ok', guards: cleanTrace, usage: [] });
  }, 5_000);

  it('the student’s own words quoted back are not a leak', async () => {
    const s = setup([], {
      retrieval: world(),
      studentText: `My notes: "${LOCKED}" Is that right?`,
    });
    expect(await s.run(`You wrote: "${LOCKED}" Let us look at it.`)).toMatchObject({
      result: 'ok',
    });
  }, 5_000);

  it('the stream withheld locked text: the locked reply at once, no chain, no rewrite', async () => {
    const r = world();
    const s = setup([[say('x'), used]], { retrieval: r });
    expect(await s.run('Good. ', { raw: `Good. ${LOCKED} 16.`, locked: 'hit' })).toEqual({
      result: 'replace',
      text: REPLY,
      guards: [{ name: 'lockedLeak', ok: false, action: 'rewrite' }],
      usage: [],
    });
    expect(r.leakChecks).toEqual([]);
    expect(s.spy.requests).toEqual([]);
  }, 5_000);

  it('the stream could not check its text: the safe reply (the hint if an answer leaked too)', async () => {
    const s = setup([], { retrieval: world() });
    const failed = [{ name: 'lockedLeak', ok: false, action: 'failed' }];
    expect(await s.run('Good. ', { locked: 'failed' })).toEqual({
      result: 'replace',
      text: TEST_SAFE_REPLY,
      guards: failed,
      usage: [],
    });
    expect(await s.run('Good. ', { locked: 'failed', withheld: true })).toEqual(hint(failed));
  }, 5_000);

  it('a failing index fails the chain closed: safe reply, reported, no rewrite call', async () => {
    const down = memoryRetrieval({ chunks: [], leakCheck: new Error('index down') });
    const s = setup([[say('Look again.'), used]], { retrieval: down });
    expect(await s.run(`Long enough reply to be checked by the index today.`)).toMatchObject({
      result: 'replace',
      text: TEST_SAFE_REPLY,
    });
    expect(String(s.reported[0])).toBe(
      'PostGuardFailed: post guard chain failed: error (lockedLeak) LockedCheckFailed',
    );
    // An answer leak in it too: still fixed text, and the rewriter never runs.
    expect(await s.run(`It is 16, the reply is long enough to be checked.`)).toMatchObject({
      text: TEST_SAFE_REPLY,
    });
    const withheld = {
      raw: 'Good. It is 16, and the reply is long enough to check.',
      withheld: true,
    };
    expect(await s.run('Good. ', withheld)).toMatchObject({ text: ANSWER_LEAK_SAFE_HINT });
    expect(s.spy.requests).toEqual([]);
  }, 5_000);

  it('a hanging index times out and fails closed inside the step budget', async () => {
    const hang: RetrievalIndex = {
      ...world(),
      leakCheck: () => new Promise(() => undefined),
    };
    const s = setup([], { retrieval: hang });
    const t0 = s.clock.now();
    expect(await s.run('A reply that is long enough to be sent to the index.')).toMatchObject({
      text: TEST_SAFE_REPLY,
    });
    expect(s.clock.now() - t0).toBeLessThan(STEP_SPEC.postGuard.timeoutMs as number);
  }, 5_000);

  it('uses the locale’s locked reply when it gives one, else the built-in one', async () => {
    const calls: [string, string | undefined][] = [];
    const s = setup([], {
      retrieval: world(),
      lockedReply: (lang, name) => {
        calls.push([lang, name]);
        return 'LOCALE LOCKED REPLY';
      },
    });
    expect(await s.run(LOCKED)).toMatchObject({ text: 'LOCALE LOCKED REPLY' });
    expect(calls).toEqual([[demoTurnInput.lang, 'Free']]);

    for (const bad of [() => '  ', () => 'x'.repeat(9_000)]) {
      const b = setup([], { retrieval: world(), lockedReply: bad });
      expect(await b.run(LOCKED)).toMatchObject({ text: REPLY });
    }
    const throwing = setup([], {
      retrieval: world(),
      lockedReply: () => {
        throw new RangeError('locale broke');
      },
    });
    expect(await throwing.run(LOCKED)).toMatchObject({ text: REPLY });
    expect(throwing.reported[0]).toBeInstanceOf(RangeError);
  }, 5_000);

  it('names no package when the teacher chose a generic locked reply', async () => {
    const s = setup([], { retrieval: world() });
    const ctx = {
      ...demoTurnContext,
      pkg: { ...demoTurnContext.pkg, lockedReply: 'generic' as const },
    };
    const r = await s.clock.drive(postGuard(s.env, { ctx, decision, draft: LOCKED }));
    expect(r).toMatchObject({ result: 'replace', text: lockedReplyText() });
  }, 5_000);
});
