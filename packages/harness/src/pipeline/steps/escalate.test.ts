// escalate (task 4.3): the caring reply is always the template plus the locale pack's helplines;
// it never echoes the alert (no ids, no "alert", no "trust team"). English only (pilot decision).
import type { LocalePack } from '@edmate/contracts';
import {
  demoAgentConfig,
  demoEntitlementSubscription,
  demoLocalePack,
  demoPackagePaid,
  demoSafetyAlert,
  demoStyleCard,
  demoTurnInput,
  localePackMinimal,
} from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { indiaLocalePackWithHelplines } from '../../testing/distressLocaleFixtures.js';
import { stepEnvExtras, testDeps } from '../../testing/testSteps.js';
import { cancelSource } from '../clock.js';
import { LAST_RESORT_DISTRESS_REPLY } from '../replies.js';
import type { Entitled, StepEnv } from '../types.js';
import { buildCaringReply, escalate } from './escalate.js';

const env = (): StepEnv => ({
  input: demoTurnInput,
  deps: testDeps().deps,
  cancel: cancelSource().token,
  turnId: 'turn_1',
  ...stepEnvExtras(),
});
const entitledWith = (locale: LocalePack): Entitled => ({
  entitlement: demoEntitlementSubscription,
  agent: demoAgentConfig,
  pkg: demoPackagePaid,
  locale,
  styleCard: demoStyleCard,
});

const FORBIDDEN = [/alert/i, /trust team/i, /alt_|alert_\d|ses_|stu_|tch_/i];

describe('buildCaringReply', () => {
  it('no helpline in the pack → the generic wording (emergency services, someone you trust)', () => {
    const reply = buildCaringReply(localePackMinimal);
    expect(reply).toBe(LAST_RESORT_DISTRESS_REPLY);
    expect(reply).toMatch(/local emergency services/);
    expect(reply).toMatch(/someone you trust/);
    expect(reply).toMatch(/I'm an AI/);
  }, 1_000);

  it('the pack helplines follow the template, each with its number', () => {
    const reply = buildCaringReply(indiaLocalePackWithHelplines);
    expect(reply.startsWith(LAST_RESORT_DISTRESS_REPLY)).toBe(true);
    expect(reply).toContain('Tele-MANAS on 14416');
  }, 1_000);

  it('several helplines are joined with "or"', () => {
    const reply = buildCaringReply({
      ...localePackMinimal,
      helplines: [
        { name: 'Line A', number: '000-1', kind: 'mental_health' },
        { name: 'Line B', number: '000-2', kind: 'child' },
      ],
    });
    expect(reply).toContain('You can also call Line A on 000-1 or Line B on 000-2.');
  }, 1_000);

  it('blank helpline entries are skipped', () => {
    const reply = buildCaringReply({
      ...localePackMinimal,
      helplines: [{ name: ' ', number: '', kind: 'mental_health' }],
    });
    expect(reply).toBe(LAST_RESORT_DISTRESS_REPLY);
  }, 1_000);

  it('never promises to stay, never mentions the alert mechanism or ids', () => {
    for (const pack of [localePackMinimal, demoLocalePack, indiaLocalePackWithHelplines]) {
      const reply = buildCaringReply(pack);
      for (const re of FORBIDDEN) expect(reply).not.toMatch(re);
      expect(reply).not.toMatch(/i promise|stay with you/i);
    }
  }, 1_000);
});

describe('escalate step', () => {
  it('replies with the caring template for the entitled locale and ignores the alert', async () => {
    const withAlert = await escalate(env(), entitledWith(indiaLocalePackWithHelplines), demoSafetyAlert);
    const without = await escalate(env(), entitledWith(indiaLocalePackWithHelplines), undefined);
    expect(withAlert).toEqual({ replyText: buildCaringReply(indiaLocalePackWithHelplines) });
    expect(without).toEqual(withAlert);
    expect(withAlert.replyText).not.toContain(demoSafetyAlert.id);
  }, 1_000);
});
