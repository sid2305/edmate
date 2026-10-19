import { LIMITS, type ModelChunk, type ModelRequest, type Usage } from '@edmate/contracts';
import { turnContextFull, usageMain } from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { memoryToolRegistry, testTool } from '../../testing/memoryToolRegistry.js';
import { type StreamStep, ScriptedGateway } from '../../testing/scriptedGateway.js';
import { spyGateway } from '../../testing/spyGateway.js';
import { virtualClock } from '../../testing/virtualClock.js';
import { cancelSource } from '../clock.js';
import { TurnAbort, TurnCancelled } from '../errors.js';
import type { LockedCheck } from '../../guardrails/answerLeak.js';
import { LockedCheckFailed, LockedLeakDetected } from '../../guardrails/lockedLeak.js';
import { lockedIndex } from '../../guardrails/lockedMatch.js';
import type { RegisteredTool } from '../tools.js';
import type { UsageRecorder } from '../types.js';
import { passThroughGate } from './streamGate.js';
import {
  MAX_TOOL_CALLS_PER_ROUND,
  MAX_TOOL_ROUNDS,
  runToolLoop,
  TOOL_RESULT_MAX_JSON_LENGTH,
  TOOL_TIMEOUT_MS,
  ToolCallNotOfferedError,
  ToolFailed,
} from './toolLoop.js';

const base: ModelRequest = {
  tier: 'main',
  system: 'SYSTEM',
  messages: [{ role: 'user', content: 'How do I add 1/2 and 1/3?' }],
  maxOutputTokens: 300,
};

const call = (id: string, name = 'calculator', args: unknown = { expression: '1/2+1/3' }) =>
  ({ type: 'tool_call', id, name, args }) satisfies ModelChunk;
const say = (text: string) => ({ type: 'text', text }) satisfies ModelChunk;
const used = { type: 'usage', usage: usageMain } satisfies ModelChunk;

const calculator = testTool({
  name: 'calculator',
  skill: 'coach',
  input: z.strictObject({ expression: z.string() }),
  output: z.strictObject({ value: z.string() }),
  run: () => Promise.resolve({ value: '5/6' }),
});

function setup(
  streams: StreamStep[][],
  o: {
    tools?: RegisteredTool[];
    recorder?: Partial<UsageRecorder>;
    mustNotReveal?: string[];
    lockedCheck?: LockedCheck;
    holdAll?: boolean;
  } = {},
) {
  const clock = virtualClock();
  const spy = spyGateway(
    new ScriptedGateway({ stream: streams.map((steps) => ({ steps })) }, clock),
  );
  const registry = memoryToolRegistry(o.tools ?? [calculator]);
  const shown: string[] = [];
  const recorded: Usage[] = [];
  const outputs: { name: string; output: unknown }[] = [];
  const reported: unknown[] = [];
  const tracked: Promise<unknown>[] = [];
  let checks = 0;
  const cancel = cancelSource();
  const input = {
    gateway: spy,
    request: base,
    offered: registry.list(),
    ctx: turnContextFull,
    clock,
    cancel: cancel.token,
    usage: {
      record: o.recorder?.record ?? ((u: Usage) => void recorded.push(u)),
      checkBeforeCall:
        o.recorder?.checkBeforeCall ??
        (() => {
          checks++;
        }),
    },
    gate: passThroughGate({ ctx: turnContextFull, decision: { ...demoDecision } }),
    show: (t: string) => void shown.push(t),
    onToolOutput: (r: RegisteredTool, output: unknown): void | Promise<void> =>
      void outputs.push({ name: r.tool.name, output }),
    report: (e: unknown) => void reported.push(e),
    mustNotReveal: o.mustNotReveal ?? [],
    lockedCheck: o.lockedCheck ?? (() => Promise.resolve(false)),
    ...(o.holdAll === undefined ? {} : { holdAll: o.holdAll }),
    track: (p: Promise<unknown>) => void tracked.push(p),
  };
  return {
    clock,
    spy,
    registry,
    shown,
    recorded,
    outputs,
    reported,
    tracked,
    cancel,
    input,
    get checks() {
      return checks;
    },
    run: () => clock.drive(runToolLoop(input)),
  };
}

