// Task 4.6 and 4.6b: the stream's locked check, batched per call with a held-back carryover.
// Synthetic material.
import { LIMITS } from '@edmate/contracts';
import { describe, expect, it } from 'vitest';
import type { LockedCheck } from '../../guardrails/answerLeak.js';
import { LockedCheckFailed, LockedLeakDetected } from '../../guardrails/lockedLeak.js';
import { lockedIndex, lockedTokens } from '../../guardrails/lockedMatch.js';
import { cancelSource } from '../clock.js';
import { TurnCancelled } from '../errors.js';
import { lockedStream, type LockedStreamOptions } from './lockedStream.js';

const MATERIAL = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu';
const index = lockedIndex([MATERIAL], []);

function setup(check?: LockedCheck, opts?: LockedStreamOptions) {
  const asked: string[][] = [];
  const reported: unknown[] = [];
  const cancel = cancelSource();
  const s = lockedStream(
    check ??
      ((texts) => {
        asked.push([...texts]);
        return Promise.resolve(index.hits(texts));
      }),
    (e) => void reported.push(e),
    cancel.token,
    opts,
  );
  return { s, asked, reported, cancel };
}

/** Feeds each piece as its own batch (one `split` + `check` per piece), then flushes and releases. */
async function feed(s: ReturnType<typeof lockedStream>, pieces: string[]) {
  const shown: string[] = [];
  for (const p of pieces) shown.push(...(await s.check(s.split([p]))));
  shown.push(...(await s.check(s.rest())));
  shown.push(...(await s.release()));
  return shown;
}

describe('lockedStream: checks each batch before it is shown', () => {
  it('shows clean text, holding the last ~7 tokens back until a later batch or release shows it', async () => {
    const { s, asked, reported } = setup();
    const shown = await feed(s, ['One two three. ', 'Four five six seven eight', ' nine. Ten.']);
    // Reassembled, nothing is lost or reordered; it is only split differently across calls.
    expect(shown.join('')).toBe('One two three. Four five six seven eight nine. Ten.');
    expect(s.tripped).toBeUndefined();
    expect(reported).toEqual([]);
    // One lockedCheck call per non-empty batch (the piece with no sentence end makes no call),
    // each call carrying the previous pass's held-back tail in front.
    expect(asked).toHaveLength(3);
    expect(asked.every((a) => a.length === 1)).toBe(true);
  }, 5_000);

  it('a clean reply with no more than ~7 tokens total is held until release() at the end', async () => {
    const { s } = setup();
    const checked = await s.check(s.split(['Hello there. ']));
    expect(checked).toEqual([]); // 2 tokens: carryStart holds all of it
    const rest = await s.check(s.rest());
    expect(rest).toEqual([]);
    expect(await s.release()).toEqual(['Hello there. ']);
  }, 5_000);

  it('a batch under 8 tokens holds everything until more text arrives to check it with', async () => {
    const { s } = setup();
    const checked = await s.check(s.split(['One two three. ']));
    expect(checked).toEqual([]); // under 8 tokens: carryStart holds all of it
    const more = await s.check(s.rest());
    expect(more).toEqual([]);
    expect(await s.release()).toEqual(['One two three. ']);
  }, 5_000);

  it('withholds a sentence holding a locked span, and everything after it, with 0 locked tokens shown', () => {
    return (async () => {
      const { s, reported } = setup();
      const shown = await feed(s, ['Good question. ', `Here: ${MATERIAL}. `, 'Hope that helps.']);
      // Nothing of the locked material, and not even the held-back tail of the clean sentence
      // before it, was ever shown.
      expect(shown.join('')).toBe('');
      expect(s.tripped).toBe('hit');
      expect(reported).toHaveLength(1);
      expect(reported[0]).toBeInstanceOf(LockedLeakDetected);
      expect((reported[0] as LockedLeakDetected).site).toBe('stream');
    })();
  }, 5_000);

  it('catches a span split across a sentence boundary with nothing shown first', async () => {
    const { s } = setup();
    // 4 + 4 tokens: neither sentence alone holds 8, but the batch call joins them.
    const shown = await feed(s, ['alpha beta gamma delta. ', 'Epsilon zeta eta theta. ']);
    expect(shown).toEqual([]);
    expect(s.tripped).toBe('hit');
  }, 5_000);

  it('a span spread over many short sentences in one batch trips with nothing shown', async () => {
    const { s } = setup();
    // All these sentences complete within one `split` call, so one batch, one check.
    const shown = await s.check(s.split(['alpha. beta. gamma. delta. epsilon. zeta. eta. theta. ok.']));
    expect(shown).toEqual([]);
    expect(s.tripped).toBe('hit');
  }, 5_000);

  it('a failed check withholds the whole batch (fail closed) and is reported, not thrown', async () => {
    const { s, reported } = setup(() => Promise.reject(new LockedCheckFailed('timeout')));
    const shown = await feed(s, ['Hello there. ', 'More text.']);
    expect(shown).toEqual([]);
    expect(s.tripped).toBe('failed');
    expect(reported).toHaveLength(1);
    expect(reported[0]).toBeInstanceOf(LockedCheckFailed);
  }, 5_000);

  it('after a trip, nothing more is checked, shown or released', async () => {
    let calls = 0;
    const { s } = setup(() => {
      calls++;
      return Promise.resolve(true);
    });
    expect(await s.check(s.split(['First. Second. ']))).toEqual([]);
    expect(s.split(['Third. '])).toEqual([]);
    expect(await s.check(['Fourth. '])).toEqual([]);
    expect(s.rest()).toEqual([]);
    expect(await s.release()).toEqual([]);
    expect(calls).toBe(1);
  }, 5_000);

  it('a cancelled step rejects with TurnCancelled while a check is in flight', async () => {
    const { s, cancel } = setup(() => new Promise(() => undefined));
    const pending = s.check(s.split(['Hello there. ']));
    cancel.cancel();
    await expect(pending).rejects.toBeInstanceOf(TurnCancelled);
  }, 5_000);

  it('text past a reply’s maximum is never shown and counts as failed', async () => {
    const { s } = setup(() => Promise.resolve(false));
    const big = 'word '.repeat(Math.ceil(LIMITS.modelTextMaxLength / 5) + 10);
    expect(s.split([big])).toEqual([]);
    expect(s.rest()).toEqual([]);
    expect(s.tripped).toBe('failed');
  }, 5_000);

  it('holds unbroken text until a sentence end, the cap or the flush', async () => {
    const { s } = setup(() => Promise.resolve(false));
    expect(s.split(['no sentence end yet'])).toEqual([]);
    expect(s.rest()).toEqual(['no sentence end yet']);
    expect(s.split([''])).toEqual([]);
  }, 5_000);

  // No `setTimeout` (the harness is pure: no node or DOM lib). A real 120 ms is spent with a busy
  // wait instead, so the elapsed-time assertion below is about real wall-clock time, not a fake
  // timer: with one call per sentence (300 of them) this would take well over the attempt budget.
  function busyWaitMs(ms: number): void {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      /* spin */
    }
  }

  it('one call checks the whole batch, not one call per sentence (120 ms each, 300 lines)', async () => {
    let calls = 0;
    const { s } = setup(async () => {
      calls++;
      busyWaitMs(120);
      return false;
    });
    const lines = Array.from({ length: 300 }, (_, i) => `print(${i}).`).join(' ');
    const start = Date.now();
    const shown = await s.check(s.split([lines]));
    const elapsed = Date.now() - start;
    expect(calls).toBe(1); // every sentence in this one chunk went in one leakCheck call
    expect(shown.join('').length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(2_000); // well inside a 15 s attempt budget
  }, 5_000);
});

