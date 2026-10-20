import { type GuardResult, LIMITS, TurnTraceSchema, type Usage } from '@edmate/contracts';
import { demoSafetyAlert, usageMain, usageSmall } from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { cancelSource } from '../pipeline/clock.js';
import { fakeGuard } from '../testing/guardFixtures.js';
import { prng } from '../testing/prng.js';
import { type VirtualClock, virtualClock } from '../testing/virtualClock.js';
import {
  type GuardChainOptions,
  type GuardChainResult,
  type GuardFailure,
  type GuardOutcomeEvent,
  runGuardChain,
} from './chain.js';
import type { Guard } from './guard.js';
import { GUARD_ORDER, type GuardPhase } from './order.js';
import { GuardRegistry } from './registry.js';

const OK = { ok: true } as const satisfies GuardResult;
const BLOCK = { ok: false, action: 'block', reason: 'secret block reason' } as const;
const rewrite = (text: string): GuardResult => ({
  ok: false,
  action: 'rewrite',
  text,
  reason: 'secret rewrite reason',
});
const ESCALATE = { ok: false, action: 'escalate', alert: demoSafetyAlert } as const;

interface Ctx {
  readonly tag: string;
}
const CTX: Ctx = { tag: 'ctx' };
const SLICE_MS = 50;

function setup(phase: GuardPhase, extra: Partial<GuardChainOptions> = {}) {
  const clock = virtualClock({ start: 0 });
  const opts: GuardChainOptions = { phase, clock, timeoutMs: SLICE_MS, ...extra };
  const run = (guards: readonly Guard<Ctx>[], text = 'hello') =>
    clock.drive(runGuardChain(guards, text, CTX, opts));
  return { clock, run };
}

/** A guard with full control over `run`, for results the typed fixture can't express. */
function rawGuard(name: string, phase: GuardPhase, run: Guard<Ctx>['run']): Guard<Ctx> {
  return { name, phase, run };
}

const failureOf = (r: GuardChainResult): GuardFailure | undefined =>
  r.outcome === 'failed' ? r.failure : undefined;
const textOf = (r: GuardChainResult): string | undefined =>
  r.outcome === 'ok' || r.outcome === 'escalate' ? r.text : undefined;
const parsesAsTrace = (r: GuardChainResult): void => {
  expect(TurnTraceSchema.shape.guards.parse(r.guards)).toEqual(r.guards);
};

