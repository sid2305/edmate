import type { ModelChunk, ModelRequest } from '@edmate/contracts';
import { turnContextFull, usageMain } from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { cancelSource } from '../pipeline/clock.js';
import { runToolLoop, ToolFailed } from '../pipeline/generate/toolLoop.js';
import { passThroughGate } from '../pipeline/generate/streamGate.js';
import type { RegisteredTool } from '../pipeline/tools.js';
import { toolSpec } from '../pipeline/tools.js';
import { memoryToolRegistry } from '../testing/memoryToolRegistry.js';
import { ScriptedGateway } from '../testing/scriptedGateway.js';
import { spyGateway } from '../testing/spyGateway.js';
import { virtualClock } from '../testing/virtualClock.js';
import { calculatorTool } from './calculator.js';
import { CalculatorError, CALCULATOR_MAX_EXPRESSION_LENGTH } from './sandbox.js';

const { tool } = calculatorTool;

describe('calculatorTool', () => {
  it('is the coach-skill calculator with no presenter (5.5 Q3)', () => {
    expect(tool.name).toBe('calculator');
    expect(tool.skill).toBe('coach');
    expect(tool.description.length).toBeGreaterThan(0);
    expect(calculatorTool).not.toHaveProperty('present');
  });

  it('runs one expression and returns its value as a string', async () => {
    await expect(tool.run({ expression: '1/2 + 1/4' }, turnContextFull)).resolves.toEqual({
      value: '0.75',
    });
  });

  it('rejects with a CalculatorError outside its scope', async () => {
    await expect(tool.run({ expression: 'process' }, turnContextFull)).rejects.toThrow(
      CalculatorError,
    );
  });

  it.each([
    ['a valid expression', { expression: '2+2' }, true],
    [
      `exactly ${CALCULATOR_MAX_EXPRESSION_LENGTH} characters`,
      { expression: '1'.repeat(CALCULATOR_MAX_EXPRESSION_LENGTH) },
      true,
    ],
    ['an empty expression', { expression: '' }, false],
    [
      'too long an expression',
      { expression: '1'.repeat(CALCULATOR_MAX_EXPRESSION_LENGTH + 1) },
      false,
    ],
    ['a number, not a string', { expression: 2 }, false],
    ['a missing expression', {}, false],
    ['an extra key', { expression: '1', scope: { x: 1 } }, false],
    ['null', null, false],
  ])('input schema: %s → %s', (_label, input, ok) => {
    expect(tool.input.safeParse(input).success).toBe(ok);
  });

  it.each([
    [{ value: '3' }, true],
    [{ value: 3 }, false],
    [{ value: '3', extra: 1 }, false],
  ])('output schema: %j → %s', (output, ok) => {
    expect(tool.output.safeParse(output).success).toBe(ok);
  });

  it('describes its input to the model as a JSON Schema with the length cap', () => {
    expect(toolSpec(calculatorTool).inputSchema).toMatchObject({
      type: 'object',
      properties: {
        expression: { type: 'string', minLength: 1, maxLength: CALCULATOR_MAX_EXPRESSION_LENGTH },
      },
      required: ['expression'],
      additionalProperties: false,
    });
  });
});

describe('calculatorTool through the tool loop (behaves like 3.7’s fake calculator)', () => {
  const base: ModelRequest = {
    tier: 'main',
    system: 'SYSTEM',
    messages: [{ role: 'user', content: 'How do I add 1/2 and 1/3?' }],
    maxOutputTokens: 300,
  };
  const call = (id: string, expression: string) =>
    ({ type: 'tool_call', id, name: 'calculator', args: { expression } }) satisfies ModelChunk;
  const say = (text: string) => ({ type: 'text', text }) satisfies ModelChunk;
  const used = { type: 'usage', usage: usageMain } satisfies ModelChunk;

  async function loop(expression: string) {
    const clock = virtualClock();
    const spy = spyGateway(
      new ScriptedGateway(
        {
          stream: [
            { steps: [say('Let me check. '), call('c1', expression), used] },
            { steps: [say('Done.'), used] },
          ],
        },
        clock,
      ),
    );
    const registry = memoryToolRegistry([calculatorTool]);
    const outputs: unknown[] = [];
    const reported: unknown[] = [];
    const out = await clock.drive(
      runToolLoop({
        gateway: spy,
        request: base,
        offered: registry.list(),
        ctx: turnContextFull,
        clock,
        cancel: cancelSource().token,
        usage: { record: () => undefined, checkBeforeCall: () => undefined },
        gate: passThroughGate({
          ctx: turnContextFull,
          decision: {
            move: 'hint',
            rung: 1,
            mustNotReveal: [],
            systemPrompt: 'SYSTEM',
            tools: ['calculator'],
            maxOutputTokens: 300,
          },
        }),
        show: () => undefined,
        onToolOutput: (_r: RegisteredTool, output: unknown) => void outputs.push(output),
        report: (e: unknown) => void reported.push(e),
        mustNotReveal: [],
        lockedCheck: () => Promise.resolve(false),
        track: () => undefined,
      }),
    );
    const last = spy.requests[1]?.messages.at(-1)?.content ?? '{}';
    return {
      out,
      runs: registry.runs,
      outputs,
      reported,
      results: (JSON.parse(last) as { tool_results: unknown[] }).tool_results,
    };
  }

  it('a valid call runs and its value goes back to the model', async () => {
    const s = await loop('1/2+1/4');
    expect(s.out.toolRounds).toBe(1);
    expect(s.runs).toEqual([{ name: 'calculator', input: { expression: '1/2+1/4' } }]);
    expect(s.outputs).toEqual([{ value: '0.75' }]);
    expect(s.results).toEqual([
      { id: 'c1', name: 'calculator', ok: true, output: { value: '0.75' } },
    ]);
    expect(s.reported).toEqual([]);
  });

  it('an out-of-scope call fails as ToolFailed(failed, CalculatorError); the model sees only failed', async () => {
    const s = await loop('globalThis');
    expect(s.outputs).toEqual([]);
    expect(s.reported).toHaveLength(1);
    expect(s.reported[0]).toBeInstanceOf(ToolFailed);
    expect(s.reported[0]).toMatchObject({
      tool: 'calculator',
      reason: 'failed',
      causeName: 'CalculatorError',
    });
    expect(JSON.stringify(s.results)).not.toContain('globalThis');
    expect(s.results).toEqual([expect.objectContaining({ id: 'c1', ok: false })]);
  });
});
