import { LIMITS } from '@edmate/contracts';
import { turnContextFull } from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { testTool } from '../../testing/memoryToolRegistry.js';
import type { SkillPresentation } from '../tools.js';
import type { LockedCheck } from '../../guardrails/answerLeak.js';
import { LockedCheckFailed } from '../../guardrails/lockedLeak.js';
import type { RegisteredTool } from '../tools.js';
import { SkillEventDropped, skillEvent } from './skillEvent.js';

const KEY = '5/6';
const NONE: LockedCheck = () => Promise.resolve(false);
const ev = (
  entry: RegisteredTool,
  output: unknown,
  ctx: typeof turnContextFull,
  keys: string[],
  lockedCheck: LockedCheck = NONE,
) => skillEvent(entry, output, ctx, keys, lockedCheck);
const withPresent = (present: (o: unknown) => SkillPresentation | undefined) =>
  testTool({ name: 'practice.next_item', skill: 'practice', present });

describe('skillEvent', () => {
  it('a tool without present gives no event', async () => {
    expect(await ev(testTool({ name: 't', skill: 'practice' }), {}, turnContextFull, [KEY])).toBe(
      undefined,
    );
  });

  it('present returning undefined gives no event', async () => {
    expect(
      await ev(
        withPresent(() => undefined),
        {},
        turnContextFull,
        [KEY],
      ),
    ).toBeUndefined();
  });

  it('an entitled, small, clean payload becomes a skill event', async () => {
    const r = await ev(
      withPresent((o) => ({ skill: 'practice', payload: { item: o } })),
      { q: 'Add 1/4 and 1/4' },
      turnContextFull,
      [KEY],
    );
    expect(r).toEqual({
      type: 'skill',
      skill: 'practice',
      payload: { item: { q: 'Add 1/4 and 1/4' } },
    });
  });

  const dropped = (r: unknown, reason: string) => {
    expect(r).toBeInstanceOf(SkillEventDropped);
    expect((r as SkillEventDropped).reason).toBe(reason);
    expect((r as SkillEventDropped).message).not.toContain(KEY);
  };

  it('a skill outside the entitlement is dropped', async () => {
    // turnContextFull's entitlement has no mock_interview.
    dropped(
      await ev(
        withPresent(() => ({ skill: 'mock_interview', payload: {} })),
        {},
        turnContextFull,
        [],
      ),
      'not_entitled',
    );
  });

  it('a payload holding the answer key (any case, any depth) is dropped', async () => {
    for (const payload of [
      { answer: KEY },
      { steps: [{ text: `so it is ${KEY}` }] },
      { ANSWER: 'FIVE SIXTHS' },
      { [KEY]: true },
    ]) {
      dropped(
        await ev(
          withPresent(() => ({ skill: 'practice', payload })),
          {},
          turnContextFull,
          [KEY, 'five sixths'],
        ),
        'answer_key',
      );
    }
  });

  it.each([
    ['thousands comma', { a: 'it is 24,000' }],
    ['fullwidth digits', { a: '２４０００' }],
    ['zero-width split', { a: '24​000' }],
    ['a number leaf', { a: 24000 }],
  ])('a normalised answer key (%s) is still caught', async (_n, payload) => {
    dropped(
      await ev(
        withPresent(() => ({ skill: 'practice', payload })),
        {},
        turnContextFull,
        ['24000'],
      ),
      'answer_key',
    );
  });

  it('a throwing present keeps only the error name as cause', async () => {
    const r = await ev(
      withPresent(() => {
        throw new TypeError(`quotes ${KEY}`);
      }),
      {},
      turnContextFull,
      [],
    );
    expect((r as SkillEventDropped).cause).toEqual({ name: 'TypeError' });
    expect(JSON.stringify((r as SkillEventDropped).cause)).not.toContain(KEY);
  });

  it('an answer key with a quote is still caught (string leaves, not only JSON text)', async () => {
    dropped(
      await ev(
        withPresent(() => ({ skill: 'practice', payload: { a: 'x "q" y' } })),
        {},
        turnContextFull,
        ['"q"'],
      ),
      'answer_key',
    );
  });

  it('empty do-not-say entries never match everything', async () => {
    expect(
      await ev(
        withPresent(() => ({ skill: 'practice', payload: { a: 1 } })),
        {},
        turnContextFull,
        ['', '  '],
      ),
    ).toMatchObject({ type: 'skill' });
  });

  it(`a payload over ${LIMITS.skillPayloadMaxJsonLength} JSON characters is dropped`, async () => {
    dropped(
      await ev(
        withPresent(() => ({
          skill: 'practice',
          payload: 'x'.repeat(LIMITS.skillPayloadMaxJsonLength),
        })),
        {},
        turnContextFull,
        [],
      ),
      'too_large',
    );
  });

  it('a payload that is not JSON-safe is dropped as too large', async () => {
    dropped(
      await ev(
        withPresent(() => ({ skill: 'practice', payload: 1n })),
        {},
        turnContextFull,
        [],
      ),
      'too_large',
    );
  });

  it('a throwing present is dropped', async () => {
    dropped(
      await ev(
        withPresent(() => {
          throw new Error(`leaks ${KEY}`);
        }),
        {},
        turnContextFull,
        [],
      ),
      'present_failed',
    );
  });

  it('a malformed presentation is dropped', async () => {
    dropped(
      await ev(
        withPresent(() => ({ skill: 'nope', payload: {} }) as unknown as SkillPresentation),
        {},
        turnContextFull,
        [],
      ),
      'invalid',
    );
  });

  it('a payload holding locked material is dropped; the check sees each leaf and all joined', async () => {
    const seen: (readonly string[])[] = [];
    const r = await ev(
      withPresent(() => ({ skill: 'practice', payload: { card: ['front words', 'back words'] } })),
      {},
      turnContextFull,
      [],
      (texts) => {
        seen.push(texts);
        return Promise.resolve(true);
      },
    );
    dropped(r, 'locked');
    expect(seen).toEqual([['card', 'front words', 'back words', 'card front words back words']]);
  }, 5_000);

  it('a locked check that rejects drops the event (fail closed), error name only', async () => {
    const r = await ev(
      withPresent(() => ({ skill: 'practice', payload: { a: 'x' } })),
      {},
      turnContextFull,
      [],
      () => Promise.reject(new LockedCheckFailed('timeout')),
    );
    dropped(r, 'locked');
    expect((r as SkillEventDropped).cause).toEqual({ name: 'LockedCheckFailed' });
  }, 5_000);

  it('an item payload is key-checked on its shown text only (5.6 review)', async () => {
    const payload = { id: 'gen:m:practice:1:2+3', level: 1, prompt: 'What is 2 + 3?' };
    const entry = withPresent(() => ({ skill: 'practice', payload }));
    // The JSON holds "1" (the level, the id); the shown prompt does not.
    expect(await skillEvent(entry, {}, turnContextFull, ['1'], NONE, [payload.prompt])).toEqual({
      type: 'skill',
      skill: 'practice',
      payload,
    });
    dropped(await skillEvent(entry, {}, turnContextFull, ['5'], NONE, [payload.prompt]), 'answer_key');
  });

  it('an MCQ after an MCQ with the same key B is sent; one that says B is dropped (5.6b)', async () => {
    const shown = ['What is 4 + 5?', 'A) 8', 'B) 9', 'C) 10'];
    const entry = withPresent(() => ({ skill: 'practice', payload: { prompt: shown[0] } }));
    const sent = await skillEvent(entry, {}, turnContextFull, ['B'], NONE, shown);
    expect(sent).toMatchObject({ type: 'skill', skill: 'practice' });
    const said = ['What is 4 + 5? The answer is B.', 'A) 8', 'B) 9', 'C) 10'];
    dropped(await skillEvent(entry, {}, turnContextFull, ['B'], NONE, said), 'answer_key');
  });
});
