import { type GuardResult, LIMITS, TurnTraceSchema, type Usage } from '@edmate/contracts';
import { demoSafetyAlert, usageMain, usageSmall } from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { cancelSource } from '../pipeline/clock.js';
import { fakeGuard } from '../testing/guardFixtures.js';
import { prng } from '../testing/prng.js';
import { type VirtualClock, virtualClock } from '../testing/virtualClock.js';
import { type GuardChainOptions, type GuardOutcomeEvent, runGuardChain } from './chain.js';
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

describe('runGuardChain: declared order', () => {
  it('runs guards in GUARD_ORDER order, whatever the registration order', async () => {
    const calls: string[] = [];
    const r = new GuardRegistry<Ctx>('post');
    for (const n of [
      'tone',
      'grounding',
      'answerLeak',
      'personaBoundary',
      'adviceGuard',
      'lockedLeak',
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

  it('an empty chain is ok with the text unchanged (stubs stay fail-closed until a guard lands)', async () => {
    const { run } = setup('scrub');
    expect(await run([], 'x')).toEqual({ outcome: 'ok', text: 'x', guards: [], usage: [] });
  });

  it('fails closed before running anything when the list is out of declared order', async () => {
    const a = fakeGuard<Ctx>('distressDetect', 'pre', OK);
    const b = fakeGuard<Ctx>('jailbreak', 'pre', OK);
    const { run } = setup('pre');
    const res = await run([b, a]);
    expect(res.outcome).toBe('block');
    expect(res.failure).toEqual({ name: 'distressDetect', cause: 'out_of_order' });
    expect(res.guards).toEqual([{ name: 'distressDetect', ok: false, action: 'block' }]);
    expect(a.calls).toEqual([]);
    expect(b.calls).toEqual([]);
  });

  it('fails closed on a duplicate guard in the list', async () => {
    const a = fakeGuard<Ctx>('jailbreak', 'pre', OK);
    const { run } = setup('pre');
    const res = await run([a, a]);
    expect(res.outcome).toBe('block');
    expect(res.failure?.cause).toBe('out_of_order');
    expect(a.calls).toEqual([]);
  });

  it('fails closed on an unknown guard that bypassed the registry', async () => {
    const a = fakeGuard<Ctx>('distressDetect', 'pre', OK);
    const unknown = fakeGuard<Ctx>('profanity', 'pre', OK);
    const { run } = setup('pre');
    const res = await run([a, unknown]);
    expect(res.outcome).toBe('block');
    expect(res.failure).toEqual({ name: 'profanity', cause: 'undeclared' });
    expect(res.guards).toEqual([{ name: 'profanity', ok: false, action: 'block' }]);
    expect(a.calls).toEqual([]);
  });

  it('fails closed on a guard from another phase, even with a declared name', async () => {
    const tone = fakeGuard<Ctx>('tone', 'post', OK);
    const { run } = setup('pre');
    expect((await run([tone])).failure).toEqual({ name: 'tone', cause: 'undeclared' });
    // A guard object that claims the right phase but carries a post-phase name.
    const sneaky = fakeGuard<Ctx>('tone', 'pre', OK);
    expect((await run([sneaky])).failure).toEqual({ name: 'tone', cause: 'undeclared' });
    expect(tone.calls).toEqual([]);
    expect(sneaky.calls).toEqual([]);
  });

  it('fails closed on a malformed guard entry without throwing', async () => {
    const { run } = setup('pre');
    for (const bad of [null, undefined, {}, { name: 'jailbreak', phase: 'pre' }, { name: 3 }]) {
      const res = await run([bad as never]);
      expect(res.outcome).toBe('block');
      expect(res.failure?.cause).toBe('undeclared');
      expect(TurnTraceSchema.shape.guards.parse(res.guards)).toEqual(res.guards);
    }
  });

  it('fails closed on an unknown phase', async () => {
    const { run } = setup('mid' as never);
    const res = await run([fakeGuard<Ctx>('jailbreak', 'pre', OK)]);
    expect(res.outcome).toBe('block');
    expect(res.failure?.cause).toBe('undeclared');
    const empty = await run([]);
    expect(empty.outcome).toBe('block');
    expect(empty.failure).toEqual({ name: 'mid', cause: 'undeclared' });
  });
});

describe('runGuardChain: fail closed', () => {
  it('a guard that throws blocks the chain; later guards never run', async () => {
    const boom = new Error('model said: secret text');
    const a = rawGuard('distressDetect', 'pre', () => Promise.reject(boom));
    const b = fakeGuard<Ctx>('moderationIn', 'pre', OK);
    const { run } = setup('pre');
    const res = await run([a, b]);
    expect(res.outcome).toBe('block');
    expect(res.failure).toEqual({ name: 'distressDetect', cause: 'error', error: boom });
    expect(res.guards).toEqual([{ name: 'distressDetect', ok: false, action: 'block' }]);
    expect(JSON.stringify(res.guards)).not.toContain('secret');
    expect(b.calls).toEqual([]);
  });

  it('a guard that throws synchronously also blocks', async () => {
    const a = rawGuard('jailbreak', 'pre', () => {
      throw new TypeError('sync');
    });
    const { run } = setup('pre');
    const res = await run([a]);
    expect(res.outcome).toBe('block');
    expect(res.failure?.cause).toBe('error');
    expect(res.failure?.error).toBeInstanceOf(TypeError);
  });

  it('a non-Error rejection blocks too', async () => {
    const a = rawGuard('jailbreak', 'pre', () => Promise.reject('nope'));
    const { run } = setup('pre');
    expect((await run([a])).failure).toEqual({ name: 'jailbreak', cause: 'error', error: 'nope' });
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
        result: { ok: false, action: 'block', reason: 'r'.repeat(LIMITS.guardReasonMaxLength + 1) },
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
    'a guard returning %s blocks with cause invalid_result',
    async (_label, value) => {
      const a = rawGuard('answerLeak', 'post', () => Promise.resolve(value as never));
      const b = fakeGuard<Ctx>('tone', 'post', OK);
      const { run } = setup('post');
      const res = await run([a, b]);
      expect(res.outcome).toBe('block');
      expect(res.failure).toEqual({ name: 'answerLeak', cause: 'invalid_result' });
      expect(res.guards).toEqual([{ name: 'answerLeak', ok: false, action: 'block' }]);
      expect(res.usage).toEqual([]);
      expect(b.calls).toEqual([]);
    },
  );

  it('a result whose getter throws while being checked blocks as an error', async () => {
    const hostile = {
      get result(): never {
        throw new Error('getter');
      },
      usage: [],
    };
    const a = rawGuard('tone', 'post', () => Promise.resolve(hostile as never));
    const { run } = setup('post');
    const res = await run([a]);
    expect(res.outcome).toBe('block');
    expect(res.failure?.cause).toBe('error');
  });

  it('a guard past its own time slice blocks; later guards never run', async () => {
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
    expect(res.outcome).toBe('block');
    expect(res.failure).toEqual({ name: 'moderationIn', cause: 'timeout' });
    expect(res.guards).toEqual([{ name: 'moderationIn', ok: false, action: 'block' }]);
    expect(clock.now()).toBe(SLICE_MS);
    expect(cancelled).toBe(true);
    expect(after.calls).toEqual([]);
    expect(clock.pending).toBe(0);
  });

  it('the slice is per guard, not shared: two guards each under the slice both pass', async () => {
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

  it('a late result after the slice is ignored (the guard is already a block)', async () => {
    const clockRef: { c?: VirtualClock } = {};
    const late = rawGuard('tone', 'post', async () => {
      await clockRef.c?.sleep(SLICE_MS + 10);
      return { result: OK, usage: [usageSmall] };
    });
    const { run, clock } = setup('post');
    clockRef.c = clock;
    const res = await run([late]);
    expect(res.outcome).toBe('block');
    expect(res.failure?.cause).toBe('timeout');
    expect(res.usage).toEqual([]);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY * -1])(
    'a non-positive or invalid slice (%s) blocks without running the guard',
    async (timeoutMs) => {
      const a = fakeGuard<Ctx>('jailbreak', 'pre', OK);
      const { run } = setup('pre', { timeoutMs });
      const res = await run([a]);
      expect(res.outcome).toBe('block');
      expect(res.failure).toEqual({ name: 'jailbreak', cause: 'timeout' });
      expect(a.calls).toEqual([]);
    },
  );

  it('an already-cancelled step runs no guard and blocks', async () => {
    const src = cancelSource();
    src.cancel();
    const a = fakeGuard<Ctx>('distressDetect', 'pre', OK);
    const { run } = setup('pre', { cancel: src.token });
    const res = await run([a]);
    expect(res.outcome).toBe('block');
    expect(res.failure).toEqual({ name: 'distressDetect', cause: 'cancelled' });
    expect(res.guards).toEqual([{ name: 'distressDetect', ok: false, action: 'block' }]);
    expect(a.calls).toEqual([]);
  });

  it('a step cancelled while a guard runs blocks after it, even if the guard said ok', async () => {
    const src = cancelSource();
    const a = rawGuard('distressDetect', 'pre', () => {
      src.cancel();
      return Promise.resolve({ result: OK, usage: [usageSmall] });
    });
    const b = fakeGuard<Ctx>('jailbreak', 'pre', OK);
    const { run } = setup('pre', { cancel: src.token });
    const res = await run([a, b]);
    expect(res.outcome).toBe('block');
    expect(res.failure).toEqual({ name: 'distressDetect', cause: 'cancelled' });
    expect(res.guards).toEqual([{ name: 'distressDetect', ok: false, action: 'block' }]);
    expect(res.usage).toEqual([usageSmall]);
    expect(b.calls).toEqual([]);
  });

  it(
    'never outputs ok when any guard did not pass (seeded property, 2000 chains)',
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
            if (k === 'invalid')
              return Promise.resolve({ result: { ok: false }, usage: [] } as never);
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
        const stop = plan.findIndex((k) => k !== 'ok' && k !== 'rewrite');
        const ran = stop === -1 ? plan.length : stop + 1;
        expect(res.guards).toHaveLength(ran);
        if (stop === -1) {
          expect(res.outcome).toBe('ok');
        } else if (plan[stop] === 'escalate') {
          expect(res.outcome).toBe('escalate');
        } else {
          expect(res.outcome).toBe('block');
        }
        expect(TurnTraceSchema.shape.guards.parse(res.guards)).toEqual(res.guards);
      }
    },
  );
});

describe('runGuardChain: rewrite, block, escalate', () => {
  it('rewrite returns the replacement text and the chain goes on', async () => {
    const a = fakeGuard<Ctx>('answerLeak', 'post', rewrite('a safer hint'));
    const b = fakeGuard<Ctx>('tone', 'post', OK);
    const { run } = setup('post');
    const res = await run([a, b], 'the answer is 42');
    expect(res.outcome).toBe('ok');
    expect(res.text).toBe('a safer hint');
    expect(b.calls).toEqual([{ text: 'a safer hint', ctx: CTX }]);
    expect(res.guards).toEqual([
      { name: 'answerLeak', ok: false, action: 'rewrite' },
      { name: 'tone', ok: true },
    ]);
  });

  it('two rewrites compose: the second sees the first and its text is final', async () => {
    const a = fakeGuard<Ctx>('answerLeak', 'post', (t) => rewrite(`${t} +a`));
    const b = fakeGuard<Ctx>('lockedLeak', 'post', (t) => rewrite(`${t} +b`));
    const { run } = setup('post');
    const res = await run([a, b], 'draft');
    expect(res.text).toBe('draft +a +b');
    expect(b.calls[0]?.text).toBe('draft +a');
    expect(res.outcome).toBe('ok');
  });

  it('a rewrite to the empty string is honoured', async () => {
    const a = fakeGuard<Ctx>('piiScrub', 'scrub', rewrite(''));
    const { run } = setup('scrub');
    expect((await run([a], 'my phone is ...')).text).toBe('');
  });

  it('block stops the chain without a failure (the guard decided, nothing broke)', async () => {
    const a = fakeGuard<Ctx>('distressDetect', 'pre', OK);
    const b = fakeGuard<Ctx>('moderationIn', 'pre', BLOCK);
    const c = fakeGuard<Ctx>('jailbreak', 'pre', OK);
    const { run } = setup('pre');
    const res = await run([a, b, c]);
    expect(res).toEqual({
      outcome: 'block',
      text: 'hello',
      guards: [
        { name: 'distressDetect', ok: true },
        { name: 'moderationIn', ok: false, action: 'block' },
      ],
      usage: [],
    });
    expect(c.calls).toEqual([]);
  });

  it('escalate stops the chain and carries the alert', async () => {
    const a = fakeGuard<Ctx>('distressDetect', 'pre', ESCALATE);
    const b = fakeGuard<Ctx>('moderationIn', 'pre', OK);
    const { run } = setup('pre');
    const res = await run([a, b]);
    expect(res).toEqual({
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
  it('concatenates usage from every guard that ran, including the one that stopped it', async () => {
    const u = (n: number): Usage => ({ ...usageSmall, inputTokens: n });
    const cases: [GuardResult, string][] = [
      [BLOCK, 'block'],
      [ESCALATE, 'escalate'],
      [rewrite('x'), 'ok'],
    ];
    for (const [last, outcome] of cases) {
      const a = fakeGuard<Ctx>('answerLeak', 'post', OK, { usage: [u(1)] });
      const b = fakeGuard<Ctx>('lockedLeak', 'post', rewrite('y'), { usage: [u(2), u(3)] });
      const c = fakeGuard<Ctx>('grounding', 'post', last, { usage: [usageMain] });
      const d = fakeGuard<Ctx>('tone', 'post', OK, { usage: [u(9)] });
      const { run } = setup('post');
      const res = await run([a, b, c, d]);
      expect(res.outcome).toBe(outcome);
      const expected =
        outcome === 'ok' ? [u(1), u(2), u(3), usageMain, u(9)] : [u(1), u(2), u(3), usageMain];
      expect(res.usage).toEqual(expected);
    }
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
      const res = await run([fakeGuard<Ctx>('answerLeak', 'post', r)], 'secret draft');
      expect(TurnTraceSchema.shape.guards.parse(res.guards)).toEqual(res.guards);
      for (const g of res.guards)
        expect(Object.keys(g).sort()).toEqual(g.ok ? ['name', 'ok'] : ['action', 'name', 'ok']);
      expect(JSON.stringify(res.guards)).not.toContain('secret');
    }
  });

  it('calls onGuardOutcome once per guard that ran, with name, phase and outcome only', async () => {
    const events: GuardOutcomeEvent[] = [];
    const { run } = setup('post', { onGuardOutcome: (e) => events.push(e) });
    await run([
      fakeGuard<Ctx>('answerLeak', 'post', OK),
      fakeGuard<Ctx>('lockedLeak', 'post', rewrite('secret')),
      fakeGuard<Ctx>('grounding', 'post', BLOCK),
      fakeGuard<Ctx>('tone', 'post', OK),
    ]);
    expect(events).toEqual([
      { name: 'answerLeak', phase: 'post', outcome: 'ok' },
      { name: 'lockedLeak', phase: 'post', outcome: 'rewrite' },
      { name: 'grounding', phase: 'post', outcome: 'block' },
    ]);
    for (const e of events) expect(Object.keys(e).sort()).toEqual(['name', 'outcome', 'phase']);
  });

  it('reports escalate and fail-closed blocks to onGuardOutcome', async () => {
    const events: GuardOutcomeEvent[] = [];
    const { run } = setup('pre', { onGuardOutcome: (e) => events.push(e) });
    await run([fakeGuard<Ctx>('distressDetect', 'pre', ESCALATE)]);
    await run([rawGuard('jailbreak', 'pre', () => Promise.reject(new Error('x')))]);
    await run([fakeGuard<Ctx>('profanity', 'pre', OK)]);
    expect(events).toEqual([
      { name: 'distressDetect', phase: 'pre', outcome: 'escalate' },
      { name: 'jailbreak', phase: 'pre', outcome: 'block' },
      { name: 'profanity', phase: 'pre', outcome: 'block' },
    ]);
  });

  it('a throwing onGuardOutcome changes nothing and never makes the chain throw', async () => {
    const { run } = setup('pre', {
      onGuardOutcome: () => {
        throw new Error('observer broke');
      },
    });
    const ok = await run([fakeGuard<Ctx>('distressDetect', 'pre', OK)]);
    expect(ok.outcome).toBe('ok');
    const blocked = await run([fakeGuard<Ctx>('jailbreak', 'pre', BLOCK)]);
    expect(blocked.outcome).toBe('block');
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
