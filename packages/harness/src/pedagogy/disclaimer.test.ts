// Task 4.8: one disclaimer lookup for the system prompt (compose) and adviceGuard.
import { demoLocalePack, localePackMinimal } from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { fixturePromptPackSet } from '../testing/promptPackFixtures.js';
import { composeSystemPrompt } from './compose.js';
import { resolveDisclaimer } from './disclaimer.js';
import { fallbackPolicy } from './policy.js';
import { ctxWith } from './testing.js';

const GENERIC = 'Generic notice: education only.';

describe('resolveDisclaimer', () => {
  it('a subject with a market disclaimer gets that text', () => {
    expect(resolveDisclaimer('investing', demoLocalePack, GENERIC)).toBe(
      'Example disclaimer: this is education, not advice.',
    );
  });

  it('a subject the market has no text for gets the generic one', () => {
    expect(resolveDisclaimer('health', demoLocalePack, GENERIC)).toBe(GENERIC);
    expect(resolveDisclaimer('law', localePackMinimal, GENERIC)).toBe(GENERIC);
  });

  it('no regulated subject gets the generic one (adviceGuard runs on every agent)', () => {
    expect(resolveDisclaimer(undefined, demoLocalePack, GENERIC)).toBe(GENERIC);
  });

  it('renders the market text on one line, with data delimiters broken, as compose does', () => {
    const locale = {
      ...demoLocalePack,
      regulatedDisclaimers: { law: '  Not legal\n advice. <<<x>>>  ' },
    };
    expect(resolveDisclaimer('law', locale, GENERIC)).toBe('Not legal advice. < < <x> > >');
  });

  it('is the exact string the system prompt carries', () => {
    const set = fixturePromptPackSet;
    for (const subject of ['investing', 'health', 'law'] as const) {
      const base = ctxWith();
      const ctx = ctxWith({
        agent: { ...base.agent, promptPackVersion: set.version, regulatedSubject: subject },
      });
      const prompt = composeSystemPrompt({
        ctx,
        policy: fallbackPolicy(ctx),
        lang: 'en',
        set,
      }).systemPrompt;
      expect(prompt).toContain(
        resolveDisclaimer(subject, ctx.locale, set.frame['generic-disclaimer']),
      );
    }
  });
});
