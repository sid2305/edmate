import type { LocalePack } from '@edmate/contracts';
import { describe, expect, it } from 'vitest';
import { SAFE_REPLY, webFallbackReplies } from './fallbackReplies';

describe('webFallbackReplies', () => {
  it('gives the safe reply', () => {
    expect(webFallbackReplies().safeReply('en')).toBe(SAFE_REPLY);
  });

  it('lists every helpline of the locale pack in the distress reply', () => {
    const locale = {
      helplines: [
        { name: 'Test Line A', number: '000-111' },
        { name: 'Test Line B', number: '000-222' },
      ],
    } as unknown as LocalePack;
    const reply = webFallbackReplies().distress('en', locale);
    expect(reply).toContain('Test Line A: 000-111; Test Line B: 000-222');
    expect(reply).toMatch(/not alone/);
  });
});
