// Task 4.5: the sentence gate. Keys are synthetic ("16", "Warm", "n % 2 == 0").
import { demoPedagogyDecision, demoTurnContext } from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { type AnswerKeyMatcher, compileAnswerKeys } from './answerKey.js';
import { LIMITS } from '@edmate/contracts';
import {
  answerLeakStreamGate,
  SENTENCE_GATE_CAP,
  sentenceGate,
  type StreamGate,
} from './streamGate.js';

const gate = (keys: string[], cap?: number) => sentenceGate(compileAnswerKeys(keys), cap);

/** Pushes every chunk, then flushes; returns what was shown, joined, and the gate. */
function run(g: StreamGate, chunks: string[]): { shown: string; pieces: string[] } {
  const pieces: string[] = [];
  for (const c of chunks) pieces.push(...g.push(c));
  pieces.push(...g.flush());
  return { shown: pieces.join(''), pieces };
}

describe('sentenceGate: clean text', () => {
  it('shows whole sentences as they complete, the rest at flush', () => {
    const g = gate(['16']);
    expect(g.push('Trace each ')).toEqual([]);
    expect(g.push('line. Then ')).toEqual(['Trace each line. ']);
    expect(g.push('tell me! What')).toEqual(['Then tell me! ']);
    expect(g.push(' next?\nOk')).toEqual(['What next?\n']);
    expect(g.flush()).toEqual(['Ok']);
    expect(g.tripped).toBe(false);
  });

  it('a full stop ends a sentence only before whitespace (or at the end)', () => {
    const g = gate(['16']);
    expect(g.push('Use x.lower() and 3.14 here')).toEqual([]);
    expect(g.push('. ')).toEqual(['Use x.lower() and 3.14 here. ']);
  });

  it('ends sentences at the Devanagari danda too', () => {
    const g = gate(['16']);
    expect(g.push('हर लाइन देखो। फिर')).toEqual(['हर लाइन देखो। ']);
  });

  it('shows unbroken text once the cap is reached, cut at a space', () => {
    const g = gate(['Warm'], 20);
    expect(g.push('aaaa bbbb cccc dddd eeee')).toEqual(['aaaa bbbb cccc dddd ']);
    expect(g.flush()).toEqual(['eeee']);
  });

  it('cuts at the cap with no space, never inside a surrogate pair', () => {
    const g = gate(['Warm'], 4);
    expect(g.push('xyz😀abc')).toEqual(['xyz', '😀ab']);
    expect(g.push('')).toEqual([]);
    expect(run(g, []).shown).toBe('c');
  });

  it('with no keys it shows every piece as it comes', () => {
    const g = gate([]);
    expect(g.push('Hello ')).toEqual(['Hello ']);
    expect(g.push('')).toEqual([]);
    expect(g.flush()).toEqual([]);
    expect(g.tripped).toBe(false);
  });

  it('the default factory compiles the decision and lets the student’s code back', () => {
    const decision = { ...demoPedagogyDecision, mustNotReveal: ['marks >= 80'] };
    const own = answerLeakStreamGate({
      ctx: demoTurnContext,
      decision,
      studentText: 'elif marks >= 80 print Distinction',
    });
    expect(run(own, ['You wrote marks >= 80 second. ']).shown).toBe(
      'You wrote marks >= 80 second. ',
    );
    const other = answerLeakStreamGate({ ctx: demoTurnContext, decision });
    expect(run(other, ['You wrote marks >= 80 second. ']).shown).toBe('');
    expect(other.tripped).toBe(true);
  });
});

