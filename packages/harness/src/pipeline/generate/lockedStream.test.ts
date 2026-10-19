// Task 4.6: the stream's locked check, per sentence with a 7-token carryover. Synthetic material.
import { LIMITS } from '@edmate/contracts';
import { describe, expect, it } from 'vitest';
import type { LockedCheck } from '../../guardrails/answerLeak.js';
import { LockedCheckFailed, LockedLeakDetected } from '../../guardrails/lockedLeak.js';
import { lockedIndex, lockedTokens } from '../../guardrails/lockedMatch.js';
import { cancelSource } from '../clock.js';
import { TurnCancelled } from '../errors.js';
import { lockedStream } from './lockedStream.js';

const MATERIAL = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu';
const index = lockedIndex([MATERIAL], []);

function setup(check?: LockedCheck) {
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
  );
  return { s, asked, reported, cancel };
}

async function feed(s: ReturnType<typeof lockedStream>, pieces: string[]) {
  const shown: string[] = [];
  for (const p of pieces) shown.push(...(await s.check(s.split([p]))));
  shown.push(...(await s.check(s.rest())));
  return shown;
}

describe('lockedStream: checks each sentence before it is shown', () => {
  it('shows clean text sentence by sentence, each checked with the carryover in front', async () => {
    const { s, asked, reported } = setup();
    const shown = await feed(s, ['One two three. ', 'Four five six seven eight', ' nine. Ten.']);
    expect(shown).toEqual(['One two three. ', 'Four five six seven eight nine. ', 'Ten.']);
    expect(s.tripped).toBeUndefined();
    // The first sentence has under 8 tokens, so it is still sent: the check decides.
    expect(asked).toEqual([
      ['One two three. '],
      ['One two three. Four five six seven eight nine. '],
      ['three. Four five six seven eight nine. Ten.'],
    ]);
    expect(reported).toEqual([]);
  }, 5_000);

  it('withholds a sentence holding a locked span, and everything after it', async () => {
    const { s, reported } = setup();
    const shown = await feed(s, ['Good question. ', `Here: ${MATERIAL}. `, 'Hope that helps.']);
    expect(shown).toEqual(['Good question. ']);
    expect(s.tripped).toBe('hit');
    expect(reported).toHaveLength(1);
    expect(reported[0]).toBeInstanceOf(LockedLeakDetected);
    expect((reported[0] as LockedLeakDetected).site).toBe('stream');
  }, 5_000);

  it('catches a span split across a sentence boundary through the 7-token carryover', async () => {
    const { s } = setup();
    // 4 + 4 tokens: neither sentence alone holds 8.
    const shown = await feed(s, ['alpha beta gamma delta. ', 'Epsilon zeta eta theta. ']);
    expect(shown).toEqual(['alpha beta gamma delta. ']);
    expect(s.tripped).toBe('hit');
  }, 5_000);

  it('catches a span spread over many short sentences and over chunks cut mid-word', async () => {
    const { s } = setup();
    const pieces = ['alpha. beta. gam', 'ma. delta. epsilon. ', 'zeta. eta. the', 'ta. ok.'];
    const shown = await feed(s, pieces);
    expect(shown.join('')).not.toContain('theta');
    expect(s.tripped).toBe('hit');
    // Seven tokens were shown before the eighth completed the span: under the leak definition.
    const seen = lockedTokens(shown.join('')).length;
    expect(seen).toBeLessThanOrEqual(7);
  }, 5_000);

  it('carries one token more when shown text was cut mid-word (the cap cut, no spaces)', async () => {
    const { s } = setup();
    const nb = String.fromCharCode(0xa0); // no ordinary space, so the cap cuts mid-word
    const words = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta'];
    const material = `${words.join(nb)}${nb}theta. Done.`;
    // 158 + 40 units puts the 200-unit cap after "th" of "theta", the span's 8th token.
    const prefix = `x${nb}`.repeat(79);
    const shown = await feed(s, [prefix + material]);
    expect(shown).toHaveLength(1);
    expect(shown[0]?.endsWith(`eta${nb}th`)).toBe(true);
    expect(s.tripped).toBe('hit');
  }, 5_000);

  it('a failed check withholds (fails closed) and is reported, not thrown', async () => {
    const { s, reported } = setup(() => Promise.reject(new LockedCheckFailed('timeout')));
    const shown = await feed(s, ['Hello there. ', 'More text.']);
    expect(shown).toEqual([]);
    expect(s.tripped).toBe('failed');
    expect(reported).toHaveLength(1);
    expect(reported[0]).toBeInstanceOf(LockedCheckFailed);
  }, 5_000);

  it('after a trip, nothing more is checked or shown', async () => {
    let calls = 0;
    const { s } = setup(() => {
      calls++;
      return Promise.resolve(true);
    });
    expect(await s.check(s.split(['First. ', 'Second. ']))).toEqual([]);
    expect(s.split(['Third. '])).toEqual([]);
    expect(await s.check(['Fourth. '])).toEqual([]);
    expect(s.rest()).toEqual([]);
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
});