describe('runGuardChain: declared order', () => {
  it('runs guards in GUARD_ORDER order, whatever the registration order', async () => {
    const calls: string[] = [];
    const r = new GuardRegistry<Ctx>('post');
    for (const n of [
      'tone',
      'grounding',
      'lockedLeak',
      'personaBoundary',
      'adviceGuard',
      'answerLeak',
    ]) {
      r.register(fakeGuard<Ctx>(n, 'post', OK, { spy: calls }));
    }
    const { run } = setup('post');
    const res = await run(r.ordered());
    expect(calls).toEqual(GUARD_ORDER.post);
    expect(res.outcome).toBe('ok');
    expect(res.guards.map((g) => g.name)).toEqual(GUARD_ORDER.post);
  });

  it('passes the same ctx to every guard and returns the input text when all pass', async () => {
    const a = fakeGuard<Ctx>('distressDetect', 'pre', OK);
    const b = fakeGuard<Ctx>('jailbreak', 'pre', OK);
    const { run } = setup('pre');
    const res = await run([a, b], 'two plus two');
    expect(res).toEqual({
      outcome: 'ok',
      text: 'two plus two',
      guards: [
        { name: 'distressDetect', ok: true },
        { name: 'jailbreak', ok: true },
      ],
      usage: [],
    });
    expect(a.calls).toEqual([{ text: 'two plus two', ctx: CTX }]);
    expect(b.calls[0]?.ctx).toBe(CTX);
  });

  it('an empty chain fails closed (cause empty), never a silent pass', async () => {
    const { run } = setup('scrub');
    const res = await run([], 'x');
    expect(res).toEqual({
      outcome: 'failed',
      failure: { name: '(empty chain)', cause: 'empty' },
      guards: [{ name: '(empty chain)', ok: false, action: 'failed' }],
      usage: [],
    });
    parsesAsTrace(res);
  });

  it('fails closed before running anything when the list is out of declared order', async () => {
    const a = fakeGuard<Ctx>('distressDetect', 'pre', OK);
    const b = fakeGuard<Ctx>('jailbreak', 'pre', OK);
    const { run } = setup('pre');
    const res = await run([b, a]);
    expect(res.outcome).toBe('failed');
    expect(failureOf(res)).toEqual({ name: 'distressDetect', cause: 'out_of_order' });
    expect(res.guards).toEqual([{ name: 'distressDetect', ok: false, action: 'failed' }]);
    expect(a.calls).toEqual([]);
    expect(b.calls).toEqual([]);
  });

  it('fails closed on a duplicate guard in the list', async () => {
    const a = fakeGuard<Ctx>('jailbreak', 'pre', OK);
    const { run } = setup('pre');
    const res = await run([a, a]);
    expect(failureOf(res)?.cause).toBe('out_of_order');
    expect(a.calls).toEqual([]);
  });

  it('fails closed on an unknown guard; the trace names it (undeclared), never its name', async () => {
    const a = fakeGuard<Ctx>('distressDetect', 'pre', OK);
    const unknown = fakeGuard<Ctx>('secret-name', 'pre', OK);
    const { run } = setup('pre');
    const res = await run([a, unknown]);
    expect(res.outcome).toBe('failed');
    expect(failureOf(res)).toEqual({ name: 'secret-name', cause: 'undeclared' });
    expect(res.guards).toEqual([{ name: '(undeclared)', ok: false, action: 'failed' }]);
    expect(a.calls).toEqual([]);
  });

  it('caps an undeclared name at 100 characters in the failure', async () => {
    const { run } = setup('pre');
    const res = await run([fakeGuard<Ctx>('x'.repeat(500), 'pre', OK)]);
    expect(failureOf(res)?.name).toBe('x'.repeat(100));
  });

  it('fails closed on a guard from another phase, even with a declared name', async () => {
    const tone = fakeGuard<Ctx>('tone', 'post', OK);
    const { run } = setup('pre');
    expect(failureOf(await run([tone]))).toEqual({ name: 'tone', cause: 'undeclared' });
    // A guard object that claims the right phase but carries a post-phase name.
    const sneaky = fakeGuard<Ctx>('tone', 'pre', OK);
    expect(failureOf(await run([sneaky]))).toEqual({ name: 'tone', cause: 'undeclared' });
    expect(tone.calls).toEqual([]);
    expect(sneaky.calls).toEqual([]);
  });

  it('fails closed on a malformed guard entry without throwing', async () => {
    const { run } = setup('pre');
    for (const bad of [null, undefined, {}, { name: 'jailbreak', phase: 'pre' }, { name: 3 }]) {
      const res = await run([bad as never]);
      expect(res.outcome).toBe('failed');
      expect(failureOf(res)?.cause).toBe('undeclared');
      parsesAsTrace(res);
    }
  });

  it('fails closed on an unknown phase, with or without guards', async () => {
    const { run } = setup('mid' as never);
    const res = await run([fakeGuard<Ctx>('jailbreak', 'pre', OK)]);
    expect(failureOf(res)).toEqual({ name: 'jailbreak', cause: 'undeclared' });
    expect(failureOf(await run([]))).toEqual({ name: '(empty chain)', cause: 'undeclared' });
  });

  it('a guard whose name getter throws fails closed as invalid, with or without a bad phase', async () => {
    const hostile = Object.defineProperty({ phase: 'pre', run: () => Promise.resolve() }, 'name', {
      get(): never {
        throw new Error('name getter');
      },
    }) as never;
    const pre = setup('pre');
    const res = await pre.run([hostile]);
    expect(failureOf(res)).toEqual({ name: '(invalid guard)', cause: 'undeclared' });
    expect(res.guards).toEqual([{ name: '(undeclared)', ok: false, action: 'failed' }]);
    const mid = setup('mid' as never);
    expect(failureOf(await mid.run([hostile]))?.name).toBe('(invalid guard)');
    expect(failureOf(await mid.run([{ name: 7 } as never]))?.name).toBe('(invalid guard)');
    expect(failureOf(await mid.run([null as never]))?.name).toBe('(invalid guard)');
  });

  it('reads each guard once: a list or name changed while the chain runs has no effect', async () => {
    const reads: string[] = [];
    let flips = 0;
    const shifty = {
      phase: 'pre' as const,
      get name(): string {
        reads.push('name');
        return flips++ === 0 ? 'distressDetect' : 'secret-other';
      },
      run: () => Promise.resolve({ result: OK, usage: [] }),
    };
    const list: Guard<Ctx>[] = [shifty, fakeGuard<Ctx>('jailbreak', 'pre', OK)];
    const { clock } = setup('pre');
    const pending = runGuardChain(list, 'hi', CTX, { phase: 'pre', clock, timeoutMs: SLICE_MS });
    list.length = 0; // the caller mutates its array after the call
    const res = await clock.drive(pending);
    expect(res.outcome).toBe('ok');
    expect(res.guards.map((g) => g.name)).toEqual(['distressDetect', 'jailbreak']);
    expect(reads).toEqual(['name']);
  });
});

