import { LIMITS } from '@edmate/contracts';
import { turnContextFull } from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { testTool } from '../../testing/memoryToolRegistry.js';
import type { SkillPresentation } from '../tools.js';
import { SkillEventDropped, skillEvent } from './skillEvent.js';

const KEY = '5/6';
const withPresent = (present: (o: unknown) => SkillPresentation | undefined) =>
  testTool({ name: 'practice.next_item', skill: 'practice', present });

describe('skillEvent', () => {
  it('a tool without present gives no event', () => {
    expect(skillEvent(testTool({ name: 't', skill: 'practice' }), {}, turnContextFull, [KEY])).toBe(
      undefined,
    );
  });

  it('present returning undefined gives no event', () => {
    expect(
      skillEvent(
        withPresent(() => undefined),
        {},
        turnContextFull,
        [KEY],
      ),
    ).toBeUndefined();
  });

  it('an entitled, small, clean payload becomes a skill event', () => {
    const r = skillEvent(
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

  it('a skill outside the entitlement is dropped', () => {
    // turnContextFull's entitlement has no mock_interview.
    dropped(
      skillEvent(
        withPresent(() => ({ skill: 'mock_interview', payload: {} })),
        {},
        turnContextFull,
        [],
      ),
      'not_entitled',
    );
  });

  it('a payload holding the answer key (any case, any depth) is dropped', () => {
    for (const payload of [
      { answer: KEY },
      { steps: [{ text: `so it is ${KEY}` }] },
      { ANSWER: 'FIVE SIXTHS' },
      { [KEY]: true },
    ]) {
      dropped(
        skillEvent(
          withPresent(() => ({ skill: 'practice', payload })),
          {},
          turnContextFull,
          [KEY, 'five sixths'],
        ),
        'answer_key',
      );
    }
  });

  it('an answer key with a quote is still caught (string leaves, not only JSON text)', () => {
    dropped(
      skillEvent(
        withPresent(() => ({ skill: 'practice', payload: { a: 'x "q" y' } })),
        {},
        turnContextFull,
        ['"q"'],
      ),
      'answer_key',
    );
  });

  it('empty do-not-say entries never match everything', () => {
    expect(
      skillEvent(
        withPresent(() => ({ skill: 'practice', payload: { a: 1 } })),
        {},
        turnContextFull,
        ['', '  '],
      ),
    ).toMatchObject({ type: 'skill' });
  });

  it(`a payload over ${LIMITS.skillPayloadMaxJsonLength} JSON characters is dropped`, () => {
    dropped(
      skillEvent(
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

  it('a payload that is not JSON-safe is dropped as too large', () => {
    dropped(
      skillEvent(
        withPresent(() => ({ skill: 'practice', payload: 1n })),
        {},
        turnContextFull,
        [],
      ),
      'too_large',
    );
  });

  it('a throwing present is dropped', () => {
    dropped(
      skillEvent(
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

  it('a malformed presentation is dropped', () => {
    dropped(
      skillEvent(
        withPresent(() => ({ skill: 'nope', payload: {} }) as unknown as SkillPresentation),
        {},
        turnContextFull,
        [],
      ),
      'invalid',
    );
  });
});
