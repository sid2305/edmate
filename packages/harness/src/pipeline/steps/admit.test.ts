import type { TurnInput } from '@edmate/contracts';
import { demoAttachment, demoTurnInput, turnInputHint } from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { accessTurns, type AccessTurnOutcome } from '../../testing/accessTurn.js';
import { stepEnvExtras } from '../../testing/testSteps.js';
import { cancelSource } from '../clock.js';
import { TurnRejection } from '../errors.js';
import { RATE_LIMIT_WINDOW_MS } from '../spec.js';
import { admit, checkInputLimits } from './admit.js';

/** stu_1's own open session with teacher A's live agent (twoTeacherWorld). */
const input: TurnInput = {
  ...demoTurnInput,
  studentId: 'stu_1',
  agentId: 'agt_a',
  sessionId: 'ses_1a',
};

const circular: Record<string, unknown> = {};
circular.self = circular;

/** A rejected turn: one error event, no step after admit/entitle, no model call, no trace. */
function expectRejected(
  out: AccessTurnOutcome,
  modelCalls: string[],
  code: string,
  retryable: boolean,
) {
  expect(out.code).toBe(code);
  expect(out.retryable).toBe(retryable);
  expect(out.events).toEqual([{ type: 'error', code, retryable }]);
  expect(out.started.every((s) => s === 'admit' || s === 'entitle')).toBe(true);
  expect(modelCalls).toEqual([]);
  expect(out.trace).toBeNull();
}

describe('admit: input limits → input_too_large (through runTurn)', () => {
  const rows: [string, Partial<Record<keyof TurnInput, unknown>>][] = [
    ['text of 4,001 code points', { text: 'a'.repeat(4001) }],
    ['text of 4,001 emoji (8,002 UTF-16 units)', { text: '🙂'.repeat(4001) }],
    ['text of 8,001 UTF-16 units', { text: 'a'.repeat(8001) }],
    ['3 attachments', { attachments: [demoAttachment, demoAttachment, demoAttachment] }],
    ['a skillPayload over 16 KB of JSON', { skillPayload: { a: 'x'.repeat(16 * 1024) } }],
    ['an unserialisable skillPayload', { skillPayload: circular }],
    ['a BigInt skillPayload', { skillPayload: 10n }],
  ];
  it.each(rows)('%s', async (_label, patch) => {
    const a = accessTurns();
    const out = await a.run({ ...input, ...patch } as TurnInput);
    expectRejected(out, a.modelCalls, 'input_too_large', false);
    expect(out.started).toEqual(['admit']);
    expect(a.entitlements.calls).toEqual([]);
  });

  it.each([
    ['text that is not a string', { text: 42 }],
    ['attachments that are not a list', { attachments: 'many' }],
  ])('%s → validation', async (_label, patch) => {
    const a = accessTurns();
    const out = await a.run({ ...input, ...patch } as unknown as TurnInput);
    expectRejected(out, a.modelCalls, 'validation', false);
  });

  it('accepts input exactly at the limits', async () => {
    const a = accessTurns();
    const atLimit = [
      { ...input, text: '🙂'.repeat(4000) },
      { ...input, text: 'a'.repeat(4000) },
      { ...input, attachments: [demoAttachment, demoAttachment] },
      // JSON.stringify of {a:"..."} adds 8 characters.
      { ...input, skillPayload: { a: 'x'.repeat(16 * 1024 - 8) } },
      { ...turnInputHint, studentId: 'stu_1', agentId: 'agt_a', sessionId: 'ses_1a' },
    ];
    for (const i of atLimit) expect((await a.run(i)).code).toBe('passed');
    expect(() => checkInputLimits({ ...input, skillPayload: () => 1 } as never)).not.toThrow();
  });
});