describe('runGuardChain: fail closed', () => {
  it('a guard that throws fails the chain; later guards never run; no raw error kept', async () => {
    const boom = new RangeError('model said: secret text');
    const a = rawGuard('distressDetect', 'pre', () => Promise.reject(boom));
    const b = fakeGuard<Ctx>('moderationIn', 'pre', OK);
    const { run } = setup('pre');
    const res = await run([a, b]);
    expect(res).toEqual({
      outcome: 'failed',
      failure: { name: 'distressDetect', cause: 'error', errorName: 'RangeError' },
      guards: [{ name: 'distressDetect', ok: false, action: 'failed' }],
      usage: [],
    });
    expect(JSON.stringify(res)).not.toContain('secret');
    expect(b.calls).toEqual([]);
  });

  it('a guard that throws synchronously also fails the chain', async () => {
    const a = rawGuard('jailbreak', 'pre', () => {
      throw new TypeError('sync');
    });
    const { run } = setup('pre');
    expect(failureOf(await run([a]))).toEqual({
      name: 'jailbreak',
      cause: 'error',
      errorName: 'TypeError',
    });
  });

  it.each<[string, unknown, string]>([
    ['a string', 'secret text', 'string'],
    ['undefined', undefined, 'undefined'],
    ['null', null, 'object'],
    ['a plain object', { message: 'secret' }, 'object'],
    [
      'an Error with a long name',
      Object.assign(new Error('x'), { name: 'N'.repeat(300) }),
      'N'.repeat(100),
    ],
    ['an Error whose name is not a string', Object.assign(new Error('x'), { name: 42 }), 'Error'],
  ])('a rejection with %s records only a capped error name', async (_l, thrown, errorName) => {
    const a = rawGuard('jailbreak', 'pre', () => Promise.reject(thrown));
    const { run } = setup('pre');
    const res = await run([a]);
    expect(failureOf(res)).toEqual({ name: 'jailbreak', cause: 'error', errorName });
    expect(JSON.stringify(res)).not.toContain('secret');
  });

  it('an Error whose name getter throws records "unknown"', async () => {
    const e = new Error('x');
    Object.defineProperty(e, 'name', {
      get(): never {
        throw new Error('getter');
      },
    });
    const a = rawGuard('jailbreak', 'pre', () => Promise.reject(e));
    const { run } = setup('pre');
    expect(failureOf(await run([a]))?.errorName).toBe('unknown');
  });

  const invalid: [string, unknown][] = [
    ['undefined', undefined],
    ['null', null],
    ['a string', 'ok'],
    ['a bare GuardResult with no usage', { ok: true }],
    ['no result', { usage: [] }],
    ['ok:false with no action', { result: { ok: false }, usage: [] }],
    ['block with no reason', { result: { ok: false, action: 'block' }, usage: [] }],
    ['an unknown action', { result: { ok: false, action: 'allow', reason: 'r' }, usage: [] }],
    ['ok:true with an extra key', { result: { ok: true, action: 'block' }, usage: [] }],
    ['ok as a string', { result: { ok: 'true' }, usage: [] }],
    [
      'a reason over the cap',
      {
        result: {
          ok: false,
          action: 'block',
          reason: 'r'.repeat(LIMITS.guardReasonMaxLength + 1),
        },
        usage: [],
      },
    ],
    [
      'rewrite text over the cap',
      {
        result: {
          ok: false,
          action: 'rewrite',
          reason: 'r',
          text: 't'.repeat(LIMITS.modelTextMaxLength + 1),
        },
        usage: [],
      },
    ],
    ['rewrite with no text', { result: { ok: false, action: 'rewrite', reason: 'r' }, usage: [] }],
    [
      'escalate with a bad alert',
      { result: { ok: false, action: 'escalate', alert: { id: 'x' } }, usage: [] },
    ],
    ['usage not an array', { result: { ok: true }, usage: usageSmall }],
    ['a malformed usage entry', { result: { ok: true }, usage: [{ model: 'm' }] }],
    ['an extra top-level key', { result: { ok: true }, usage: [], note: 'x' }],
  ];
  it.each(invalid)(
    'a guard returning %s fails with cause invalid_result',
    async (_label, value) => {
      const a = rawGuard('lockedLeak', 'post', () => Promise.resolve(value as never));
      const b = fakeGuard<Ctx>('tone', 'post', OK);
      const { run } = setup('post');
      const res = await run([a, b]);
      expect(res).toEqual({
        outcome: 'failed',
        failure: { name: 'lockedLeak', cause: 'invalid_result' },
        guards: [{ name: 'lockedLeak', ok: false, action: 'failed' }],
        usage: [],
      });
      expect(b.calls).toEqual([]);
    },
  );

  it('a result whose getter throws while being checked fails as an error', async () => {
    const hostile = {
      get result(): never {
        throw new Error('getter');
      },
      usage: [],
    };
    const a = rawGuard('tone', 'post', () => Promise.resolve(hostile as never));
    const { run } = setup('post');
    expect(failureOf(await run([a]))?.cause).toBe('error');
  });

  it('a guard past its own time slice fails; later guards never run', async () => {
    let cancelled = false;
    const slow = rawGuard('moderationIn', 'pre', (_t, _c, cancel) => {
      cancel.onCancel(() => {
        cancelled = true;
      });
      return new Promise(() => undefined); // never settles
    });
    const after = fakeGuard<Ctx>('jailbreak', 'pre', OK);
    const { run, clock } = setup('pre');
    const res = await run([slow, after]);
    expect(res.outcome).toBe('failed');
    expect(failureOf(res)).toEqual({ name: 'moderationIn', cause: 'timeout' });
    expect(clock.now()).toBe(SLICE_MS);
    expect(cancelled).toBe(true);
    expect(after.calls).toEqual([]);
    expect(clock.pending).toBe(0);
  });

  it('the slice is per guard, not shared: three guards each under the slice all pass', async () => {
    const clockRef: { c?: VirtualClock } = {};
    const sleepy = (name: string) =>
      rawGuard(name, 'pre', async (_t, _c, cancel) => {
        await clockRef.c?.sleep(SLICE_MS - 1, cancel);
        return { result: OK, usage: [] };
      });
    const { run, clock } = setup('pre');
    clockRef.c = clock;
    const res = await run([sleepy('distressDetect'), sleepy('moderationIn'), sleepy('jailbreak')]);
    expect(res.outcome).toBe('ok');
    expect(clock.now()).toBe(3 * (SLICE_MS - 1));
  });

  it('a late result after the slice is ignored (the guard has already failed)', async () => {
    const clockRef: { c?: VirtualClock } = {};
    const late = rawGuard('tone', 'post', async () => {
      await clockRef.c?.sleep(SLICE_MS + 10);
      return { result: OK, usage: [usageSmall] };
    });
    const { run, clock } = setup('post');
    clockRef.c = clock;
    const res = await run([late]);
    expect(failureOf(res)?.cause).toBe('timeout');
    expect(res.usage).toEqual([]);
  });

  it.each([0, -1, Number.NaN, Number.NEGATIVE_INFINITY])(
    'a non-positive or invalid slice (%s) fails without running the guard',
    async (timeoutMs) => {
      const a = fakeGuard<Ctx>('jailbreak', 'pre', OK);
      const { run } = setup('pre', { timeoutMs });
      const res = await run([a]);
      expect(failureOf(res)).toEqual({ name: 'jailbreak', cause: 'timeout' });
      expect(a.calls).toEqual([]);
    },
  );

  it('an already-cancelled step runs no guard and fails', async () => {
    const src = cancelSource();
    src.cancel();
    const a = fakeGuard<Ctx>('distressDetect', 'pre', OK);
    const { run } = setup('pre', { cancel: src.token });
    const res = await run([a]);
    expect(failureOf(res)).toEqual({ name: 'distressDetect', cause: 'cancelled' });
    expect(res.guards).toEqual([{ name: 'distressDetect', ok: false, action: 'failed' }]);
    expect(a.calls).toEqual([]);
  });

  it('a step cancelled while a guard runs fails after it, even if the guard said ok', async () => {
    const src = cancelSource();
    const a = rawGuard('distressDetect', 'pre', () => {
      src.cancel();
      return Promise.resolve({ result: OK, usage: [usageSmall] });
    });
    const b = fakeGuard<Ctx>('jailbreak', 'pre', OK);
    const { run } = setup('pre', { cancel: src.token });
    const res = await run([a, b]);
    expect(failureOf(res)).toEqual({ name: 'distressDetect', cause: 'cancelled' });
    expect(res.usage).toEqual([usageSmall]);
    expect(b.calls).toEqual([]);
  });

  it('a cancelled step cancels the in-flight guard and stops waiting at once', async () => {
    const src = cancelSource();
    let guardSawCancel = false;
    const hung = rawGuard('moderationIn', 'pre', (_t, _c, cancel) => {
      cancel.onCancel(() => {
        guardSawCancel = true;
      });
      return new Promise(() => undefined); // ignores the cancel and never settles
    });
    const { run, clock } = setup('pre', { cancel: src.token });
    void clock.sleep(10).then(() => src.cancel());
    const res = await run([hung]);
    expect(failureOf(res)).toEqual({ name: 'moderationIn', cause: 'cancelled' });
    expect(guardSawCancel).toBe(true);
    expect(clock.now()).toBe(10);
    expect(clock.pending).toBe(0);
  });

  it(
    'never outputs ok unless every guard passed on the final text (seeded, 2000 chains)',
    { timeout: 20_000 },
    async () => {
      const rng = prng(4101);
      const kinds = ['ok', 'block', 'rewrite', 'escalate', 'throw', 'invalid'] as const;
      for (let i = 0; i < 2000; i++) {
        const n = 1 + rng.int(GUARD_ORDER.post.length);
        const names = GUARD_ORDER.post.slice(0, n);
        const plan = names.map(() => rng.pick(kinds));
        const guards = names.map((name, j) =>
          rawGuard(name, 'post', () => {
            const k = plan[j];
            if (k === 'throw') throw new Error('x');
            if (k === 'invalid') {
              return Promise.resolve({ result: { ok: false }, usage: [] } as never);
            }
            const result =
              k === 'ok'
                ? OK
                : k === 'block'
                  ? BLOCK
                  : k === 'rewrite'
                    ? rewrite(`r${j}`)
                    : ESCALATE;
            return Promise.resolve({ result, usage: [usageSmall] });
          }),
        );
        const { run } = setup('post');
        const res = await run(guards, 'draft');
        parsesAsTrace(res);
        const stop = plan.findIndex((k) => k !== 'ok' && k !== 'rewrite');
        const firstRewrite = plan.indexOf('rewrite');
        if (stop !== -1) {
          const k = plan[stop];
          const expected = k === 'escalate' ? 'escalate' : k === 'block' ? 'block' : 'failed';
          expect(res.outcome).toBe(expected);
          expect(res.guards).toHaveLength(stop + 1);
        } else if (firstRewrite !== -1) {
          // The rewriting guard rewrites again on the verification pass: unverified, block.
          expect(res).toMatchObject({ outcome: 'block', cause: 'rewrite_unverified' });
          expect(res.guards).toHaveLength(n + firstRewrite + 1);
        } else {
          expect(res.outcome).toBe('ok');
          expect(res.guards).toHaveLength(n);
        }
      }
    },
  );
});

