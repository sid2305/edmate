import type { Entitlement } from '@edmate/contracts';
import {
  demoAgentConfig,
  demoEntitlementEval,
  demoEntitlementPreview,
  demoEntitlementSubscription,
  demoLocalePack,
  demoPackagePaid,
  demoStyleCard,
} from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { checkEntitlement, checkTurnConfig, type TurnConfigReason } from './entitlement.js';

const e: Entitlement = demoEntitlementSubscription;
const req = { studentId: e.studentId, agentId: e.agentId, source: e.source };
const cfg = {
  agent: demoAgentConfig,
  pkg: demoPackagePaid,
  styleCard: demoStyleCard,
  locale: demoLocalePack,
};

describe('checkEntitlement', () => {
  it('accepts a matching, live entitlement for each source and returns a parsed copy', () => {
    for (const x of [demoEntitlementSubscription, demoEntitlementPreview, demoEntitlementEval]) {
      const r = checkEntitlement(x, {
        studentId: x.studentId,
        agentId: x.agentId,
        source: x.source,
      });
      expect(r).toEqual({ ok: true, value: x });
      if (r.ok) expect(r.value).not.toBe(x);
    }
    for (const status of ['trial', 'active', 'past_due'] as const) {
      expect(checkEntitlement({ ...e, status }, req).ok).toBe(true);
    }
  });

  it.each([
    ['null', null, 'invalid'],
    ['a string', 'sub_test_01', 'invalid'],
    ['schema-invalid', { ...e, packageVersion: -1 }, 'invalid'],
    ['subscription without subscriptionId', { ...e, subscriptionId: undefined }, 'invalid'],
    ['allowed and locked overlap', { ...e, lockedModuleIds: ['mod_test_01'] }, 'invalid'],
    ['an extra (smuggled) key', { ...e, isAdmin: true }, 'invalid'],
    ['another source', { ...demoEntitlementPreview, studentId: e.studentId }, 'source'],
    ['another student', { ...e, studentId: 'stu_other' }, 'student'],
    ['another agent', { ...e, agentId: 'agt_other' }, 'agent'],
    ['paused', { ...e, status: 'paused' }, 'paused'],
    ['ended', { ...e, status: 'ended' }, 'ended'],
  ])('refuses %s', (_label, raw, reason) => {
    expect(checkEntitlement(raw, req)).toEqual({ ok: false, reason });
  });
});

describe('checkTurnConfig', () => {
  it('accepts config that all belongs to the entitlement', () => {
    expect(checkTurnConfig(e, cfg)).toEqual({ ok: true, value: cfg });
  });

  const cases: [string, unknown, TurnConfigReason][] = [
    ['null', null, 'invalid'],
    ['a number', 7, 'invalid'],
    ['a missing agent', { ...cfg, agent: undefined }, 'invalid'],
    ['a schema-invalid package', { ...cfg, pkg: { ...cfg.pkg, helpCeiling: 9 } }, 'invalid'],
    ['a schema-invalid style card', { ...cfg, styleCard: { id: 'x' } }, 'invalid'],
    ['a schema-invalid locale', { ...cfg, locale: { market: 'IN' } }, 'invalid'],
    ['another agent', { ...cfg, agent: { ...cfg.agent, id: 'agt_other' } }, 'agent_id'],
    [
      "another teacher's agent",
      { ...cfg, agent: { ...cfg.agent, teacherId: 'tch_other' } },
      'agent_teacher',
    ],
    ['another package', { ...cfg, pkg: { ...cfg.pkg, id: 'pkg_other' } }, 'pkg_id'],
    [
      "another teacher's package",
      { ...cfg, pkg: { ...cfg.pkg, teacherId: 'tch_other' } },
      'pkg_teacher',
    ],
    ["another agent's package", { ...cfg, pkg: { ...cfg.pkg, agentId: 'agt_other' } }, 'pkg_agent'],
    ['another package version', { ...cfg, pkg: { ...cfg.pkg, version: 1 } }, 'pkg_version'],
    [
      'another style card',
      { ...cfg, styleCard: { ...cfg.styleCard, id: 'sty_other' } },
      'style_card_id',
    ],
    [
      "another teacher's style card",
      { ...cfg, styleCard: { ...cfg.styleCard, teacherId: 'tch_other' } },
      'style_card_teacher',
    ],
    ['another market', { ...cfg, locale: { ...cfg.locale, market: 'US' } }, 'locale_market'],
    [
      'allowed modules beyond the package',
      { ...cfg, pkg: { ...cfg.pkg, moduleIds: ['mod_test_01'] } },
      'modules',
    ],
    ['skills beyond the package', { ...cfg, pkg: { ...cfg.pkg, skills: ['explain'] } }, 'skills'],
  ];
  it.each(cases)('refuses %s', (_label, raw, reason) => {
    expect(checkTurnConfig(e, raw)).toEqual({ ok: false, reason });
  });
});