const demoDecision = {
  move: 'hint' as const,
  rung: 1 as const,
  mustNotReveal: [],
  systemPrompt: 'SYSTEM',
  tools: ['calculator'],
  maxOutputTokens: 300,
};

const lastResults = (req: ModelRequest | undefined) =>
  (JSON.parse(req?.messages.at(-1)?.content ?? '{}') as { tool_results: unknown[] }).tool_results;

describe('runToolLoop: rounds', () => {
  it('0 rounds: one call with the tools offered; text is shown and joined; usage recorded', async () => {
    const s = setup([[say('Think about '), say('denominators.'), used]]);
    const out = await s.run();
    expect(out).toEqual({
      draft: 'Think about denominators.',
      raw: 'Think about denominators.',
      toolRounds: 0,
    });
    // Shown a sentence at a time, once the locked check passed it (4.6).
    expect(s.shown).toEqual(['Think about denominators.']);
    expect(s.recorded).toEqual([usageMain]);
    expect(s.spy.requests).toHaveLength(1);
    expect(s.spy.requests[0]?.tools?.map((t) => t.name)).toEqual(['calculator']);
    expect(s.spy.requests[0]?.messages).toEqual(base.messages);
    expect(s.checks).toBe(1);
  });

  it('raw keeps at most one reply of model text (fix round 1)', async () => {
    const s = setup([[say('a'.repeat(LIMITS.modelTextMaxLength - 10)), say('b'.repeat(50)), used]]);
    const out = await s.run();
    expect(out.raw).toHaveLength(LIMITS.modelTextMaxLength);
    expect(out.raw.endsWith('b'.repeat(10))).toBe(true);
  });

  it('no tools offered: the request has no tools field', async () => {
    const s = setup([[say('Hi.'), used]], { tools: [] });
    await s.run();
    expect(s.spy.requests[0]).not.toHaveProperty('tools');
  });

  it('1 round: runs the tool, then sends the call and result envelopes back', async () => {
    const s = setup([
      [say('Let me check. '), call('c1'), used],
      [say('So it is a sixth-based sum.'), used],
    ]);
    const out = await s.run();
    expect(out).toEqual({
      draft: 'Let me check. So it is a sixth-based sum.',
      raw: 'Let me check. So it is a sixth-based sum.',
      toolRounds: 1,
    });
    expect(s.registry.runs).toEqual([{ name: 'calculator', input: { expression: '1/2+1/3' } }]);
    expect(s.outputs).toEqual([{ name: 'calculator', output: { value: '5/6' } }]);
    const second = s.spy.requests[1];
    expect(second?.tools?.map((t) => t.name)).toEqual(['calculator']);
    expect(second?.messages.slice(0, 1)).toEqual(base.messages);
    expect(second?.messages[1]).toEqual({
      role: 'assistant',
      content:
        'Let me check. \n{"tool_calls":[{"id":"c1","name":"calculator","args":{"expression":"1/2+1/3"}}]}',
    });
    expect(lastResults(second)).toEqual([
      { id: 'c1', name: 'calculator', ok: true, output: { value: '5/6' } },
    ]);
    expect(s.recorded).toEqual([usageMain, usageMain]);
    expect(s.checks).toBe(2);
  });

  it(`${MAX_TOOL_ROUNDS} rounds, then a final call with no tools`, async () => {
    const s = setup([
      [say('a'), call('c1'), used],
      [say('b'), call('c2'), used],
      [say('c'), call('c3'), used],
      [say('d'), used],
    ]);
    const out = await s.run();
    expect(out).toEqual({ draft: 'abcd', raw: 'abcd', toolRounds: 3 });
    expect(s.spy.requests.map((r) => r.tools !== undefined)).toEqual([true, true, true, false]);
    expect(s.spy.requests[3]?.messages).toHaveLength(1 + 2 * 3);
    expect(s.registry.runs).toHaveLength(3);
  });

  it('a tool_call on the final call (no tools offered) fails the attempt and closes the stream', async () => {
    const s = setup([
      [call('c1'), used],
      [call('c2'), used],
      [call('c3'), used],
      [say('x'), call('c4'), say('never'), used],
    ]);
    await expect(s.run()).rejects.toBeInstanceOf(ToolCallNotOfferedError);
    expect(s.registry.runs).toHaveLength(3);
    // "x" never reached a sentence end, so it was never checked and never shown (4.6).
    expect(s.shown).toEqual([]);
    expect(s.spy.returns).toBe(1);
  });

  it('a tool_call when no tool was ever offered fails the attempt; nothing runs', async () => {
    const s = setup([[call('c1'), used]], { tools: [] });
    const err = await s.run().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ToolCallNotOfferedError);
    expect(String(err)).not.toContain('calculator');
  });
});