describe('lockedStream: onTrip tells the caller once, whatever tripped it', () => {
  it.each([
    ['a hit', (() => Promise.resolve(true)) as LockedCheck, ['Hello there. ']],
    ['a failed check', (() => Promise.reject(new Error('down'))) as LockedCheck, ['Hello there. ']],
    [
      'text past the maximum',
      (() => Promise.resolve(false)) as LockedCheck,
      ['word '.repeat(Math.ceil(LIMITS.modelTextMaxLength / 5) + 10)],
    ],
  ])('%s', async (_label, check, pieces) => {
    let trips = 0;
    const { s } = setup(check, { onTrip: () => void trips++ });
    await feed(s, [...pieces, 'More text. ']);
    expect(s.tripped).toBeDefined();
    expect(trips).toBe(1);
  }, 5_000);

  it('a clean reply never calls it', async () => {
    let trips = 0;
    const { s } = setup(undefined, { onTrip: () => void trips++ });
    await feed(s, ['One two three. ', 'Four five six seven eight nine ten. ']);
    expect(trips).toBe(0);
  }, 5_000);
});

describe('lockedStream: holdAll (ADR-0007 §8, session-wide stop)', () => {
  it('holds every batch whole, showing nothing until release() at a clean end', async () => {
    const { s, asked } = setup(undefined, { holdAll: true });
    const first = await s.check(s.split(['One two three. ']));
    const second = await s.check(s.split(['Four five six. ']));
    expect(first).toEqual([]);
    expect(second).toEqual([]);
    const rest = await s.check(s.rest());
    expect(rest).toEqual([]);
    expect(asked).toEqual([]); // nothing is checked until the end
    expect(await s.release()).toEqual(['One two three. Four five six. ']);
    expect(asked).toEqual([['One two three. Four five six. ']]);
  }, 5_000);

  it('a long multi-batch reply makes exactly one leakCheck call, of the whole reply, at release()', async () => {
    const { s, asked } = setup(undefined, { holdAll: true });
    const pieces = Array.from({ length: 200 }, (_, i) => `Sentence number ${i} is clean. `);
    const shown = await feed(s, pieces);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toEqual([pieces.join('')]);
    expect(shown).toEqual([pieces.join('')]);
  }, 5_000);

  it('an empty reply makes no call at all', async () => {
    const { s, asked } = setup(undefined, { holdAll: true });
    expect(await feed(s, [])).toEqual([]);
    expect(asked).toEqual([]);
  }, 5_000);

  it('still trips on a hit, with nothing shown or released', async () => {
    const { s, reported } = setup(undefined, { holdAll: true });
    const shown = await feed(s, [`Here: ${MATERIAL}. `]);
    expect(shown).toEqual([]);
    expect(s.tripped).toBe('hit');
    expect(reported[0]).toBeInstanceOf(LockedLeakDetected);
    expect(await s.release()).toEqual([]);
  }, 5_000);

  it('a failed check at release() withholds the whole reply (fail closed)', async () => {
    const { s, reported } = setup(() => Promise.reject(new LockedCheckFailed('timeout')), {
      holdAll: true,
    });
    expect(await feed(s, ['Hello there. ', 'More text.'])).toEqual([]);
    expect(s.tripped).toBe('failed');
    expect(reported[0]).toBeInstanceOf(LockedCheckFailed);
  }, 5_000);

  it('a cancel during the release() check rejects with TurnCancelled', async () => {
    const { s, cancel } = setup(() => new Promise(() => undefined), { holdAll: true });
    await s.check(s.split(['Hello there. ']));
    const pending = s.release();
    cancel.cancel();
    await expect(pending).rejects.toBeInstanceOf(TurnCancelled);
  }, 5_000);

  it('the span across sentences is still caught: the batched call sees it joined', async () => {
    const { s } = setup(undefined, { holdAll: true });
    const shown = await feed(s, ['alpha beta gamma delta. ', 'Epsilon zeta eta theta. ']);
    expect(shown).toEqual([]);
    expect(s.tripped).toBe('hit');
  }, 5_000);
});

