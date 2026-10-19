import type { ModelChunk, ModelRequest, Usage } from '@edmate/contracts';
import { turnContextFull, usageMain } from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { memoryToolRegistry, testTool } from '../../testing/memoryToolRegistry.js';
import { type StreamStep, ScriptedGateway } from '../../testing/scriptedGateway.js';
import { spyGateway } from '../../testing/spyGateway.js';
import { virtualClock } from '../../testing/virtualClock.js';
import { cancelSource } from '../clock.js';
import { TurnAbort, TurnCancelled } from '../errors.js';
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
  o: { tools?: RegisteredTool[]; recorder?: Partial<UsageRecorder>; mustNotReveal?: string[] } = {},
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
    onToolOutput: (r: RegisteredTool, output: unknown) =>
      void outputs.push({ name: r.tool.name, output }),
    report: (e: unknown) => void reported.push(e),
    mustNotReveal: o.mustNotReveal ?? [],
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
    expect(out).toEqual({ draft: 'Think about denominators.', toolRounds: 0 });
    expect(s.shown).toEqual(['Think about ', 'denominators.']);
    expect(s.recorded).toEqual([usageMain]);
    expect(s.spy.requests).toHaveLength(1);
    expect(s.spy.requests[0]?.tools?.map((t) => t.name)).toEqual(['calculator']);
    expect(s.spy.requests[0]?.messages).toEqual(base.messages);
    expect(s.checks).toBe(1);
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
    expect(out).toEqual({ draft: 'Let me check. So it is a sixth-based sum.', toolRounds: 1 });
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
    expect(out).toEqual({ draft: 'abcd', toolRounds: 3 });
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
    expect(s.shown).toEqual(['x']);
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
    expect(s.shown).toEqual(['a']);
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
