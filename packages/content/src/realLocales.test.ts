// The committed `content/locales` (task 3.10). These checks hold before and after a person
// verifies the India helpline, so they never need changing when that sign-off lands:
//   - the default pack is always served and passes every rule on its own (it needs no human input);
//   - every committed pack is served (none refused), with exactly its verified helplines;
//   - an IN pack whose helplines are pending (a copy, forced pending) is served with no helplines
//     and all four India PII patterns active: 4.2's piiScrub cases pass through it, and a distress
//     turn gets the country-neutral no-helplines line and still raises the alert;
//   - acceptance: "an unknown market falls back to the default pack and still raises safety alerts".
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  IN_PII_PATTERNS,
  piiScrubCaseFailures,
  TEST_DISTRESS_REPLY,
  testDeps,
  testSteps,
} from '@edmate/harness/testing';
import { afterAll, describe, expect, it } from 'vitest';
import { agePolicyFor, agePolicyResolver } from './agePolicy.js';
import { readLocalePacksDir } from './localeLoader.js';
import { checkLocalePacks } from './localeRules.js';
import {
  DEFAULT_LOCALE_MARKET,
  loadLocalePacks,
  pickLocalePack,
  withVerifiedHelplines,
} from './localePacks.js';
import { readPromptPackLibrary } from './promptPacks.js';

const LOCALES = fileURLToPath(new URL('../../../content/locales', import.meta.url));
const PROMPT_PACKS = fileURLToPath(new URL('../../../content/prompt-packs', import.meta.url));
const [SET] = [...readPromptPackLibrary(PROMPT_PACKS).values()];
const NO_HELPLINES = SET?.frame['no-helplines'] ?? '';

/** The distress system prompt for `locale`, with the real prompt packs. */
function distressPrompt(locale: LocalePack): string {
  if (SET === undefined) throw new Error('no prompt-pack set in content/prompt-packs');
  const ctx = {
    ...demoTurnContext,
    agent: { ...demoAgentConfig, promptPackVersion: SET.version },
    locale,
    intent: 'distress' as const,
  };
  return composeSystemPrompt({ ctx, policy: fallbackPolicy(ctx), lang: 'en', set: SET })
    .systemPrompt;
}

