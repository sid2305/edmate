import type { Message } from '@edmate/contracts';
import { describe, expect, it } from 'vitest';
import { historyChars, historyTrim } from './historyTrim.js';

const msg = (i: number, text: string, role: Message['role'] = 'student'): Message => ({
  id: `msg_${String(i)}`,
  role,
  text,
  createdAt: `2026-10-18T10:00:${String(i).padStart(2, '0')}Z`,
});

const ids = (ms: Message[]) => ms.map((m) => m.id);

describe('historyTrim: deterministic, oldest dropped first', () => {
  const three = [msg(1, 'aaaa'), msg(2, 'bbbb', 'agent'), msg(3, 'cccc')];

  it.each([
    ['empty history', [], 100, []],
    ['under budget keeps everything', three, 100, ['msg_1', 'msg_2', 'msg_3']],
    ['exactly at budget keeps everything', three, 12, ['msg_1', 'msg_2', 'msg_3']],
    ['one under drops the oldest', three, 11, ['msg_2', 'msg_3']],
    ['keeps a contiguous newest run', three, 8, ['msg_2', 'msg_3']],
    ['only the newest fits', three, 4, ['msg_3']],
    ['zero budget keeps nothing', three, 0, []],
    ['negative budget keeps nothing', three, -5, []],
  ] as const)('%s', (_label, history, budget, want) => {
    expect(ids(historyTrim(history, budget))).toEqual(want);
  });

  it('never keeps an older message once a newer one did not fit (no gaps)', () => {
    const h = [msg(1, 'a'), msg(2, 'x'.repeat(50)), msg(3, 'cc')];
    expect(ids(historyTrim(h, 10))).toEqual(['msg_3']);
  });

  it('keeps a newest message longer than the budget, cut to its last `budget` characters', () => {
    const h = [msg(1, 'old'), msg(2, `${'x'.repeat(20)}tail`)];
    const out = historyTrim(h, 6);
    expect(ids(out)).toEqual(['msg_2']);
    expect(out[0]?.text).toBe('xxtail');
    expect(historyChars(out)).toBe(6);
  });

  it('never splits a surrogate pair when cutting', () => {
    const h = [msg(1, `${'x'.repeat(10)}😀😀`)];
    const out = historyTrim(h, 3);
    // '😀😀' is 4 UTF-16 units; 3 would start inside the first pair, so it drops that half.
    expect(out[0]?.text).toBe('😀');
    expect(historyChars(out)).toBeLessThanOrEqual(3);
  });

  it('same input twice gives identical output, and never mutates the input', () => {
    const h = [msg(1, 'a'.repeat(30)), msg(2, 'b'.repeat(30)), msg(3, 'c'.repeat(30))];
    const before = JSON.parse(JSON.stringify(h)) as Message[];
    const a = historyTrim(h, 65);
    const b = historyTrim(h, 65);
    expect(a).toEqual(b);
    expect(h).toEqual(before);
    expect(a[0]).not.toBe(h[1]);
  });

  it('a large history stays within the budget', () => {
    const h = Array.from({ length: 10_000 }, (_, i) => msg(i % 60, 'y'.repeat(97 + (i % 7))));
    const out = historyTrim(h, 5_000);
    expect(historyChars(out)).toBeLessThanOrEqual(5_000);
    expect(out.at(-1)).toEqual(h.at(-1));
  });
});

describe('historyChars', () => {
  it('counts UTF-16 units of message text', () => {
    expect(historyChars([])).toBe(0);
    expect(historyChars([msg(1, 'ab'), msg(2, '😀')])).toBe(4);
  });
});
