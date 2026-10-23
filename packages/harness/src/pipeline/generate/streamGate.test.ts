import { demoPedagogyDecision, demoTurnContext } from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { LIMITS } from '@edmate/contracts';
import { type AnswerKeyMatcher, compileAnswerKeys } from './answerKey.js';
import type { ItemContext } from './itemContext.js';
import {
  answerLeakStreamGate,
  HOLD_MAX,
  passThroughGate,
  SENTENCE_GATE_CAP,
  sentenceGate,
  type StreamGate,
} from './streamGate.js';

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

// 5.6b Phase B: the active item's re-show. Synthetic items; the MCQ prompts neither show nor
// compute to their correct option (lead answer on the Phase A note).
const LOOP_A: ItemContext = {
  prompt: 'Which loop always runs its body at least once?',
  options: ['A) do-while loop', 'B) for loop', 'C) while loop'],
  answerKey: ['A'],
};
const LOOP_B: ItemContext = { ...LOOP_A, answerKey: ['B'] };
const CODE: ItemContext = {
  prompt: 'What does this code print?\nprint(4)\n# it runs once',
  answerKey: ['4'],
};
const listing = (it: ItemContext) => (it.options ?? []).join('\n');

/** The same text pushed whole, one unit at a time, in 3-unit pieces and split at each newline. */
function splits(text: string): string[][] {
  const threes: string[] = [];
  for (let i = 0; i < text.length; i += 3) threes.push(text.slice(i, i + 3));
  return [[text], text.split(''), threes, text.split(/(?<=\n)/u)];
}

function runAll(g: StreamGate, chunks: readonly string[]): string {
  const out: string[] = [];
  for (const c of chunks) out.push(...g.push(c));
  out.push(...g.flush());
  return out.join('');
}

const itemGate = (items: ItemContext[], mustNotReveal: string[] = []) =>
  answerLeakStreamGate({
    ctx: demoTurnContext,
    decision: { ...demoPedagogyDecision, mustNotReveal },
    items,
    practiceKeys: items.flatMap((i) => i.answerKey),
  });

describe('the re-show hold-back (5.6b)', () => {
  it('an MCQ re-shown with its correct option listed first (key A) is delivered whole', () => {
    const text = `Here it is again.\n${LOOP_A.prompt}\n${listing(LOOP_A)}\nTake your time.`;
    for (const chunks of splits(text)) {
      const g = itemGate([LOOP_A]);
      expect(runAll(g, chunks)).toBe(text);
      expect(g.tripped).toBe(false);
    }
  });

  it('the listing alone (no prompt before it) is delivered too', () => {
    const text = `Your options:\n${listing(LOOP_A)}\n`;
    for (const chunks of splits(text)) {
      const g = itemGate([LOOP_A]);
      expect(runAll(g, chunks)).toBe(text);
      expect(g.tripped).toBe(false);
    }
  });

  it('a 3-line code_output prompt with its output on line 2 is delivered whole', () => {
    const text = `Look again:\n${CODE.prompt}\nWhat do you think it prints?`;
    for (const chunks of splits(text)) {
      const g = itemGate([CODE]);
      expect(runAll(g, chunks)).toBe(text);
      expect(g.tripped).toBe(false);
    }
  });

  it('the generated sum "What is 3 + 4?" restated is delivered', () => {
    const sum: ItemContext = { prompt: 'What is 3 + 4?', answerKey: ['7'] };
    const text = 'Let us try it once more. What is 3 + 4? Take your time.';
    for (const chunks of splits(text)) {
      const g = itemGate([sum]);
      expect(runAll(g, chunks)).toBe(text);
    }
  });

  it('the listing followed by "B is right" leaks, and nothing of the leak is shown', () => {
    const text = `${LOOP_B.prompt}\n${listing(LOOP_B)}\nB is right.`;
    for (const chunks of splits(text)) {
      const g = itemGate([LOOP_B]);
      const shown = runAll(g, chunks);
      expect(g.tripped).toBe(true);
      expect(shown).not.toContain('B is right');
    }
  });

  it('a restated code prompt followed by its output leaks', () => {
    const text = `${CODE.prompt}\nIt prints 4.`;
    for (const chunks of splits(text)) {
      const g = itemGate([CODE]);
      runAll(g, chunks);
      expect(g.tripped).toBe(true);
    }
  });

  it('holds a possible re-show until it completes', () => {
    const g = itemGate([LOOP_A]);
    expect(g.push(`${LOOP_A.prompt}\nA) do-while loop\n`)).toEqual([`${LOOP_A.prompt}\n`]);
    expect(g.push('B) for loop\n')).toEqual([]);
    expect(g.push('C) while loop\nOK?')).toEqual([
      'A) do-while loop\nB) for loop\nC) while loop\n',
    ]);
    expect(g.flush()).toEqual(['OK?']);
    expect(g.tripped).toBe(false);
  });

  it('a prefix that stops matching is judged as normal: shown when clean, held when it leaks', () => {
    const clean = itemGate([LOOP_A]);
    expect(clean.push('Which loop runs first? ')).toEqual(['Which loop runs first? ']);
    for (const chunks of splits('A) do-while loop is the one.\n')) {
      const g = itemGate([LOOP_A]);
      runAll(g, chunks);
      expect(g.tripped).toBe(true);
    }
  });

  it('a reordered or partial listing is not a re-show: it is judged as normal (leaks)', () => {
    for (const text of [
      'B) for loop\nA) do-while loop\nC) while loop\n',
      'A) do-while loop\nB) for loop\n',
    ]) {
      for (const chunks of splits(text)) {
        const g = itemGate([LOOP_A]);
        runAll(g, chunks);
        expect(g.tripped).toBe(true);
      }
    }
  });

  it('without item context the same listing trips the gate (the context is what exempts it)', () => {
    const g = itemGate([], ['A']);
    runAll(g, [`${listing(LOOP_A)}\n`]);
    expect(g.tripped).toBe(true);
  });

  it('a look-alike or a surrogate pair split across pushes keeps the cursor in step', () => {
    const item: ItemContext = { ...LOOP_B, prompt: 'Which loop 🙂 always runs its body?' };
    const text = `${item.prompt}\n${listing(item)}\nTake your time.`;
    for (const chunks of splits(text)) {
      const g = itemGate([item]);
      expect(runAll(g, chunks)).toBe(text);
    }
  });
});