describe('runGuardChain: rewrite and the verification pass', () => {
  // Rewrites only text it has not rewritten yet, so the verification pass sees its own output.
  const once = (from: string, to: string) => (t: string) => (t === from ? rewrite(to) : OK);

  it('rewrite returns the replacement text; a clean verification pass keeps it', async () => {
    const a = fakeGuard<Ctx>('lockedLeak', 'post', once('the answer is 42', 'a safer hint'));
    const b = fakeGuard<Ctx>('tone', 'post', OK);
    const { run } = setup('post');
    const res = await run([a, b], 'the answer is 42');
    expect(res).toEqual({
      outcome: 'ok',
      text: 'a safer hint',
      guards: [
        { name: 'lockedLeak', ok: false, action: 'rewrite' },
        { name: 'tone', ok: true },
        { name: 'lockedLeak', ok: true },
        { name: 'tone', ok: true },
      ],
      usage: [],
    });
    expect(b.calls.map((c) => c.text)).toEqual(['a safer hint', 'a safer hint']);
    expect(a.calls.map((c) => c.text)).toEqual(['the answer is 42', 'a safer hint']);
  });

  it('two rewrites compose: the second sees the first and its text is final', async () => {
    const a = fakeGuard<Ctx>('lockedLeak', 'post', once('draft', 'draft +a'));
    const b = fakeGuard<Ctx>('answerLeak', 'post', once('draft +a', 'draft +a +b'));
    const { run } = setup('post');
    const res = await run([a, b], 'draft');
    expect(textOf(res)).toBe('draft +a +b');
    expect(b.calls[0]?.text).toBe('draft +a');
    expect(res.outcome).toBe('ok');
  });

  it('a later rewrite that puts the withheld answer back is caught by an earlier guard', async () => {
    // The first post guard passes the draft; grounding then rewrites the withheld text back in.
    const lockedLeak = fakeGuard<Ctx>('lockedLeak', 'post', (t) =>
      t.includes('42') ? rewrite('try the next step') : OK,
    );
    const answerLeak = fakeGuard<Ctx>('answerLeak', 'post', OK);
    const grounding = fakeGuard<Ctx>('grounding', 'post', once('draft', 'the answer is 42'));
    const tone = fakeGuard<Ctx>('tone', 'post', OK);
    const { run } = setup('post');
    const res = await run([lockedLeak, answerLeak, grounding, tone], 'draft');
    expect(res).toEqual({
      outcome: 'block',
      cause: 'rewrite_unverified',
      blockedBy: 'lockedLeak',
      guards: [
        { name: 'lockedLeak', ok: true },
        { name: 'answerLeak', ok: true },
        { name: 'grounding', ok: false, action: 'rewrite' },
        { name: 'tone', ok: true },
        { name: 'lockedLeak', ok: false, action: 'block' },
      ],
      usage: [],
    });
    expect(lockedLeak.calls.map((c) => c.text)).toEqual(['draft', 'the answer is 42']);
    expect(tone.calls).toHaveLength(1); // the verification pass stopped at lockedLeak
    expect(JSON.stringify(res)).not.toContain('42');
  });

  it('a block verdict on the verification pass is rewrite_unverified too', async () => {
    const a = fakeGuard<Ctx>('lockedLeak', 'post', (t) => (t === 'bad' ? BLOCK : OK));
    const b = fakeGuard<Ctx>('tone', 'post', once('draft', 'bad'));
    const { run } = setup('post');
    expect(await run([a, b], 'draft')).toMatchObject({
      outcome: 'block',
      cause: 'rewrite_unverified',
      blockedBy: 'lockedLeak',
    });
  });

  it('a guard failure on the verification pass fails the chain', async () => {
    let calls = 0;
    const a = rawGuard('lockedLeak', 'post', () =>
      calls++ === 0 ? Promise.resolve({ result: OK, usage: [] }) : Promise.reject(new Error('x')),
    );
    const b = fakeGuard<Ctx>('tone', 'post', once('draft', 'better'));
    const { run } = setup('post');
    const res = await run([a, b], 'draft');
    expect(failureOf(res)).toEqual({ name: 'lockedLeak', cause: 'error', errorName: 'Error' });
  });

  it('an escalate on the verification pass still escalates (a stronger outcome than block)', async () => {
    const a = fakeGuard<Ctx>('distressDetect', 'pre', (t) => (t === 'scary' ? ESCALATE : OK));
    const b = fakeGuard<Ctx>('jailbreak', 'pre', once('hi', 'scary'));
    const { run } = setup('pre');
    expect(await run([a, b], 'hi')).toMatchObject({
      outcome: 'escalate',
      alert: demoSafetyAlert,
      text: 'scary',
    });
  });

  it('no verification pass runs when nothing rewrote', async () => {
    const a = fakeGuard<Ctx>('distressDetect', 'pre', OK);
    const { run } = setup('pre');
    await run([a]);
    expect(a.calls).toHaveLength(1);
  });

  it('a rewrite to the empty string is honoured', async () => {
    const a = fakeGuard<Ctx>('piiScrub', 'scrub', once('my phone is ...', ''));
    const { run } = setup('scrub');
    expect(textOf(await run([a], 'my phone is ...'))).toBe('');
  });

  it('block stops the chain as a guard verdict, not a failure, and carries no text', async () => {
    const a = fakeGuard<Ctx>('distressDetect', 'pre', OK);
    const b = fakeGuard<Ctx>('moderationIn', 'pre', BLOCK);
    const c = fakeGuard<Ctx>('jailbreak', 'pre', OK);
    const { run } = setup('pre');
    const res = await run([a, b, c]);
    expect(res).toEqual({
      outcome: 'block',
      cause: 'verdict',
      blockedBy: 'moderationIn',
      guards: [
        { name: 'distressDetect', ok: true },
        { name: 'moderationIn', ok: false, action: 'block' },
      ],
      usage: [],
    });
    expect('text' in res).toBe(false);
    expect(c.calls).toEqual([]);
  });

  it('escalate stops the chain and carries the alert', async () => {
    const a = fakeGuard<Ctx>('distressDetect', 'pre', ESCALATE);
    const b = fakeGuard<Ctx>('moderationIn', 'pre', OK);
    const { run } = setup('pre');
    expect(await run([a, b])).toEqual({
      outcome: 'escalate',
      alert: demoSafetyAlert,
      text: 'hello',
      guards: [{ name: 'distressDetect', ok: false, action: 'escalate' }],
      usage: [],
    });
    expect(b.calls).toEqual([]);
  });
});

