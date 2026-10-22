// Task 9.2 Phase C. Written and red before scorecard.ts exists (TDD). The raw shape mirrors a
// stored 7.8 `Scorecard` (packages/evals/src/scorecard.ts), which apps/web does not import.
import { describe, expect, it } from 'vitest';
import { toPublicScorecard } from './scorecard';

function category(key: string, over: Record<string, unknown> = {}) {
  return {
    key,
    measured: true,
    total: 10,
    passed: 9,
    percent: 90,
    pass: true,
    byOrigin: [{ origin: 'platform', total: 10, passed: 9 }],
    ...over,
  };
}

const UNMEASURED = { measured: false, total: 0, passed: 0, percent: null, pass: false, byOrigin: [] };

function raw(
  categories: unknown[] = [
    category('hints_before_answers'),
    category('locked_content'),
    category('accuracy'),
  ],
) {
  return { pass: true, changes: ['knowledge'], categories };
}

/** A full raw card where only the first category is overridden. */
function withFirst(over: Record<string, unknown>) {
  return raw([
    category('hints_before_answers', over),
    category('locked_content'),
    category('accuracy'),
  ]);
}

describe('toPublicScorecard', () => {
  it('keeps only key, measured, percent and pass per category, in canonical order', () => {
    const card = toPublicScorecard(
      raw([category('accuracy'), category('hints_before_answers'), category('locked_content')]),
    );
    expect(card).toEqual({
      categories: [
        { key: 'hints_before_answers', measured: true, percent: 90, pass: true },
        { key: 'locked_content', measured: true, percent: 90, pass: true },
        { key: 'accuracy', measured: true, percent: 90, pass: true },
      ],
    });
  });

  it('floors the percent to a whole number (99.6 -> 99, never rounded up)', () => {
    const card = toPublicScorecard(
      raw([
        category('hints_before_answers', { percent: 99.6 }),
        category('locked_content', { percent: 100 }),
        category('accuracy', { percent: 0.4 }),
      ]),
    );
    expect(card?.categories.map((c) => c.percent)).toEqual([99, 100, 0]);
  });

  it('keeps an unmeasured category as measured: false with a null percent', () => {
    const card = toPublicScorecard(
      raw([category('hints_before_answers'), category('locked_content', UNMEASURED), category('accuracy')]),
    );
    expect(card?.categories[1]).toEqual({
      key: 'locked_content',
      measured: false,
      percent: null,
      pass: false,
    });
  });

  it('keeps a measured category with zero cases (percent null) as null, not 0', () => {
    const card = toPublicScorecard(withFirst({ total: 0, passed: 0, percent: null }));
    expect(card?.categories[0]?.percent).toBeNull();
  });

  it.each<[string, unknown]>([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'scorecard'],
    ['an array', []],
    ['no categories', { pass: true, changes: [] }],
    ['a missing category', raw([category('hints_before_answers'), category('accuracy')])],
    [
      'a duplicated category',
      raw([category('accuracy'), category('accuracy'), category('locked_content')]),
    ],
    [
      'an unknown key',
      raw([category('hints_before_answers'), category('locked_content'), category('speed')]),
    ],
    [
      'a fourth category',
      raw([
        category('hints_before_answers'),
        category('locked_content'),
        category('accuracy'),
        category('speed'),
      ]),
    ],
    ['a percent above 100', withFirst({ percent: 100.1 })],
    ['a negative percent', withFirst({ percent: -1 })],
    ['a NaN percent', withFirst({ percent: Number.NaN })],
    ['a string percent', withFirst({ percent: '90' })],
    ['a missing percent', withFirst({ percent: undefined })],
    ['a missing pass', withFirst({ pass: undefined })],
    ['a non-boolean measured', withFirst({ measured: 'yes' })],
    ['an unmeasured category with a percent', withFirst({ ...UNMEASURED, percent: 50 })],
    ['an unmeasured category that claims a pass', withFirst({ ...UNMEASURED, pass: true })],
    ['extra nesting', { scorecard: raw() }],
    [
      'a nested category',
      raw([
        { category: category('hints_before_answers') },
        category('locked_content'),
        category('accuracy'),
      ]),
    ],
  ])('fails closed to null for %s, never a partial card', (_label, input) => {
    expect(toPublicScorecard(input)).toBeNull();
  });
});
