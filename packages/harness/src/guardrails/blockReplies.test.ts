// Block replies (task 4.4, lead answer 2): one English reply per code; the bullying reply
// acknowledges it, suggests a trusted adult and refuses any method.
import { SafetyEventCodeSchema } from '@edmate/contracts';
import { describe, expect, it } from 'vitest';
import { BLOCK_REPLIES, type BlockCode, blockReplyFor } from './blockReplies.js';

const T = 1_000;

describe('block replies', () => {
  it(
    'every code but self_harm has a reply (self_harm escalates instead)',
    () => {
      const codes = SafetyEventCodeSchema.options.filter((c) => c !== 'self_harm');
      expect(Object.keys(BLOCK_REPLIES).sort()).toEqual([...codes].sort());
    },
    T,
  );

  it.each(Object.entries(BLOCK_REPLIES))(
    '%s: short plain English',
    (code, reply) => {
      expect(blockReplyFor(code as BlockCode)).toBe(reply);
      expect(reply.split(/\s+/).length).toBeLessThanOrEqual(60);
      expect(reply).toMatch(/^[\x20-\x7e]+$/);
    },
    T,
  );

  it(
    'harm_to_others acknowledges the bullying, suggests a trusted adult, refuses any method',
    () => {
      expect(BLOCK_REPLIES.harm_to_others).toMatch(/bullied/);
      expect(BLOCK_REPLIES.harm_to_others).toMatch(/trusted adult/);
      expect(BLOCK_REPLIES.harm_to_others).toMatch(/can't help with hurting anyone/);
    },
    T,
  );

  it(
    'cheating offers coaching instead',
    () => {
      expect(BLOCK_REPLIES.cheating).toMatch(/coach you/);
    },
    T,
  );
});