describe('runToolLoop: each call is checked', () => {
  it('a name that was not offered → not_available; nothing runs', async () => {
    const s = setup([
      [call('c1', 'shell.exec', {}), used],
      [say('ok'), used],
    ]);
    await s.run();
    expect(s.registry.runs).toEqual([]);
    expect(lastResults(s.spy.requests[1])).toEqual([
      { id: 'c1', name: 'shell.exec', ok: false, error: 'not_available' },
    ]);
  });

  it('args that fail tool.input → invalid_arguments; the tool is not run', async () => {
    const s = setup([
      [call('c1', 'calculator', { expression: 7 }), used],
      [say('ok'), used],
    ]);
    await s.run();
    expect(s.registry.runs).toEqual([]);
    expect(lastResults(s.spy.requests[1])).toEqual([
      { id: 'c1', name: 'calculator', ok: false, error: 'invalid_arguments' },
    ]);
  });

  it('args that are not JSON-safe → invalid_arguments, echoed back as null', async () => {
    const s = setup([
      [call('c1', 'calculator', 1n), used],
      [say('ok'), used],
    ]);
    // ScriptedGateway deep-copies plain data only, so the BigInt arrives as is.
    await s.run();
    expect(s.registry.runs).toEqual([]);
    const assistant = JSON.parse(
      (s.spy.requests[1]?.messages[1]?.content ?? '').split('\n').at(-1) ?? '{}',
    ) as { tool_calls: { args: unknown }[] };
    expect(assistant.tool_calls[0]?.args).toBeNull();
  });

  it('an output that fails tool.output → failed; the internals never reach the model', async () => {
    const bad = testTool({
      ...calculator.tool,
      output: z.strictObject({ value: z.string() }),
      run: () => Promise.resolve({ value: 5, internal: 'SECRET_INTERNAL' }),
    });
    const s = setup(
      [
        [call('c1'), used],
        [say('ok'), used],
      ],
      { tools: [bad] },
    );
    await s.run();
    expect(lastResults(s.spy.requests[1])).toEqual([
      { id: 'c1', name: 'calculator', ok: false, error: 'failed' },
    ]);
    expect(JSON.stringify(s.spy.requests)).not.toContain('SECRET_INTERNAL');
    expect(s.outputs).toEqual([]);
  });

  it('a throwing tool → failed; its message never reaches the model', async () => {
    const throwing = testTool({
      ...calculator.tool,
      run: () => Promise.reject(new Error('SECRET_STACK')),
    });
    const s = setup(
      [
        [call('c1'), used],
        [say('ok'), used],
      ],
      { tools: [throwing] },
    );
    await s.run();
    expect(lastResults(s.spy.requests[1])).toEqual([
      { id: 'c1', name: 'calculator', ok: false, error: 'failed' },
    ]);
    expect(JSON.stringify(s.spy.requests)).not.toContain('SECRET_STACK');
  });

  it(`an output over ${TOOL_RESULT_MAX_JSON_LENGTH} JSON characters → failed`, async () => {
    const big = testTool({
      ...calculator.tool,
      output: z.unknown(),
      run: () => Promise.resolve({ value: 'x'.repeat(TOOL_RESULT_MAX_JSON_LENGTH) }),
    });
    const s = setup(
      [
        [call('c1'), used],
        [say('ok'), used],
      ],
      { tools: [big] },
    );
    await s.run();
    expect(lastResults(s.spy.requests[1])).toEqual([
      { id: 'c1', name: 'calculator', ok: false, error: 'failed' },
    ]);
  });

  it('an output that is not JSON-safe → failed', async () => {
    const odd = testTool({
      ...calculator.tool,
      output: z.unknown(),
      run: () => Promise.resolve(1n),
    });
    const s = setup(
      [
        [call('c1'), used],
        [say('ok'), used],
      ],
      { tools: [odd] },
    );
    await s.run();
    expect(lastResults(s.spy.requests[1])).toEqual([
      { id: 'c1', name: 'calculator', ok: false, error: 'failed' },
    ]);
  });

  it(`a tool slower than ${TOOL_TIMEOUT_MS} ms → timed_out, on the virtual clock`, async () => {
    const holder: { clock?: { sleep(ms: number): Promise<void> } } = {};
    const slow = testTool({
      ...calculator.tool,
      run: async () => {
        await holder.clock?.sleep(10_000);
        return { value: 'late' };
      },
    });
    const s = setup(
      [
        [call('c1'), used],
        [say('ok'), used],
      ],
      { tools: [slow] },
    );
    holder.clock = s.clock;
    const started = s.clock.now();
    await s.run();
    expect(lastResults(s.spy.requests[1])).toEqual([
      { id: 'c1', name: 'calculator', ok: false, error: 'timed_out' },
    ]);
    expect(s.clock.now() - started).toBeGreaterThanOrEqual(TOOL_TIMEOUT_MS);
    expect(s.clock.now() - started).toBeLessThan(10_000);
  }, 10_000);

  it(`runs at most ${MAX_TOOL_CALLS_PER_ROUND} calls per round, in order; the rest get too_many_calls`, async () => {
    const calls = Array.from({ length: 6 }, (_, i) => call(`c${i}`));
    const s = setup([
      [...calls, used],
      [say('ok'), used],
    ]);
    await s.run();
    expect(s.registry.runs).toHaveLength(MAX_TOOL_CALLS_PER_ROUND);
    const results = lastResults(s.spy.requests[1]) as { id: string; ok: boolean; error?: string }[];
    expect(results.map((r) => [r.id, r.ok ? 'ok' : r.error])).toEqual([
      ['c0', 'ok'],
      ['c1', 'ok'],
      ['c2', 'ok'],
      ['c3', 'ok'],
      ['c4', 'too_many_calls'],
      ['c5', 'too_many_calls'],
    ]);
  });
});

