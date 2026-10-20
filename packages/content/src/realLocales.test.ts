// The committed `content/locales` (task 3.10). These checks hold before and after a person
// verifies the India helpline, so they never need changing when that sign-off lands:
//   - the default pack is always served and passes every rule on its own (it needs no human input);
//   - a market pack is served exactly when its helplines are verified, else refused, and its
//     market then gets the default pack;
//   - acceptance: "an unknown market falls back to the default pack and still raises safety
//     alerts", end to end through the real runner and the real prompt packs.
import { fileURLToPath } from 'node:url';
import type { LocalePack, SafetyAlert } from '@edmate/contracts';
import { composeSystemPrompt, fallbackPolicy, runTurn } from '@edmate/harness';
import {
  demoAgentConfig,
  demoEntitlementSubscription,
  demoPackagePaid,
  demoSafetyAlert,
  demoStyleCard,
  demoTurnContext,
  demoTurnInput,
  driveTurn,
  TEST_DISTRESS_REPLY,
  testDeps,
  testSteps,
} from '@edmate/harness/testing';
import { describe, expect, it } from 'vitest';
import { readLocalePacksDir } from './localeLoader.js';
import { checkLocalePacks, unverifiedHelplines } from './localeRules.js';
import { DEFAULT_LOCALE_MARKET, loadLocalePacks, pickLocalePack } from './localePacks.js';
import { readPromptPackLibrary } from './promptPacks.js';

const LOCALES = fileURLToPath(new URL('../../../content/locales', import.meta.url));
const PROMPT_PACKS = fileURLToPath(new URL('../../../content/prompt-packs', import.meta.url));

describe('content/locales', () => {
  const all = readLocalePacksDir(LOCALES);
  const loaded = loadLocalePacks(LOCALES);

  it('every file loads, and the default and India packs are there', () => {
    expect(all.errors).toEqual([]);
    expect([...all.packs.keys()]).toEqual(['IN', DEFAULT_LOCALE_MARKET]);
  });

  it('the default pack passes every rule on its own and has no helpline to verify', () => {
    const global = all.packs.get(DEFAULT_LOCALE_MARKET) as LocalePack;
    expect(checkLocalePacks(new Map([[DEFAULT_LOCALE_MARKET, global]]))).toEqual([]);
    expect(global.helplines).toEqual([]);
    expect(loaded.packs.get(DEFAULT_LOCALE_MARKET)).toEqual(global);
  });

  it('a market pack is served exactly when its helplines are verified; else it is refused', () => {
    for (const [market, pack] of all.packs) {
      const why = unverifiedHelplines(pack);
      if (why.length === 0) {
        expect(loaded.packs.get(market)).toEqual(pack);
        expect(pickLocalePack(market, loaded.packs)).toEqual(pack);
      } else {
        expect(loaded.packs.has(market)).toBe(false);
        expect(loaded.refused).toContainEqual({ market, reasons: why });
        expect(pickLocalePack(market, loaded.packs).market).toBe(DEFAULT_LOCALE_MARKET);
        // Defence in depth: even handed the unfiltered packs, the pick refuses it.
        expect(pickLocalePack(market, all.packs).market).toBe(DEFAULT_LOCALE_MARKET);
      }
    }
  });

  it('no served pack shows a helpline that is still pending', () => {
    for (const pack of loaded.packs.values()) {
      for (const h of pack.helplines) {
        expect(h.number.toLowerCase()).not.toContain('pending');
        expect(h.verifiedBy.toLowerCase()).not.toContain('pending');
      }
    }
  });
});

describe('an unknown market falls back to the default pack and still raises safety alerts', () => {
  const { packs } = loadLocalePacks(LOCALES);
  const picked = pickLocalePack('ZZ', packs);
  const library = readPromptPackLibrary(PROMPT_PACKS);
  const [set] = [...library.values()];

  it('picks the default pack', () => {
    expect(picked.market).toBe(DEFAULT_LOCALE_MARKET);
  });

  it('a distress prompt carries the real no-helplines wording, and no number', () => {
    if (set === undefined) throw new Error('no prompt-pack set in content/prompt-packs');
    const ctx = {
      ...demoTurnContext,
      agent: { ...demoAgentConfig, promptPackVersion: set.version },
      locale: picked,
      intent: 'distress' as const,
    };
    const { systemPrompt } = composeSystemPrompt({
      ctx,
      policy: fallbackPolicy(ctx),
      lang: 'en',
      set,
    });
    expect(systemPrompt).toContain(set.frame['no-helplines']);
    expect(set.frame['no-helplines']).toMatch(/local emergency services/);
    expect(systemPrompt).not.toMatch(/pending/i);
  });

  it('the runner raises the alert and sends the caring reply for that pack', async () => {
    const seen: LocalePack[] = [];
    const t = testDeps({
      overrides: {
        fallbackReplies: {
          safeReply: () => 'safe',
          distress: (_lang, locale) => {
            seen.push(locale);
            return TEST_DISTRESS_REPLY;
          },
        },
      },
    });
    const steps = testSteps({
      entitle: () =>
        Promise.resolve({
          entitlement: { ...demoEntitlementSubscription, market: 'ZZ' },
          agent: demoAgentConfig,
          pkg: demoPackagePaid,
          locale: picked,
          styleCard: demoStyleCard,
        }),
      preGuard: () =>
        Promise.resolve({
          result: 'escalate',
          alert: demoSafetyAlert,
          guards: [{ name: 'moderationIn', ok: false, action: 'escalate' }],
          usage: [],
        }),
      escalate: () => Promise.reject(new Error('escalate is built by a later task')),
    });
    const { events } = await driveTurn(runTurn(demoTurnInput, { deps: t.deps, steps }), t.clock);
    expect(events).toContainEqual({ type: 'safety', level: 'alert' });
    expect(events).toContainEqual({ type: 'token', text: TEST_DISTRESS_REPLY });
    expect(t.alerts.raised).toHaveLength(1);
    expect((t.alerts.raised[0] as SafetyAlert).kind).toBe(demoSafetyAlert.kind);
    expect(seen.map((l) => l.market)).toEqual([DEFAULT_LOCALE_MARKET]);
  });
});
