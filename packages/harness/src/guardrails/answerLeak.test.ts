// Task 4.5: the answerLeak guard on its own. Keys are synthetic.
import { GuardResultSchema, LIMITS } from '@edmate/contracts';
import { demoPedagogyDecision, demoTurnContext, usageSmall } from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { cancelSource } from '../pipeline/clock.js';
import { virtualClock } from '../testing/virtualClock.js';
import {
  ANSWER_LEAK_SAFE_HINT,
  createAnswerLeakGuard,
  type LeakRewrite,
  type PostGuardCtx,
} from './answerLeak.js';
import { runGuardChain } from './chain.js';
import { postGuards } from './postGuards.js';

const token = cancelSource().token;
const guard = createAnswerLeakGuard();
const ctxFor = (keys: string[], o: Partial<PostGuardCtx> = {}): PostGuardCtx => ({
  ctx: demoTurnContext,
  decision: { ...demoPedagogyDecision, mustNotReveal: keys },
  lockedCheck: () => Promise.resolve(false),
  lockedReply: 'LOCKED REPLY',
  ...o,
});
const run = (text: string, x: PostGuardCtx) => guard.run(text, x, token);
const rewriteTo =
  (text: string | undefined, calls: string[] = []) =>
  (draft: string): Promise<LeakRewrite> => {
    calls.push(draft);
    return Promise.resolve({ text, usage: [usageSmall] });
  };

describe('answerLeak', () => {
  it('is the post phase’s registered answerLeak guard', () => {
    expect(guard.name).toBe('answerLeak');
    expect(guard.phase).toBe('post');
    expect(postGuards.ordered().map((g) => g.name)).toEqual(['lockedLeak', 'answerLeak']);
  });

  it('a clean draft is ok, with no usage', async () => {
    expect(
      await run('Trace each line in order. What is x after line two?', ctxFor(['16'])),
    ).toEqual({ result: { ok: true }, usage: [] });
  });

  it.each([
    ['digits', 'x ends as 16.'],
    ['Devanagari digits', 'x १६ है'],
    ['words', 'it is sixteen'],
    ['Hindi in Latin letters', 'solah'],
    ['base64', 'MTY='],
    ['arithmetic', 'print(8*2)'],
  ])('rewrites to the hint on a %s leak (no rewriter)', async (_n, text) => {
    const r = await run(text, ctxFor(['16']));
    expect(r).toEqual({
      result: { ok: false, action: 'rewrite', text: ANSWER_LEAK_SAFE_HINT, reason: 'answer_key' },
      usage: [],
    });
    expect(GuardResultSchema.safeParse(r.result).success).toBe(true);
  });

  it('uses a clean rewrite, trimmed, and keeps its usage', async () => {
    const calls: string[] = [];
    const r = await run(
      'x is 16.',
      ctxFor(['16'], { rewrite: rewriteTo('  Try the last line again.  ', calls) }),
    );
    expect(calls).toEqual(['x is 16.']);
    expect(r.result).toEqual({
      ok: false,
      action: 'rewrite',
      text: 'Try the last line again.',
      reason: 'answer_key',
    });
    expect(r.usage).toEqual([usageSmall]);
  });

  it.each([
    ['still leaks', 'Sure, it is sixteen.'],
    ['empty', '   '],
    ['failed', undefined],
    ['too long', 'a'.repeat(LIMITS.modelTextMaxLength + 1)],
  ])('falls back to the hint when the rewrite %s', async (_n, text) => {
    const r = await run('x is 16.', ctxFor(['16'], { rewrite: rewriteTo(text) }));
    expect(r.result).toMatchObject({ action: 'rewrite', text: ANSWER_LEAK_SAFE_HINT });
    expect(r.usage).toEqual([usageSmall]);
  });

  it('falls back to the hint when the rewriter throws', async () => {
    const r = await run(
      'x is 16.',
      ctxFor(['16'], { rewrite: () => Promise.reject(new Error('boom')) }),
    );
    expect(r).toEqual({
      result: { ok: false, action: 'rewrite', text: ANSWER_LEAK_SAFE_HINT, reason: 'answer_key' },
      usage: [],
    });
  });

  it('is idempotent: its own output passes a second run, for every one-digit key too', async () => {
    for (const k of [
      '0',
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '16',
      'Warm',
      'n % 2 == 0',
    ]) {
      expect((await run(ANSWER_LEAK_SAFE_HINT, ctxFor([k]))).result.ok, k).toBe(true);
    }
    const first = await run('x is 16.', ctxFor(['16'], { rewrite: rewriteTo('Look again.') }));
    const text = first.result.ok ? '' : (first.result as { text: string }).text;
    expect((await run(text, ctxFor(['16']))).result.ok).toBe(true);
  });

  it('lets the student’s own code back', async () => {
    const x = ctxFor(['marks >= 80'], { studentText: 'elif marks >= 80 print Distinction' });
    expect((await run('Your second line, marks >= 80, never runs.', x)).result.ok).toBe(true);
  });

  it('through the chain: a rewrite is verified on the second pass', async () => {
    const r = await runGuardChain(
      postGuards.ordered(),
      'x is 16.',
      ctxFor(['16'], { rewrite: rewriteTo('Look at the last line.') }),
      { phase: 'post', clock: virtualClock(), timeoutMs: 900 },
    );
    expect(r).toMatchObject({ outcome: 'ok', text: 'Look at the last line.' });
    expect(r.guards).toEqual([
      { name: 'lockedLeak', ok: true },
      { name: 'answerLeak', ok: false, action: 'rewrite' },
      { name: 'lockedLeak', ok: true },
      { name: 'answerLeak', ok: true },
    ]);
  });
});