describe('addKeys with items (5.6b)', () => {
  const growGate = () =>
    answerLeakStreamGate({
      ctx: demoTurnContext,
      decision: { ...demoPedagogyDecision, mustNotReveal: [] },
    });

  it('takes an item even when no new key comes with it (empty fresh)', () => {
    const g = growGate();
    expect(g.push('Here is a new one. ')).toEqual(['Here is a new one. ']);
    g.addKeys?.([], [LOOP_A]);
    const text = `${LOOP_A.prompt}\n${listing(LOOP_A)}\n`;
    expect([...g.push(text), ...g.flush()].join('')).toBe(text);
    expect(g.tripped).toBe(false);
  });

  it("an item's own key is guarded once added, outside its spans", () => {
    const g = growGate();
    g.addKeys?.([], [LOOP_A]);
    g.push('The answer is A. ');
    expect(g.tripped).toBe(true);
  });

  it('a second item with the same key: both re-shows are delivered', () => {
    const other: ItemContext = {
      prompt: 'Which keyword leaves a loop early?',
      options: ['A) break', 'B) pass', 'C) return'],
      answerKey: ['A'],
    };
    const g = growGate();
    g.addKeys?.(['A'], [LOOP_A]);
    g.addKeys?.([], [other]);
    const text = `${LOOP_A.prompt}\n${listing(LOOP_A)}\n\n${other.prompt}\n${listing(other)}\nGo!`;
    expect([...g.push(text), ...g.flush()].join('')).toBe(text);
    expect(g.tripped).toBe(false);
  });

  it('text held when the item arrives is fed to its cursor', () => {
    const g = growGate();
    g.addKeys?.(['A'], []);
    expect(g.push('Which loop always runs its body at least once?\nA) do-wh')).toEqual([
      'Which loop always runs its body at least once?\n',
    ]);
    g.addKeys?.([], [LOOP_A]);
    expect([...g.push('ile loop\nB) for loop\nC) while loop\n'), ...g.flush()].join('')).toBe(
      'A) do-while loop\nB) for loop\nC) while loop\n',
    );
    expect(g.tripped).toBe(false);
  });
});

describe('the re-show hold-back stays linear at the item caps (5.6b)', () => {
  it('repeated re-shows of a capped item, pushed in small pieces: each check is bounded', () => {
    const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
    const item: ItemContext = {
      prompt: 'Which pattern below is the best fit for this rule? '.repeat(11).trim(),
      options: letters.map(
        (l) => `${l}) ${'tick '.repeat(30)}${l.toLowerCase()}${l.toLowerCase()}`,
      ),
      answerKey: ['C'],
    };
    expect(item.prompt.length).toBeLessThanOrEqual(600);
    for (const o of item.options ?? []) expect(o.length).toBeLessThanOrEqual(160);
    const m = compileAnswerKeys(['C'], { items: [item], practiceKeys: ['C'] });
    const work = { checks: 0, units: 0 };
    const wrapped: AnswerKeyMatcher = {
      empty: m.empty,
      reach: m.reach,
      leaks: (t) => {
        work.checks++;
        work.units += t.length;
        return m.leaks(t);
      },
      tailStart: (t) => {
        work.units += t.length;
        return m.tailStart(t);
      },
    };
    const g = sentenceGate(wrapped, SENTENCE_GATE_CAP, undefined, [item]);
    const block = `${item.prompt}\n${listing(item)}\nThink about it.\n`;
    let text = '';
    while (text.length + block.length <= LIMITS.modelTextMaxLength) text += block;
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += 7) chunks.push(text.slice(i, i + 7));
    expect(runAll(g, chunks)).toBe(text);
    expect(g.tripped).toBe(false);
    // A whole re-show is judged as one piece, so a check reads at most the window, the cap and
    // the longest held span; the total stays a small multiple of the text pushed.
    expect(work.units / work.checks).toBeLessThanOrEqual(
      2 * (m.reach + SENTENCE_GATE_CAP + HOLD_MAX),
    );
    expect(work.units).toBeLessThanOrEqual(text.length * 4 + work.checks * 2 * m.reach);
  });
});