/** A distress turn through the real runner with `locale`: its events, alerts and the pack the reply saw. */
async function distressTurn(locale: LocalePack, market: string) {
  const seen: LocalePack[] = [];
  const t = testDeps({
    overrides: {
      fallbackReplies: {
        safeReply: () => 'safe',
        distress: (_lang, l) => {
          seen.push(l);
          return TEST_DISTRESS_REPLY;
        },
      },
    },
  });
  const steps = testSteps({
    entitle: () =>
      Promise.resolve({
        entitlement: { ...demoEntitlementSubscription, market },
        agent: demoAgentConfig,
        pkg: demoPackagePaid,
        locale,
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
  return { events, alerts: t.alerts.raised as SafetyAlert[], seen };
}

describe('content/locales', () => {
  const all = readLocalePacksDir(LOCALES);
  const loaded = loadLocalePacks(LOCALES);

  it('every file loads, and the default, India and US packs are there', () => {
    expect(all.errors).toEqual([]);
    expect([...all.packs.keys()]).toEqual(['IN', 'US', DEFAULT_LOCALE_MARKET]);
  });

  it('the default pack passes every rule on its own and has no helpline to verify', () => {
    const global = all.packs.get(DEFAULT_LOCALE_MARKET) as LocalePack;
    expect(checkLocalePacks(new Map([[DEFAULT_LOCALE_MARKET, global]]))).toEqual([]);
    expect(global.helplines).toEqual([]);
    expect(loaded.packs.get(DEFAULT_LOCALE_MARKET)).toEqual(global);
  });

  it('every pack is served (none refused), with exactly its verified helplines', () => {
    expect(loaded.refused).toEqual([]);
    for (const [market, pack] of all.packs) {
      expect(loaded.packs.get(market)).toEqual(withVerifiedHelplines(pack).pack);
      expect(pickLocalePack(market, loaded.packs)).toEqual(withVerifiedHelplines(pack).pack);
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

// Task 1.7f: the human signed the US pack's compliance block (answer B-27, 21 Oct 2026), so its
// waiver now applies. privacyLaw, dataRegion and grievance stay pending for counsel (task 3.10c).
describe('content/locales: the age rule per market (task 1.7)', () => {
  const all = readLocalePacksDir(LOCALES);
  const US = all.packs.get('US') as LocalePack;

  it('the US pack is signed, with privacyLaw/dataRegion/grievance still pending for counsel', () => {
    expect(US.compliance.minAge).toBe(13);
    expect(US.compliance.parentalConsentRequired).toBe(false);
    expect(US.reviewedBy).toBe('sid2305');
    expect(US.helplines).toEqual([]);
    expect(US.compliance.dataRegion).toBe('pending');
    expect(US.compliance.grievance).toBe('pending');
    expect(checkLocalePacks(new Map([['US', US]]))).toEqual(
      expect.arrayContaining([
        'US.yaml: compliance.privacyLaw is "pending"',
        'US.yaml: compliance.dataRegion is "pending"',
        'US.yaml: compliance.grievance is "pending"',
      ]),
    );
    expect(checkLocalePacks(new Map([['US', US]]))).not.toEqual(
      expect.arrayContaining(['US.yaml: reviewedBy is "pending"']),
    );
  });

  it('every committed pack, signed or not, keeps the floor of 13', () => {
    for (const pack of all.packs.values()) expect(agePolicyFor(pack).minAge).toBeGreaterThanOrEqual(13);
  });

  it('the signed US waiver applies: US needs no consent, IN and global still need it', () => {
    const policy = agePolicyResolver(loadLocalePacks(LOCALES).packs);
    expect(policy('US')).toEqual({ minAge: 13, consentRequired: false });
    for (const market of ['IN', DEFAULT_LOCALE_MARKET, 'ZZ']) {
      expect(policy(market)).toEqual({ minAge: 13, consentRequired: true });
    }
  });

  it('an unsigned copy of the US pack still fails closed (consent required)', () => {
    expect(agePolicyFor({ ...US, reviewedBy: 'pending' })).toEqual({
      minAge: 13,
      consentRequired: true,
    });
  });
});

describe('the IN pack with pending helplines, loaded for runtime', () => {
  const dir = mkdtempSync(join(tmpdir(), 'edmate-locales-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(LOCALES, dir, { recursive: true });
  // Force every helpline pending, so this holds after the real sign-off too.
  const file = join(dir, 'IN.yaml');
  writeFileSync(file, readFileSync(file, 'utf8').replace(/^( {4}verifiedBy: ).*$/gm, '$1pending'));
  const loaded = loadLocalePacks(dir);
  const IN = loaded.packs.get('IN') as LocalePack;

  it('loads with zero helplines, every drop reported once, nothing refused', () => {
    expect(loaded.refused).toEqual([]);
    expect(IN.helplines).toEqual([]);
    const committed = readLocalePacksDir(dir).packs.get('IN') as LocalePack;
    expect(loaded.droppedHelplines.map((d) => d.helpline)).toEqual(
      committed.helplines.map((h) => h.name),
    );
    expect(loaded.droppedHelplines.every((d) => d.reasons.includes('verifier_pending'))).toBe(true);
  });

  it('keeps all four India PII patterns, and 4.2 piiScrub cases pass through the pack', async () => {
    expect(IN.piiPatterns).toEqual(Object.values(IN_PII_PATTERNS));
    expect(pickLocalePack('IN', loaded.packs)).toBe(IN);
    expect(await piiScrubCaseFailures({ locale: pickLocalePack('IN', loaded.packs) })).toEqual([]);
  });

  it('a distress prompt gets the country-neutral line and no number', () => {
    const prompt = distressPrompt(IN);
    expect(prompt).toContain(NO_HELPLINES);
    expect(NO_HELPLINES).toMatch(/local emergency services/);
    expect(prompt).not.toMatch(/pending|Tele-MANAS/i);
  });

  it('a distress turn raises the alert and the caring reply is built for that pack', async () => {
    const r = await distressTurn(pickLocalePack('IN', loaded.packs), 'IN');
    expect(r.events).toContainEqual({ type: 'safety', level: 'alert' });
    expect(r.events).toContainEqual({ type: 'token', text: TEST_DISTRESS_REPLY });
    expect(r.alerts.map((a) => a.kind)).toEqual([demoSafetyAlert.kind]);
    expect(r.seen.map((l) => [l.market, l.helplines.length])).toEqual([['IN', 0]]);
  });
});

describe('an unknown market falls back to the default pack and still raises safety alerts', () => {
  const { packs } = loadLocalePacks(LOCALES);
  const picked = pickLocalePack('ZZ', packs);

  it('picks the default pack, whose distress prompt has the country-neutral line', () => {
    expect(picked.market).toBe(DEFAULT_LOCALE_MARKET);
    expect(distressPrompt(picked)).toContain(NO_HELPLINES);
  });

  it('the runner raises the alert and sends the caring reply for that pack', async () => {
    const r = await distressTurn(picked, 'ZZ');
    expect(r.events).toContainEqual({ type: 'safety', level: 'alert' });
    expect(r.events).toContainEqual({ type: 'token', text: TEST_DISTRESS_REPLY });
    expect(r.alerts).toHaveLength(1);
    expect(r.seen.map((l) => l.market)).toEqual([DEFAULT_LOCALE_MARKET]);
  });
});