describe('sentenceGate: leaks', () => {
  it('withholds a leaking sentence entirely, then shows nothing more', () => {
    const g = gate(['16']);
    expect(g.push('Good try. The answer ')).toEqual(['Good try. ']);
    expect(g.push('is 1')).toEqual([]);
    expect(g.push('6. And more. ')).toEqual([]);
    expect(g.tripped).toBe(true);
    expect(g.push('Clean text. ')).toEqual([]);
    expect(g.flush()).toEqual([]);
  });

  it('flush catches a leak in a buffer that never ended', () => {
    const g = gate(['16']);
    expect(g.push('x ends as sixteen')).toEqual([]);
    expect(g.flush()).toEqual([]);
    expect(g.tripped).toBe(true);
  });

  it('matches a multi-line key across sentences: its first line is held, never shown', () => {
    const g = gate(['n % 2 == 0']);
    const r = run(g, ['Good. Check this: if n % 2\n', '== 0:\n', 'print("Even")\n']);
    expect(r.shown).toBe('Good. ');
    expect(g.tripped).toBe(true);
  });

  it('checks the text already shown plus the new sentence, not the sentence alone', () => {
    const g = gate(['Warm']);
    // Shown at the cap, cut before the possible key start "W".
    expect(g.push('It prints W').join('')).toBe('');
    expect(sentenceGate(compileAnswerKeys(['Warm']), 8).push('It prints W')).toEqual([
      'It ',
      'prints ',
    ]);
    const capped = sentenceGate(compileAnswerKeys(['Warm']), 8);
    capped.push('It prints W');
    expect(capped.push('arm')).toEqual([]);
    expect(capped.flush()).toEqual([]);
    expect(capped.tripped).toBe(true);
  });

  it('a key split across many chunks is never shown in part', () => {
    const g = gate(['Warm']);
    const r = run(g, ['It prints W', 'a', 'r', 'm. Yes.']);
    expect(r.shown).toBe('');
    expect(g.tripped).toBe(true);
  });

  it('a possible key start is held at the cap and shown once it turns out clean', () => {
    const g = gate(['n % 2 == 0'], 12);
    expect(g.push('abcdefghijkl if n % 2')).toEqual(['abcdefghijkl']);
    expect(g.push(' != 1 is odd').join('')).toBe(' if n % 2 != 1 ');
    expect(g.flush()).toEqual(['is odd']);
  });

  it('a leak right at the cap trips the gate', () => {
    const g = gate(['16'], 8);
    expect(g.push('x is 16 and so on and on')).toEqual([]);
    expect(g.tripped).toBe(true);
  });

  it('a number at the end of a sentence waits for the next one', () => {
    const g = gate(['16']);
    expect(g.push('x is 1\n')).toEqual([]);
    expect(g.push('6\n')).toEqual([]);
    expect(g.tripped).toBe(false);
    // "1\n6" is two numbers: nothing leaked, all shown at the end.
    expect(g.flush()).toEqual(['x is 1\n6\n']);
  });

  it('catches base64 split across chunks', () => {
    const g = gate(['16']);
    expect(run(g, ['Here: MT', 'Y= ok. ']).shown).toBe('');
    expect(g.tripped).toBe(true);
  });

  it('releases the clean sentences before a leak in the same push', () => {
    const g = gate(['16']);
    expect(g.push('One. Two. x is 16. ')).toEqual(['One. ', 'Two. ']);
    expect(g.tripped).toBe(true);
  });

  it('a long shown text: the check window still joins the shown tail and the new text', () => {
    const keys = compileAnswerKeys(['16', 'n % 2 == 0']);
    const g = sentenceGate(keys);
    const filler = 'Trace the next line and tell me. '.repeat(Math.ceil((keys.reach * 2) / 33));
    expect(g.push(filler).join('')).toBe(filler);
    // Held as a possible start, then completed into the key: nothing of it is shown.
    expect(g.push('if n % 2')).toEqual([]);
    expect(g.push(' == 0:\n')).toEqual([]);
    expect(g.tripped).toBe(true);
    // A shown text with no space at all is checked whole.
    const g2 = sentenceGate(compileAnswerKeys(['16']), 4_000);
    expect(g2.push('x'.repeat(keys.reach + 10)).join('')).toBe('');
    expect(g2.flush().join('').length).toBe(keys.reach + 10);
  });

  // A generous test timeout for slower CI runners (4.2c performance round).
  it(
    'a long reply is checked fast enough (latency)',
    { timeout: 20_000 },
    () => {
      const g = gate(['16', 'n % 2 == 0', 'print("Even")']);
      const sentence = 'Trace the next line and tell me what you get. ';
      const t0 = Date.now();
      const r = run(
        g,
        Array.from({ length: 170 }, () => sentence),
      ); // ~8000 characters
      const ms = Date.now() - t0;
      expect(r.shown.length).toBe(sentence.length * 170);
      // A gross-regression guard only: linear work is proven by the work-counting tests below.
      // CI runners with coverage took 1.2–1.9 s here (0.15 s locally), so a 1 s wall-clock bound flaked (0.14).
      expect(ms).toBeLessThan(5_000);
      expect(SENTENCE_GATE_CAP).toBe(200);
    },
  );
});

