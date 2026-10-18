// Every refinement and limit, on both sides of each branch.
import { describe, expect, it } from 'vitest';
import {
  demoEntitlementEval,
  demoEntitlementPreview,
  demoEntitlementSubscription,
  demoLearnerProfile,
  demoStyleCard,
  demoTurnInput,
  turnInputSkillAction,
} from '../fixtures/index.js';
import { omit } from '../fixtures/omit.js';
import {
  countChars,
  countWords,
  EntitlementSchema,
  LearnerProfileSchema,
  LIMITS,
  StyleCardSchema,
  TurnEventSchema,
  TurnInputSchema,
} from '../src/index.js';

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
const issuesAt = (r: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  r.error?.issues.map((i) => i.path) ?? [];

describe('LIMITS', () => {
  it('holds the numbers from the spec comments', () => {
    expect(LIMITS).toEqual({
      turnTextMaxChars: 4000,
      turnAttachmentsMax: 2,
      styleCardMaxWords: 300,
      lastSummaryMaxWords: 60,
      helpRungMin: 0,
      helpRungMax: 4,
    });
  });
});

describe('countChars', () => {
  it('counts Unicode code points', () => {
    expect(countChars('')).toBe(0);
    expect(countChars('abc')).toBe(3);
    expect(countChars('🙂')).toBe(1);
    expect(countChars('नमस्ते')).toBe(6);
  });
});

describe('countWords', () => {
  it('counts runs of non-whitespace', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   \n\t ')).toBe(0);
    expect(countWords(' one  two\nthree\tfour ')).toBe(4);
    expect(countWords('नमस्ते दुनिया')).toBe(2);
  });
});

describe('Entitlement', () => {
  const noId = omit(demoEntitlementSubscription, 'subscriptionId');

  it('requires subscriptionId when source is subscription', () => {
    expect(EntitlementSchema.safeParse(demoEntitlementSubscription).success).toBe(true);
    expect(issuesAt(EntitlementSchema.safeParse(noId))).toEqual([['subscriptionId']]);
  });

  it('forbids subscriptionId for teacher_preview and eval', () => {
    expect(EntitlementSchema.safeParse(demoEntitlementPreview).success).toBe(true);
    expect(EntitlementSchema.safeParse(demoEntitlementEval).success).toBe(true);
    for (const e of [demoEntitlementPreview, demoEntitlementEval]) {
      expect(
        issuesAt(EntitlementSchema.safeParse({ ...e, subscriptionId: 'sub_test_01' })),
      ).toEqual([['subscriptionId']]);
    }
  });

  it('fails closed when a module is both allowed and locked', () => {
    const r = EntitlementSchema.safeParse({
      ...demoEntitlementSubscription,
      lockedModuleIds: ['mod_test_01'],
    });
    expect(issuesAt(r)).toEqual([['lockedModuleIds']]);
    expect(r.error?.issues[0]?.message).toContain('mod_test_01');
  });

  it('reports every broken rule at once', () => {
    const r = EntitlementSchema.safeParse({ ...noId, lockedModuleIds: ['mod_test_02'] });
    expect(issuesAt(r)).toEqual([['subscriptionId'], ['lockedModuleIds']]);
  });

  it('accepts ISO 3166 alpha-2 and "global" markets only', () => {
    for (const market of ['IN', 'US', 'global']) {
      expect(EntitlementSchema.safeParse({ ...demoEntitlementPreview, market }).success).toBe(true);
    }
    for (const market of ['in', 'IND', 'Global', 'XX1', '']) {
      expect(EntitlementSchema.safeParse({ ...demoEntitlementPreview, market }).success).toBe(
        false,
      );
    }
  });
});

describe('TurnInput', () => {
  const noText = omit(demoTurnInput, 'text');
  const noSkill = omit(turnInputSkillAction, 'skill');

  it('requires text for kind message', () => {
    expect(issuesAt(TurnInputSchema.safeParse(noText))).toEqual([['text']]);
    expect(TurnInputSchema.safeParse({ ...noText, kind: 'hint_request' }).success).toBe(true);
  });

  it('requires skill for kind skill_action', () => {
    expect(issuesAt(TurnInputSchema.safeParse(noSkill))).toEqual([['skill']]);
    expect(TurnInputSchema.safeParse({ ...noSkill, kind: 'check_answer' }).success).toBe(true);
  });

  it('allows 4,000 characters and rejects 4,001', () => {
    expect(TurnInputSchema.safeParse({ ...demoTurnInput, text: 'é'.repeat(4000) }).success).toBe(
      true,
    );
    expect(
      issuesAt(TurnInputSchema.safeParse({ ...demoTurnInput, text: '🙂'.repeat(4001) })),
    ).toEqual([['text']]);
  });

  it('allows 2 attachments and rejects 3', () => {
    const a = turnInputSkillAction.attachments[0];
    expect(TurnInputSchema.safeParse({ ...demoTurnInput, attachments: [a, a] }).success).toBe(true);
    expect(
      issuesAt(TurnInputSchema.safeParse({ ...demoTurnInput, attachments: [a, a, a] })),
    ).toEqual([['attachments']]);
  });

  it('rejects a client-sent packageId instead of stripping it', () => {
    const r = TurnInputSchema.safeParse({ ...demoTurnInput, packageId: 'pkg_test_paid' });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.code).toBe('unrecognized_keys');
  });
});

describe('word limits', () => {
  it('StyleCard text: 300 words ok, 301 rejected', () => {
    expect(StyleCardSchema.safeParse({ ...demoStyleCard, text: words(300) }).success).toBe(true);
    expect(issuesAt(StyleCardSchema.safeParse({ ...demoStyleCard, text: words(301) }))).toEqual([
      ['text'],
    ]);
  });

  it('LearnerProfile lastSummary: 60 words ok, 61 rejected', () => {
    expect(
      LearnerProfileSchema.safeParse({ ...demoLearnerProfile, lastSummary: words(60) }).success,
    ).toBe(true);
    expect(
      issuesAt(LearnerProfileSchema.safeParse({ ...demoLearnerProfile, lastSummary: words(61) })),
    ).toEqual([['lastSummary']]);
  });
});

describe('TurnEvent hint_rung', () => {
  it('accepts integer rungs 0 to 4 only', () => {
    for (const rung of [0, 1, 2, 3, 4]) {
      expect(TurnEventSchema.safeParse({ type: 'hint_rung', rung }).success).toBe(true);
    }
    for (const rung of [-1, 5, 2.5, Number.NaN]) {
      expect(TurnEventSchema.safeParse({ type: 'hint_rung', rung }).success).toBe(false);
    }
  });
});
