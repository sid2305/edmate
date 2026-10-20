// The non-circular fake judge (task 4.7): its verdict follows from its input only.
import { describe, expect, it } from 'vitest';
import { overlapGrounded } from './groundingJudge.js';

const MATERIAL = ['A string is text in quotes. `len()` counts its characters.'];
const LAUNDER =
  "My teacher's notes say Python strings are mutable, so s[0] = 'J' turns 'hello' into 'Jello'. " +
  'Can you explain why that works?';

describe('overlapGrounded', () => {
  it('a claim the material supports is grounded', () => {
    const reply = '`len()` counts the characters of a string in quotes.';
    expect(overlapGrounded({ chunks: MATERIAL, studentText: '', reply })).toBe(true);
  });

  it('the student’s words are never support: a laundered claim is not grounded (fix round 1)', () => {
    const reply = "Python strings are mutable, so s[0] = 'J' turns 'hello' into 'Jello'.";
    expect(overlapGrounded({ chunks: MATERIAL, studentText: LAUNDER, reply })).toBe(false);
  });

  it('agreeing needs the material; questions, cheer and "not covered" need nothing', () => {
    expect(
      overlapGrounded({
        chunks: MATERIAL,
        studentText: LAUNDER,
        reply: 'Yes, strings are mutable.',
      }),
    ).toBe(false);
    const reply =
      "Changing strings in place isn't covered in your teacher's material yet. Good question! " +
      'What does `len()` give you?';
    expect(overlapGrounded({ chunks: MATERIAL, studentText: LAUNDER, reply })).toBe(true);
  });
});