describe('runToolLoop: cost and cancel', () => {
  it('a usage over the ceiling stops reading at once and closes the stream', async () => {
    const s = setup([[say('a'), used, say('never')]], {
      recorder: {
        record: () => {
          throw new TurnAbort('turn_cost_exceeded');
        },
      },
    });
    await expect(s.run()).rejects.toBeInstanceOf(TurnAbort);
    // Held for its sentence end, then the attempt stopped: never shown (4.6).
    expect(s.shown).toEqual([]);
    expect(s.spy.returns).toBe(1);
  });

  it('a refused call makes no stream call', async () => {
    const s = setup([[say('a'), used]], {
      recorder: {
        checkBeforeCall: () => {
          throw new TurnAbort('turn_cost_exceeded');
        },
      },
    });
    await expect(s.run()).rejects.toBeInstanceOf(TurnAbort);
    expect(s.spy.requests).toEqual([]);
  });

  it('a cancel during a tool run stops the loop with TurnCancelled', async () => {
    const holder: { cancel?: () => void } = {};
    const hanging = testTool({
      ...calculator.tool,
      run: () => {
        holder.cancel?.();
        return new Promise(() => undefined);
      },
    });
    const s = setup(
      [
        [call('c1'), used],
        [say('never'), used],
      ],
      { tools: [hanging] },
    );
    holder.cancel = () => s.cancel.cancel();
    await expect(s.run()).rejects.toBeInstanceOf(TurnCancelled);
    expect(s.spy.requests).toHaveLength(1);
  });

  it('a stream() that throws synchronously fails the attempt', async () => {
    const s = setup([[say('a')]]);
    s.input.gateway = {
      ...s.spy,
      stream: () => {
        throw new Error('sync stream failure');
      },
    };
    await expect(s.run()).rejects.toThrow('sync stream failure');
  });
});