describe('sentenceGate: fix round 1', () => {
  it('a 400k unbroken chunk trips at once, well under 100 ms', () => {
    const g = gate(['16']);
    const t0 = Date.now();
    expect(g.push('a'.repeat(400_000))).toEqual([]);
    expect(Date.now() - t0).toBeLessThan(100);
    expect(g.tripped).toBe(true);
    expect(g.flush()).toEqual([]);
  });

  /** The matcher for `keys`, counting the units every check reads (work, not wall time). */
  function counting(keys: string[]) {
    const m = compileAnswerKeys(keys);
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
    return { g: sentenceGate(wrapped), work, reach: m.reach };
  }

  // Performance fix round (19 Oct 2026): a generous *test* timeout for a slower CI runner; the
  // linearity assertions below are the real bound and are unchanged.
  it(
    'more than LIMITS.modelTextMaxLength pushed in small pieces trips too; work stays linear',
    { timeout: 20_000 },
    () => {
      const { g, work, reach } = counting(['16']);
      const shown: string[] = [];
      let pushed = 0;
      for (let i = 0; i < 1_000 && !g.tripped; i++) {
        shown.push(...g.push('Trace it. '));
        pushed += 10;
      }
      expect(g.tripped).toBe(true);
      expect(shown.join('').length).toBeLessThanOrEqual(LIMITS.modelTextMaxLength);
      // Each sentence is checked once, with at most the window and the cap in front.
      expect(work.checks).toBeLessThanOrEqual(pushed / 10);
      expect(work.units / work.checks).toBeLessThanOrEqual(2 * (reach + SENTENCE_GATE_CAP));
    },
  );

  it(
    'many held sentences in one chunk are judged once each (linear)',
    { timeout: 20_000 },
    () => {
      const { g, work, reach } = counting(['.lower()']);
      const text = 'a. '.repeat(2_600);
      const r = [...g.push(text), ...g.flush()].join('');
      expect(r).toBe(text);
      expect(work.checks).toBeLessThanOrEqual(2_600 + 100);
      expect(work.units).toBeLessThanOrEqual(work.checks * 2 * (2 * reach + SENTENCE_GATE_CAP));
    },
  );

  it('whitespace padding never pushes a number phrase out of the window (key 2016)', () => {
    const g = gate(['2016']);
    const shown = [
      ...g.push('So: two thousand'),
      ...g.push(' '.repeat(700)),
      ...g.push('sixteen.'),
      ...g.push(' Done. '),
      ...g.flush(),
    ].join('');
    expect(shown).not.toMatch(/two|thousand|sixteen/);
    expect(g.tripped).toBe(true);
  });

  it('invisible padding counts for nothing either', () => {
    const g = gate(['2016']);
    const shown = [
      ...g.push('So: two thousand'),
      ...g.push('\u200B'.repeat(700)),
      ...g.push(' sixteen. More. '),
      ...g.flush(),
    ].join('');
    expect(shown).not.toMatch(/two|sixteen/);
    expect(g.tripped).toBe(true);
  });

  it('a number word at the cap is held: "twenty" never shows before "four"', () => {
    const g = gate(['24']);
    const filler = 'x'.repeat(190);
    const shown = [...g.push(`${filler} twenty `), ...g.push('four.'), ...g.flush()].join('');
    expect(shown).not.toContain('twenty');
    expect(g.tripped).toBe(true);
    // Clean continuation: the held word is shown once it is known not to be the key.
    const g2 = gate(['24']);
    const shown2 = [...g2.push(`${filler} twenty `), ...g2.push('apples. ')].join('');
    expect(shown2).toContain('twenty apples');
  });
});
