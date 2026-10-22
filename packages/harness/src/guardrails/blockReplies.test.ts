// Block replies (task 4.4, lead answer 2): one English reply per code; the bullying reply
// does not assume the student is bullied, points to someone they trust and refuses any method.
// Neutral, adult-safe wording throughout (fix round MEDIUM 7).
import { SafetyEventCodeSchema } from '@edmate/contracts';
import { describe, expect, it } from 'vitest';
import { BLOCK_REPLIES, type BlockCode, blockReplyFor, isBlockReply } from './blockReplies.js';

const T = 20_000;

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
    'harm_to_others refuses any method and points to someone they trust, assuming nothing',
    () => {
      expect(BLOCK_REPLIES.harm_to_others).toMatch(/someone you trust/);
      expect(BLOCK_REPLIES.harm_to_others).not.toMatch(/fault|bullied/i);
      expect(BLOCK_REPLIES.harm_to_others).toMatch(/can't help with hurting anyone/);
    },
    T,
  );

  it.each(Object.entries(BLOCK_REPLIES))(
    '%s: adult-safe, no assumptions (no "trusted adult", no school counsellor, no "your fault")',
    (_code, reply) => {
      expect(reply).not.toMatch(/trusted adult|counsellor|counselor|your fault/i);
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

  it.each(Object.values(BLOCK_REPLIES))(
    'isBlockReply recognises every fixed block reply',
    (reply) => {
      expect(isBlockReply(reply)).toBe(true);
    },
    T,
  );

  it(
    'isBlockReply is false for an ordinary reply',
    () => {
      expect(isBlockReply('Sure, let\'s work through fractions together.')).toBe(false);
    },
    T,
  );
});
