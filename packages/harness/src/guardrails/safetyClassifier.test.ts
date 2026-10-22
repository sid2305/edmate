// The shared classifier call (task 4.4): fails closed on cancel, timeout, throw or a bad answer.
import type { ModelGateway } from '@edmate/contracts';
import { demoEntitlementSubscription, demoLocalePack } from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { cancelSource } from '../pipeline/clock.js';
import { sequentialIds } from '../testing/ids.js';
import { memorySafetyEventSink } from '../testing/memoryPorts.js';
import { virtualClock } from '../testing/virtualClock.js';
import type { PreGuardCtx } from './preGuardCtx.js';
import {
  askClassifier,
  buildJailbreakClassifierRequest,
  buildModerationClassifierRequest,
  JailbreakVerdictSchema,
  ModerationVerdictSchema,
  classifierAbout,
  DEFAULT_MIN_AGE,
  learnerMinAge,
  SafetyGuardCancelledError,
} from './safetyClassifier.js';

const T = 20_000;
const ABOUT = { course: 'Course canary_course', minAge: 13 };

function ctx(answer: unknown): PreGuardCtx {
  const gateway: ModelGateway = {
    stream: () => {
      throw new Error('unused');
    },
    embed: () => Promise.reject(new Error('unused')),
    generateObject: <X>() => Promise.resolve(answer as X),
  };
  return {
    locale: demoLocalePack,
    entitlement: demoEntitlementSubscription,
    sessionId: 'ses_test_01',
    lang: 'en',
    gateway,
    ids: sequentialIds(),
    clock: virtualClock(),
    recentStudentTurns: [],
    turnId: 'trn_test_01',
    safetyEvents: memorySafetyEventSink(),
    packageNames: [],
    currentPackageName: 'Free starter',
    blocks: new Map(),
  };
}

describe('askClassifier', () => {
  it(
    'returns a valid answer',
    async () => {
      const req = buildModerationClassifierRequest('hi', [], ABOUT);
      await expect(
        askClassifier(
          'moderationIn',
          ctx({ category: 'none' }),
          cancelSource().token,
          req,
          ModerationVerdictSchema,
        ),
      ).resolves.toEqual({ category: 'none' });
    },
    T,
  );

  it(
    'an already-cancelled token throws before any call',
    async () => {
      const c = cancelSource();
      c.cancel();
      await expect(
        askClassifier(
          'jailbreak',
          ctx({ category: 'none' }),
          c.token,
          buildJailbreakClassifierRequest('hi', [], ABOUT),
          JailbreakVerdictSchema,
        ),
      ).rejects.toBeInstanceOf(SafetyGuardCancelledError);
    },
    T,
  );

  it(
    'the two taxonomies differ and both allow none',
    () => {
      expect(ModerationVerdictSchema.safeParse({ category: 'hate' }).success).toBe(true);
      expect(JailbreakVerdictSchema.safeParse({ category: 'hate' }).success).toBe(false);
      expect(JailbreakVerdictSchema.safeParse({ category: 'jailbreak_encoded' }).success).toBe(
        true,
      );
      expect(ModerationVerdictSchema.safeParse({ category: 'none', extra: 1 }).success).toBe(false);
    },
    T,
  );

  it(
    'the requests are small-tier, temperature 0, with the text only as JSON data',
    () => {
      const r = buildJailbreakClassifierRequest('canary_text', ['a', 'b', 'c', 'd'], ABOUT);
      expect(r).toMatchObject({ tier: 'small', temperature: 0, maxOutputTokens: 20 });
      expect(r.system).not.toContain('canary_text');
      expect(JSON.parse(r.messages[0]?.content ?? '')).toEqual({
        course: 'Course canary_course',
        earlier: ['b', 'c', 'd'],
        latest: 'canary_text',
      });
      // The course is teacher text: it goes in the data, never the prompt.
      expect(r.system).not.toContain('canary_course');
      expect(r.system).not.toMatch(/programming/i);
    },
    T,
  );

  it(
    'the minimum age comes from the locale pack; 13 when it is missing or odd (fix round MEDIUM 6)',
    () => {
      expect(DEFAULT_MIN_AGE).toBe(13);
      expect(buildModerationClassifierRequest('x', [], { ...ABOUT, minAge: 16 }).system).toMatch(
        /aged 16 or over/,
      );
      for (const odd of [undefined, 0, 2.5, 120, '13']) expect(learnerMinAge(odd)).toBe(13);
      expect(learnerMinAge(18)).toBe(18);
      const c = ctx({ category: 'none' });
      expect(classifierAbout(c)).toEqual({
        course: 'Free starter',
        minAge: learnerMinAge(c.locale.compliance.minAge),
      });
      expect(buildModerationClassifierRequest('x', [], classifierAbout(c)).system).toMatch(
        new RegExp(`aged ${learnerMinAge(c.locale.compliance.minAge)} or over`),
      );
    },
    T,
  );
});