describe('runToolLoop: fix round (answer key, reports, order, close tracking)', () => {
  const reportedTools = (r: unknown[]) =>
    r
      .filter((e): e is ToolFailed => e instanceof ToolFailed)
      .map((e) => [e.tool, e.reason, e.causeName]);

  it.each([
    ['plain', { value: '5/6' }],
    ['spaced and fullwidth', { value: '５ / ６' }],
    ['zero-width split', { value: '5​/6' }],
  ])(
    'an output holding the answer key (%s) → failed and reported; it never reaches the model',
    async (_n, output) => {
      const leaky = testTool({
        ...calculator.tool,
        output: z.unknown(),
        run: () => Promise.resolve(output),
      });
      const s = setup(
        [
          [call('c1'), used],
          [say('ok'), used],
        ],
        { tools: [leaky], mustNotReveal: ['5/6'] },
      );
      await s.run();
      expect(lastResults(s.spy.requests[1])).toEqual([
        { id: 'c1', name: 'calculator', ok: false, error: 'failed' },
      ]);
      expect(s.outputs).toEqual([]);
      expect(reportedTools(s.reported)).toEqual([['calculator', 'answer_key', undefined]]);
    },
  );

  it('a throwing tool is reported by error name only', async () => {
    const throwing = testTool({
      ...calculator.tool,
      run: () => Promise.reject(new RangeError('SECRET_STUDENT_TEXT')),
    });
    const s = setup(
      [
        [call('c1'), used],
        [say('ok'), used],
      ],
      { tools: [throwing] },
    );
    await s.run();
    expect(reportedTools(s.reported)).toEqual([['calculator', 'failed', 'RangeError']]);
    expect(JSON.stringify(s.reported.map(String))).not.toContain('SECRET_STUDENT_TEXT');
  });

  it('an output that fails tool.output is reported as invalid_output', async () => {
    const bad = testTool({ ...calculator.tool, run: () => Promise.resolve({ value: 5 }) });
    const s = setup(
      [
        [call('c1'), used],
        [say('ok'), used],
      ],
      { tools: [bad] },
    );
    await s.run();
    expect(reportedTools(s.reported)).toEqual([['calculator', 'invalid_output', undefined]]);
  });

  it('a timed-out tool is reported as timed_out', async () => {
    const holder: { clock?: { sleep(ms: number): Promise<void> } } = {};
    const slow = testTool({
      ...calculator.tool,
      run: async () => {
        await holder.clock?.sleep(10_000);
        return { value: 'late' };
      },
    });
    const s = setup(
      [
        [call('c1'), used],
        [say('ok'), used],
      ],
      { tools: [slow] },
    );
    holder.clock = s.clock;
    await s.run();
    expect(reportedTools(s.reported)).toEqual([['calculator', 'timed_out', undefined]]);
  }, 10_000);

  it('an unknown tool past the per-round cap is still not_available', async () => {
    const calls = [
      ...Array.from({ length: 4 }, (_, i) => call(`c${i}`)),
      call('c4', 'shell.exec', {}),
    ];
    const s = setup([
      [...calls, used],
      [say('ok'), used],
    ]);
    await s.run();
    const results = lastResults(s.spy.requests[1]) as { id: string; error?: string }[];
    expect(results.at(-1)).toMatchObject({ id: 'c4', error: 'not_available' });
  });

  it('hands every early stream close to track, so the runner can wait for it', async () => {
    const s = setup([[say('x'), call('c1'), used]], { tools: [] });
    await expect(s.run()).rejects.toBeInstanceOf(ToolCallNotOfferedError);
    expect(s.tracked).toHaveLength(1);
    await expect(s.tracked[0]).resolves.toBeUndefined();
  });
});