describe('runGuardChain: usage, trace and the outcome hook', () => {
  const u = (n: number): Usage => ({ ...usageSmall, inputTokens: n });

  it('concatenates usage from every guard that ran, including the one that stopped it', async () => {
    for (const [last, outcome] of [
      [BLOCK, 'block'],
      [ESCALATE, 'escalate'],
    ] as const) {
      const a = fakeGuard<Ctx>('lockedLeak', 'post', OK, { usage: [u(1)] });
      const b = fakeGuard<Ctx>('answerLeak', 'post', rewrite('y'), { usage: [u(2), u(3)] });
      const c = fakeGuard<Ctx>('grounding', 'post', last, { usage: [usageMain] });
      const d = fakeGuard<Ctx>('tone', 'post', OK, { usage: [u(9)] });
      const { run } = setup('post');
      const res = await run([a, b, c, d]);
      expect(res.outcome).toBe(outcome);
      expect(res.usage).toEqual([u(1), u(2), u(3), usageMain]);
    }
  });

  it('adds usage from the verification pass', async () => {
    const a = fakeGuard<Ctx>('lockedLeak', 'post', (t) => (t === 'x' ? rewrite('y') : OK), {
      usage: [u(1)],
    });
    const b = fakeGuard<Ctx>('tone', 'post', OK, { usage: [u(2)] });
    const { run } = setup('post');
    expect((await run([a, b], 'x')).usage).toEqual([u(1), u(2), u(1), u(2)]);
  });

  it('keeps usage from earlier guards when a later one throws', async () => {
    const a = fakeGuard<Ctx>('distressDetect', 'pre', OK, { usage: [usageSmall] });
    const b = rawGuard('moderationIn', 'pre', () => Promise.reject(new Error('x')));
    const { run } = setup('pre');
    expect((await run([a, b])).usage).toEqual([usageSmall]);
  });

  it('the trace never carries reason or text, for every outcome', async () => {
    const results: GuardResult[] = [OK, BLOCK, rewrite('secret replacement'), ESCALATE];
    for (const r of results) {
      const { run } = setup('post');
      const res = await run([fakeGuard<Ctx>('lockedLeak', 'post', r)], 'secret draft');
      parsesAsTrace(res);
      for (const g of res.guards) {
        expect(Object.keys(g).sort()).toEqual(g.ok ? ['name', 'ok'] : ['action', 'name', 'ok']);
      }
      expect(JSON.stringify(res.guards)).not.toContain('secret');
    }
  });

  it('calls onGuardOutcome once per guard that ran, with no reason or text', async () => {
    const events: GuardOutcomeEvent[] = [];
    const { run } = setup('post', { onGuardOutcome: (e) => events.push(e) });
    await run([
      fakeGuard<Ctx>('lockedLeak', 'post', OK),
      fakeGuard<Ctx>('answerLeak', 'post', rewrite('secret')),
      fakeGuard<Ctx>('grounding', 'post', BLOCK),
      fakeGuard<Ctx>('tone', 'post', OK),
    ]);
    expect(events).toEqual([
      { name: 'lockedLeak', phase: 'post', pass: 1, outcome: 'ok' },
      { name: 'answerLeak', phase: 'post', pass: 1, outcome: 'rewrite' },
      { name: 'grounding', phase: 'post', pass: 1, outcome: 'block' },
    ]);
    expect(JSON.stringify(events)).not.toContain('secret');
  });

  it('reports the verification pass, escalate and failures (with cause) to onGuardOutcome', async () => {
    const events: GuardOutcomeEvent[] = [];
    const pre = setup('pre', { onGuardOutcome: (e) => events.push(e) });
    await pre.run([fakeGuard<Ctx>('distressDetect', 'pre', ESCALATE)]);
    await pre.run([rawGuard('jailbreak', 'pre', () => Promise.reject(new Error('x')))]);
    await pre.run([fakeGuard<Ctx>('profanity', 'pre', OK)]);
    await pre.run([fakeGuard<Ctx>('jailbreak', 'pre', rewrite('again'))], 'hi');
    expect(events).toEqual([
      { name: 'distressDetect', phase: 'pre', pass: 1, outcome: 'escalate' },
      { name: 'jailbreak', phase: 'pre', pass: 1, outcome: 'failed', cause: 'error' },
      { name: '(undeclared)', phase: 'pre', pass: 1, outcome: 'failed', cause: 'undeclared' },
      { name: 'jailbreak', phase: 'pre', pass: 1, outcome: 'rewrite' },
      {
        name: 'jailbreak',
        phase: 'pre',
        pass: 2,
        outcome: 'block',
        cause: 'rewrite_unverified',
      },
    ]);
  });

  it('a throwing onGuardOutcome changes nothing and never makes the chain throw', async () => {
    const { run } = setup('pre', {
      onGuardOutcome: () => {
        throw new Error('observer broke');
      },
    });
    expect((await run([fakeGuard<Ctx>('distressDetect', 'pre', OK)])).outcome).toBe('ok');
    expect((await run([fakeGuard<Ctx>('jailbreak', 'pre', BLOCK)])).outcome).toBe('block');
  });

  it('an async onGuardOutcome that rejects is not an unhandled rejection', async () => {
    // Vitest fails the run on any unhandled rejection, so this test passing is the evidence.
    let calls = 0;
    const { run } = setup('pre', {
      onGuardOutcome: async () => {
        calls++;
        await Promise.resolve();
        throw new Error('async observer broke');
      },
    });
    expect((await run([fakeGuard<Ctx>('distressDetect', 'pre', OK)])).outcome).toBe('ok');
    expect(calls).toBe(1);
  });

  it('attaches a rejection handler to a thenable the observer returns', async () => {
    const handlers: unknown[] = [];
    const thenable = {
      then(_onOk: unknown, onErr: unknown) {
        handlers.push(onErr);
      },
    };
    const { run } = setup('pre', { onGuardOutcome: () => thenable as never });
    await run([fakeGuard<Ctx>('distressDetect', 'pre', OK)]);
    expect(handlers).toHaveLength(1);
    expect(typeof handlers[0]).toBe('function');
  });

  it('an observer returning null, a plain object or a function changes nothing', async () => {
    for (const value of [null, {}, () => undefined]) {
      const { run } = setup('pre', { onGuardOutcome: () => value as never });
      expect((await run([fakeGuard<Ctx>('distressDetect', 'pre', OK)])).outcome).toBe('ok');
    }
  });

  it('an observer returning a thenable whose then getter throws changes nothing', async () => {
    const hostile = Object.defineProperty({}, 'then', {
      get(): never {
        throw new Error('then getter');
      },
    });
    const { run } = setup('pre', { onGuardOutcome: () => hostile as never });
    expect((await run([fakeGuard<Ctx>('distressDetect', 'pre', OK)])).outcome).toBe('ok');
  });
});

