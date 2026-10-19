import { demoPedagogyDecision, demoTurnContext } from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { passThroughGate } from './streamGate.js';

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
