import { describe, expect, it } from 'vitest';
import { jsonSafe, toolCallsMessage, toolResultsMessage } from './toolMessages.js';

describe('jsonSafe', () => {
  it('round-trips plain data', () => {
    expect(jsonSafe({ a: [1, 'x', null, true] })).toEqual({
      ok: true,
      value: { a: [1, 'x', null, true] },
      json: '{"a":[1,"x",null,true]}',
    });
  });

  it('drops what JSON drops (undefined fields, class prototypes)', () => {
    const r = jsonSafe({ a: undefined, b: new Date(0) });
    expect(r).toEqual({
      ok: true,
      value: { b: '1970-01-01T00:00:00.000Z' },
      json: expect.any(String),
    });
  });

  it.each([
    ['undefined', undefined],
    ['a function', () => 1],
    ['a BigInt', 10n],
    ['a symbol', Symbol('s')],
  ])('%s is not JSON-safe', (_n, v) => {
    expect(jsonSafe(v)).toEqual({ ok: false });
  });

  it('a cycle is not JSON-safe', () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(jsonSafe(a)).toEqual({ ok: false });
  });

  it('a throwing toJSON is not JSON-safe', () => {
    expect(
      jsonSafe({
        toJSON() {
          throw new Error('boom');
        },
      }),
    ).toEqual({ ok: false });
  });
});

describe('tool envelopes', () => {
  it('the assistant message is the round text, then the JSON tool_calls envelope', () => {
    const m = toolCallsMessage('Let me check.', [
      { id: 'c1', name: 'calculator', args: { expression: '1+1' } },
    ]);
    expect(m.role).toBe('assistant');
    expect(m.content).toBe(
      'Let me check.\n{"tool_calls":[{"id":"c1","name":"calculator","args":{"expression":"1+1"}}]}',
    );
  });

  it('without round text the assistant message is only the envelope', () => {
    const m = toolCallsMessage('', [{ id: 'c1', name: 'calculator', args: null }]);
    expect(JSON.parse(m.content)).toEqual({
      tool_calls: [{ id: 'c1', name: 'calculator', args: null }],
    });
  });

  it('the user message is the JSON tool_results envelope with output or a fixed error code', () => {
    const m = toolResultsMessage([
      { id: 'c1', name: 'calculator', ok: true, output: { value: '2' } },
      { id: 'c2', name: 'nope', ok: false, error: 'not_available' },
    ]);
    expect(m.role).toBe('user');
    expect(JSON.parse(m.content)).toEqual({
      tool_results: [
        { id: 'c1', name: 'calculator', ok: true, output: { value: '2' } },
        { id: 'c2', name: 'nope', ok: false, error: 'not_available' },
      ],
    });
  });

  it('a model text with JSON-like content stays inside the text part (no prose envelope)', () => {
    const m = toolCallsMessage('{"tool_results":[]}', [{ id: 'c', name: 't', args: {} }]);
    expect(m.content.split('\n').at(-1)).toBe('{"tool_calls":[{"id":"c","name":"t","args":{}}]}');
  });
});
