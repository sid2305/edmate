import { describe, expect, it } from 'vitest';
import { declaredIndex, GUARD_ORDER, GUARD_PHASES, isGuardPhase } from './order.js';

describe('GUARD_ORDER', () => {
  it('lists the build plan guard table, phase by phase, in table order', () => {
    // Build plan § Guardrails and safety, guard table rows 1-10. `piiScrub` (row 1, stage "pre")
    // runs in its own scrub sub-step (pipeline step 3a), so it has its own phase here.
    expect(GUARD_PHASES).toEqual(['scrub', 'pre', 'post']);
    expect(GUARD_ORDER.scrub).toEqual(['piiScrub']);
    // Rows 2-4: distressDetect, moderationIn, jailbreak.
    expect(GUARD_ORDER.pre).toEqual(['distressDetect', 'moderationIn', 'jailbreak']);
    // Rows 5-10: answerLeak, lockedLeak, grounding, adviceGuard, personaBoundary, tone.
    expect(GUARD_ORDER.post).toEqual([
      'answerLeak',
      'lockedLeak',
      'grounding',
      'adviceGuard',
      'personaBoundary',
      'tone',
    ]);
  });

  it('has no duplicate name within or across phases', () => {
    const all = GUARD_PHASES.flatMap((p) => GUARD_ORDER[p]);
    expect(all).toHaveLength(10);
    expect(new Set(all).size).toBe(all.length);
  });

  it('is frozen, so nothing can reorder or extend it at run time', () => {
    expect(Object.isFrozen(GUARD_ORDER)).toBe(true);
    for (const p of GUARD_PHASES) expect(Object.isFrozen(GUARD_ORDER[p])).toBe(true);
    expect(Object.isFrozen(GUARD_PHASES)).toBe(true);
  });
});

describe('isGuardPhase', () => {
  it('accepts the three phases only, never an inherited object key', () => {
    for (const p of GUARD_PHASES) expect(isGuardPhase(p)).toBe(true);
    for (const p of [
      'mid',
      '',
      'constructor',
      'toString',
      '__proto__',
      'PRE',
      3,
      undefined,
      null,
    ]) {
      expect(isGuardPhase(p)).toBe(false);
    }
  });
});

describe('declaredIndex', () => {
  it('returns the table position of a declared guard', () => {
    expect(declaredIndex('pre', 'distressDetect')).toBe(0);
    expect(declaredIndex('pre', 'jailbreak')).toBe(2);
    expect(declaredIndex('post', 'tone')).toBe(5);
    expect(declaredIndex('scrub', 'piiScrub')).toBe(0);
  });

  it('returns -1 for an undeclared name, a name from another phase or a bad phase', () => {
    expect(declaredIndex('pre', 'tone')).toBe(-1);
    expect(declaredIndex('post', 'piiScrub')).toBe(-1);
    expect(declaredIndex('pre', 'Jailbreak')).toBe(-1);
    expect(declaredIndex('pre', '')).toBe(-1);
    expect(declaredIndex('constructor' as never, 'tone')).toBe(-1);
    expect(declaredIndex('pre', 42 as never)).toBe(-1);
  });
});