describe('lockedStream: never cuts the held-back text inside unfinished markup (4.6b fix round 1)', () => {
  const PHRASE = 'the loop repeats while the condition stays true and then stops';
  const phraseIndex = lockedIndex([`Remember: ${PHRASE}.`], []);
  const phraseSetup = () => setup((texts) => Promise.resolve(phraseIndex.hits(texts)));
  const lockedWordsIn = (shown: string) =>
    lockedTokens(shown).filter((t) => ['loop', 'repeats', 'while'].includes(t.t)).length;

  it('the safety probe: an attribute left open across pieces streams none of the locked words', async () => {
    const { s } = phraseSetup();
    const shown = await feed(s, [
      'Sure. the loop repeats while <span title="a b c d e f g h. ',
      'y">the condition stays true and then stops.',
    ]);
    expect(s.tripped).toBe('hit');
    expect(lockedWordsIn(shown.join(''))).toBe(0);
  }, 5_000);

  it('holds from 7 tokens before an unclosed tag at the end of the checked text', async () => {
    const { s } = setup(() => Promise.resolve(false));
    const shown = await s.check(['one two three four five six seven eight nine <span title="ten ']);
    expect(shown).toEqual(['one two ']);
  }, 5_000);

  it('never shows part of an unfinished entity', async () => {
    const { s } = setup(() => Promise.resolve(false));
    const shown = await s.check(['one two three four five six seven eight nine ten eleven &#10']);
    expect(shown.join('')).not.toContain('&');
  }, 5_000);

  it('a SENTENCE_GATE_CAP cut inside an open attribute streams none of the locked words', async () => {
    const { s } = phraseSetup();
    const text = `the loop repeats while <span title="${'q '.repeat(120)}">the condition stays true and then stops.`;
    const shown = await feed(s, [text]);
    expect(s.tripped).toBe('hit');
    expect(lockedWordsIn(shown.join(''))).toBe(0);
  }, 5_000);
});

describe('carryover tokens checked', () => {
  it('a span across sentences, caught through the held-back carryover, shows 0 locked tokens', async () => {
    const { s } = setup();
    const pieces = ['alpha. beta. gam', 'ma. delta. epsilon. ', 'zeta. eta. the', 'ta. ok.'];
    const shown = await feed(s, pieces);
    expect(shown.join('')).not.toContain('theta');
    expect(s.tripped).toBe('hit');
    // Nothing of the span streamed: the clean sentences before it were held, not shown, and the
    // batch holding the span itself never passed its check.
    const seen = lockedTokens(shown.join('')).length;
    expect(seen).toBe(0);
  }, 5_000);
});