describe('fakeGuard', () => {
  it('records calls into a shared spy and returns its usage', async () => {
    const spy: string[] = [];
    const g = fakeGuard<Ctx>('tone', 'post', OK, { spy, usage: [usageSmall] });
    const c = cancelSource();
    expect(await g.run('t', CTX, c.token)).toEqual({ result: OK, usage: [usageSmall] });
    expect(spy).toEqual(['tone']);
    expect(g.calls).toEqual([{ text: 't', ctx: CTX }]);
  });

  it('accepts an async behaviour function', async () => {
    const g = fakeGuard<Ctx>('tone', 'post', (t) => Promise.resolve(rewrite(t.toUpperCase())));
    const c = cancelSource();
    expect((await g.run('abc', CTX, c.token)).result).toEqual(rewrite('ABC'));
  });
});

describe('runGuardChain: per-guard slices (task 4.7)', () => {
  it('asks the slice function before each run, with the guard, pass and position', async () => {
    const asked: unknown[] = [];
    const a = fakeGuard<Ctx>('lockedLeak', 'post', (t) => (t === 'r' ? OK : rewrite('r')));
    const b = fakeGuard<Ctx>('grounding', 'post', OK);
    const { run } = setup('post', {
      timeoutMs: (at) => {
        asked.push(at);
        return SLICE_MS;
      },
    });
    const res = await run([a, b]);
    expect(res.outcome).toBe('ok');
    expect(asked).toEqual([
      { name: 'lockedLeak', pass: 1, index: 0, text: 'hello' },
      // Each guard is told the text it is about to check (4.8 fix round 1).
      { name: 'grounding', pass: 1, index: 1, text: 'r' },
      { name: 'lockedLeak', pass: 2, index: 0, text: 'r' },
      { name: 'grounding', pass: 2, index: 1, text: 'r' },
    ]);
  });

  it('each guard gets its own slice', async () => {
    const clockRef: { c?: VirtualClock } = {};
    const slow = (name: string, ms: number) =>
      rawGuard(name, 'post', async () => {
        await clockRef.c?.sleep(ms);
        return { result: OK, usage: [] };
      });
    const slices: Record<string, number> = { lockedLeak: 10, grounding: 100 };
    const { run, clock } = setup('post', { timeoutMs: ({ name }) => slices[name] ?? 0 });
    clockRef.c = clock;
    expect((await run([slow('lockedLeak', 9), slow('grounding', 99)])).outcome).toBe('ok');
    expect(failureOf(await run([slow('lockedLeak', 11), slow('grounding', 1)]))).toEqual({
      name: 'lockedLeak',
      cause: 'timeout',
    });
  });

  it('a slice function that throws or gives nonsense fails the guard closed (timeout)', async () => {
    for (const timeoutMs of [
      () => {
        throw new Error('boom');
      },
      () => Number.NaN,
      () => 'x' as unknown as number,
    ]) {
      const a = fakeGuard<Ctx>('tone', 'post', OK);
      const { run } = setup('post', { timeoutMs });
      expect(failureOf(await run([a]))).toEqual({ name: 'tone', cause: 'timeout' });
      expect(a.calls).toEqual([]);
    }
  });
});