describe('admit: rate limit → rate_limited (retryable)', () => {
  it('the 11th turn in 60 s is refused; the window slides', async () => {
    const a = accessTurns();
    const t0 = a.t.clock.now();
    // One turn a second: turn 1 at t0, turn 10 at t0 + 9 s.
    for (let i = 0; i < 10; i++) {
      await a.t.clock.advance(t0 + i * 1_000 - a.t.clock.now());
      expect((await a.run(input)).code).toBe('passed');
    }
    expectRejected(await a.run(input), a.modelCalls, 'rate_limited', true);
    // +59,999 ms after turn 1 it is still inside the window; at +60,001 ms only its slot is free.
    await a.t.clock.advance(t0 + RATE_LIMIT_WINDOW_MS - 1 - a.t.clock.now());
    expect((await a.run(input)).code).toBe('rate_limited');
    await a.t.clock.advance(t0 + RATE_LIMIT_WINDOW_MS + 1 - a.t.clock.now());
    expect((await a.run(input)).code).toBe('passed');
    expect((await a.run(input)).code).toBe('rate_limited');
  });

  it('counts per student, across agents', async () => {
    const a = accessTurns();
    for (let i = 0; i < 10; i++) {
      const other = { ...input, agentId: i % 2 === 0 ? 'agt_a' : 'agt_b', sessionId: 'ses_1b' };
      await a.run(i % 2 === 0 ? input : other);
    }
    expect((await a.run(input)).code).toBe('rate_limited');
    expect(
      (await a.run({ ...input, studentId: 'stu_2', sessionId: 'ses_2b', agentId: 'agt_b' })).code,
    ).toBe('passed');
  });

  it('turns rejected by the input limits do not use a slot', async () => {
    const a = accessTurns();
    for (let i = 0; i < 10; i++) {
      expect((await a.run({ ...input, text: 'a'.repeat(4001) })).code).toBe('input_too_large');
    }
    for (let i = 0; i < 10; i++) expect((await a.run(input)).code).toBe('passed');
  });

  it('turns rejected later, by entitle, still count as admitted', async () => {
    const a = accessTurns();
    for (let i = 0; i < 10; i++) {
      expect((await a.run({ ...input, sessionId: 'ses_1b' })).code).toBe('no_access');
    }
    expect((await a.run(input)).code).toBe('rate_limited');
  });

  it('applies to teacher preview; eval is exempt', async () => {
    const preview = accessTurns({
      source: 'teacher_preview',
      opts: { market: 'IN', preview: { packageId: 'pkg_a' } },
    });
    const pIn = { ...input, studentId: 'tch_a', sessionId: 'ses_preview_a' };
    for (let i = 0; i < 10; i++) expect((await preview.run(pIn)).code).toBe('passed');
    expect((await preview.run(pIn)).code).toBe('rate_limited');

    const ev = accessTurns({
      source: 'eval',
      opts: {
        market: 'IN',
        eval: { teacherId: 'tch_a', packageId: 'pkg_a', version: 2, market: 'IN' },
      },
    });
    const eIn = { ...input, studentId: 'stu_eval', sessionId: 'ses_eval_a' };
    for (let i = 0; i < 25; i++) expect((await ev.run(eIn)).code).toBe('passed');
  });

  it('a limiter that throws or hangs fails as rate_limited (retryable), with no later step', async () => {
    const throwing = accessTurns({
      overrides: {
        limits: {
          rate: {
            tryTake: () => {
              throw new Error('limiter down');
            },
          },
          messages: { tryTake: () => true },
        },
      },
    });
    expectRejected(await throwing.run(input), throwing.modelCalls, 'rate_limited', true);

    const hanging = accessTurns({
      overrides: {
        limits: {
          rate: { tryTake: () => new Promise<boolean>(() => undefined) },
          messages: { tryTake: () => true },
        },
      },
    });
    expectRejected(await hanging.run(input), hanging.modelCalls, 'rate_limited', true);
  });

  it('an async limiter that refuses is rate_limited', async () => {
    const a = accessTurns({
      overrides: {
        limits: {
          rate: { tryTake: () => Promise.resolve(false) },
          messages: { tryTake: () => true },
        },
      },
    });
    expect((await a.run(input)).code).toBe('rate_limited');
  });
});

describe('admit: direct call', () => {
  it('throws TurnRejection and touches no store', async () => {
    const a = accessTurns();
    const env = {
      input: { ...input, text: 'a'.repeat(4001) },
      deps: a.t.deps,
      cancel: cancelSource().token,
      turnId: 't',
      ...stepEnvExtras(),
    };
    await expect(admit(env)).rejects.toBeInstanceOf(TurnRejection);
    expect(a.t.portCalls).toEqual([]);
  });
});
