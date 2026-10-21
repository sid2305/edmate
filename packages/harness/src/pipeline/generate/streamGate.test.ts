import { demoPedagogyDecision, demoTurnContext } from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { compileAnswerKeys } from './answerKey.js';
import { answerLeakStreamGate, passThroughGate, sentenceGate } from './streamGate.js';

describe('passThroughGate (the 4.5 seam)', () => {
  const gate = () => passThroughGate({ ctx: demoTurnContext, decision: demoPedagogyDecision });

  it('shows each piece as it comes, so first-token latency is unchanged', () => {
    const g = gate();
    expect(g.push('Hello ')).toEqual(['Hello ']);
    expect(g.push('world.')).toEqual(['world.']);
    expect(g.flush()).toEqual([]);
  });

  it('drops empty pieces', () => {
    expect(gate().push('')).toEqual([]);
  });
});

describe('addKeys: a practice key added mid-attempt (5.6, ADR-0010 §4)', () => {
  // Synthetic keys and items.
  const leakGate = (mustNotReveal: string[] = [], studentText?: string) =>
    answerLeakStreamGate({
      ctx: demoTurnContext,
      decision: { ...demoPedagogyDecision, mustNotReveal },
      ...(studentText === undefined ? {} : { studentText }),
    });

  it('with no keys yet, text is shown as it comes (as before)', () => {
    const g = leakGate();
    expect(g.push('Here is your problem. ')).toEqual(['Here is your problem. ']);
    expect(g.push('')).toEqual([]);
    expect(g.flush()).toEqual([]);
    expect(g.tripped).toBe(false);
  });

  it('a key added mid-attempt trips the gate on a later sentence holding it', () => {
    const g = leakGate([], 'my answer?');
    expect(g.push('Here is your problem. ')).toEqual(['Here is your problem. ']);
    g.addKeys?.(['68']);
    expect(g.push('The answer is 68. ')).toEqual([]);
    expect(g.flush()).toEqual([]);
    expect(g.tripped).toBe(true);
  });

  it('the text shown before the key is the window in front: a key split across it is caught', () => {
    const g = leakGate();
    expect(g.push('x = 6')).toEqual(['x = 6']);
    g.addKeys?.(['68']);
    g.push('8 now.');
    expect(g.flush()).toEqual([]);
    expect(g.tripped).toBe(true);
  });

  it('keys add up: the decision key and two items, each still guarded', () => {
    for (const k of ['41', '68', '93']) {
      const g = leakGate(['41']);
      g.addKeys?.(['68']);
      g.addKeys?.(['93']);
      expect(g.push('Try the next one. ')).toEqual(['Try the next one. ']);
      expect(g.push(`It is ${k}. `)).toEqual([]);
      expect(g.tripped).toBe(true);
    }
  });

  it('a clean sentence after the key is shown', () => {
    const g = leakGate();
    g.addKeys?.(['68']);
    expect(g.push('Take your time. ')).toEqual(['Take your time. ']);
    expect(g.flush()).toEqual([]);
    expect(g.tripped).toBe(false);
  });

  it('a gate built without `grow` has no addKeys (it leaves a new key to postGuard)', () => {
    expect(sentenceGate(compileAnswerKeys([])).addKeys).toBeUndefined();
    expect(sentenceGate(compileAnswerKeys(['68'])).addKeys).toBeUndefined();
  });
});