describe('runToolLoop: locked material (4.6)', () => {
  const MATERIAL = 'alpha beta gamma delta epsilon zeta eta theta iota';
  const index = lockedIndex([MATERIAL], []);
  const byIndex: LockedCheck = (texts) => Promise.resolve(index.hits(texts));
  const reasons = (r: unknown[]) =>
    r.filter((e): e is ToolFailed => e instanceof ToolFailed).map((e) => [e.reason, e.causeName]);
  const toolWith = (output: unknown) =>
    testTool({ ...calculator.tool, output: z.unknown(), run: () => Promise.resolve(output) });

  it('a tool output holding a locked span fails as `locked`; the model never sees it', async () => {
    const s = setup(
      [
        [call('c1'), used],
        [say('ok'), used],
      ],
      { tools: [toolWith({ note: `Here: ${MATERIAL}` })], lockedCheck: byIndex },
    );
    await s.run();
    expect(lastResults(s.spy.requests[1])).toEqual([
      { id: 'c1', name: 'calculator', ok: false, error: 'failed' },
    ]);
    expect(JSON.stringify(s.spy.requests)).not.toContain('alpha beta');
    expect(s.outputs).toEqual([]);
    expect(reasons(s.reported)).toEqual([['locked', undefined]]);
  }, 5_000);

  it('checks each string leaf and the leaves joined, never only the JSON text', async () => {
    const seen: (readonly string[])[] = [];
    const s = setup(
      [
        [call('c1'), used],
        [say('ok'), used],
      ],
      {
        tools: [toolWith({ lines: ['alpha beta gamma delta', 'epsilon zeta eta theta'] })],
        lockedCheck: (texts) => {
          seen.push(texts);
          return byIndex(texts);
        },
      },
    );
    await s.run();
    expect(seen[0]).toEqual([
      'lines',
      'alpha beta gamma delta',
      'epsilon zeta eta theta',
      'lines alpha beta gamma delta epsilon zeta eta theta',
    ]);
    expect(reasons(s.reported)).toEqual([['locked', undefined]]);
  }, 5_000);

  it('a check that rejects fails the call closed, reported by error name only', async () => {
    const s = setup(
      [
        [call('c1'), used],
        [say('ok'), used],
      ],
      {
        tools: [toolWith({ value: 'fine' })],
        lockedCheck: (texts) =>
          texts.length > 1
            ? Promise.reject(new LockedCheckFailed('timeout'))
            : Promise.resolve(false),
      },
    );
    const out = await s.run();
    expect(lastResults(s.spy.requests[1])).toEqual([
      { id: 'c1', name: 'calculator', ok: false, error: 'failed' },
    ]);
    expect(reasons(s.reported)).toEqual([['locked', 'LockedCheckFailed']]);
    expect(out.locked).toBeUndefined();
  }, 5_000);

  it('a cancel during the output check still throws only TurnCancelled', async () => {
    const holder: { cancel?: () => void } = {};
    const s = setup([[call('c1'), used]], {
      tools: [toolWith({ value: 'fine' })],
      lockedCheck: (texts) => {
        if (texts.length > 1) {
          holder.cancel?.();
          return new Promise(() => undefined);
        }
        return Promise.resolve(false);
      },
    });
    holder.cancel = () => s.cancel.cancel();
    await expect(s.run()).rejects.toBeInstanceOf(TurnCancelled);
  }, 5_000);

  it('streamed text holding a locked span is withheld from that sentence on', async () => {
    const s = setup(
      [[say('Good question. '), say(`Here it is: ${MATERIAL}. `), say('Bye.'), used]],
      {
        lockedCheck: byIndex,
      },
    );
    const out = await s.run();
    // 4.6b: the clean sentence before the hit is held back (not shown) too, since it had not yet
    // been released when the batch holding the locked span tripped.
    expect(s.shown).toEqual([]);
    expect(out).toMatchObject({ draft: '', locked: 'hit' });
    expect(out.raw).toContain(MATERIAL);
    expect(s.reported.some((e) => e instanceof LockedLeakDetected)).toBe(true);
  }, 5_000);

  it('holdAll (4.6b, ADR-0007 §8): a clean reply streams nothing until the attempt ends', async () => {
    const s = setup([[say('Good question. '), say('Nothing locked here. '), used]], {
      lockedCheck: byIndex,
      holdAll: true,
    });
    const out = await s.run();
    // Nothing shown piece by piece: the whole reply arrives at once, at the clean end.
    expect(s.shown).toEqual(['Good question. Nothing locked here. ']);
    expect(out).toMatchObject({ draft: 'Good question. Nothing locked here. ' });
    expect(out.locked).toBeUndefined();
  }, 5_000);

  it('holdAll still trips on a hit, with nothing shown', async () => {
    const s = setup(
      [[say('Good question. '), say(`Here it is: ${MATERIAL}. `), say('Bye.'), used]],
      { lockedCheck: byIndex, holdAll: true },
    );
    const out = await s.run();
    expect(s.shown).toEqual([]);
    expect(out).toMatchObject({ draft: '', locked: 'hit' });
  }, 5_000);

  it('a span split across tool rounds is still caught (the check is not reset per round)', async () => {
    const s = setup(
      [
        [say('alpha beta gamma delta '), call('c1'), used],
        [say('epsilon zeta eta theta.'), used],
      ],
      { lockedCheck: byIndex },
    );
    const out = await s.run();
    expect(out.locked).toBe('hit');
    expect(out.draft).not.toContain('theta');
  }, 5_000);

  it('a failed stream check withholds and the result says `failed`', async () => {
    const s = setup([[say('Hello there. '), used]], {
      lockedCheck: () => Promise.reject(new LockedCheckFailed('error', 'Error')),
    });
    const out = await s.run();
    expect(s.shown).toEqual([]);
    expect(out.locked).toBe('failed');
  }, 5_000);

  // 4.6b (virtualClock.ts FLUSH_TURNS, a magic number the 4.6 review flagged): rather than
  // guess at "flush until quiet" for a generic virtual clock, this pins the worst case that
  // motivated raising it in the first place — one streamed sentence (and so one awaited
  // lockedCheck call) per model chunk, many chunks in a single round, with no tool call or
  // real timer to force a flush in between. If FLUSH_TURNS is ever too low for this shape of
  // reply, `clock.drive` rejects with "deadlock" instead of resolving, and this test fails.
  it('many single-sentence chunks in one round: the virtual clock still settles (worst case)', async () => {
    const CHUNKS = 400;
    const steps = [
      ...Array.from({ length: CHUNKS }, (_, i) => say(`word${String(i)}. `)),
      used,
    ];
    const s = setup([steps], { lockedCheck: () => Promise.resolve(false) });
    const out = await s.run();
    expect(out.locked).toBeUndefined();
    expect(s.shown.join('')).toBe(steps.filter((c) => c.type === 'text').map((c) => c.text).join(''));
  }, 10_000);

  it('waits for an async onToolOutput before the next call', async () => {
    const order: string[] = [];
    const s = setup([
      [call('c1'), used],
      [say('ok'), used],
    ]);
    s.input.onToolOutput = async () => {
      await Promise.resolve();
      order.push('output handled');
    };
    const req = s.spy.stream.bind(s.spy);
    s.input.gateway = {
      ...s.spy,
      stream: (r) => {
        order.push('model called');
        return req(r);
      },
    };
    await s.run();
    expect(order).toEqual(['model called', 'output handled', 'model called']);
  }, 5_000);
});
