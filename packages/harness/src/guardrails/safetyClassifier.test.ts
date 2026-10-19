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
  SafetyGuardCancelledError,
} from './safetyClassifier.js';

const T = 1_000;

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
    blocks: new Map(),
  };
}

describe('askClassifier', () => {
  it(
    'returns a valid answer',
    async () => {
      const req = buildModerationClassifierRequest('hi', []);
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
          buildJailbreakClassifierRequest('hi', []),
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
      const r = buildJailbreakClassifierRequest('canary_text', ['a', 'b', 'c', 'd']);
      expect(r).toMatchObject({ tier: 'small', temperature: 0, maxOutputTokens: 20 });
      expect(r.system).not.toContain('canary_text');
      expect(JSON.parse(r.messages[0]?.content ?? '')).toEqual({
        earlier: ['b', 'c', 'd'],
        latest: 'canary_text',
      });
    },
    T,
  );
});
