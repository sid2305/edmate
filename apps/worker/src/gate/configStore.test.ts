import type { Entitlement } from '@edmate/contracts';
import { demoEntitlementEval, demoLocalePack } from '@edmate/harness/testing';
import { describe, expect, it } from 'vitest';
import { gateTurnConfigStore } from './configStore.js';
import type { GateBasis } from './input.js';
import {
  AGENT,
  AGENT_VERSION,
  candidateAgent,
  fakeRepos,
  fakeWorld,
  freePkg,
  paidPkg,
  styleCard,
  TEACHER,
} from '../../test/gate/testkit.js';

const basis: GateBasis = {
  teacherId: TEACHER,
  agentId: AGENT,
  agentVersion: AGENT_VERSION,
  packageVersions: [
    { packageId: freePkg.id, version: freePkg.version },
    { packageId: paidPkg.id, version: paidPkg.version },
  ],
};

const ent = (over: Partial<Entitlement> = {}): Entitlement => ({
  ...demoEntitlementEval,
  teacherId: TEACHER,
  agentId: AGENT,
  packageId: paidPkg.id,
  packageVersion: paidPkg.version,
  ...over,
});

function store(helpStates = new Map<string, unknown>()) {
  const fake = fakeRepos(fakeWorld());
  return {
    fake,
    store: gateTurnConfigStore({
      repos: fake.repos,
      basis,
      locales: (m) => (m === 'none' ? null : demoLocalePack),
      helpState: (id) => helpStates.get(id) ?? null,
    }),
  };
}

describe('gateTurnConfigStore', () => {
  it('loads exactly the candidate agent version, pinned package version and style card', async () => {
    const helpStates = new Map<string, unknown>([['ses_1', { rung: 2 }]]);
    const { store: s, fake } = store(helpStates);
    const loaded = await s.load(ent(), 'ses_1');
    expect(loaded).toEqual({
      agent: candidateAgent,
      pkg: paidPkg,
      styleCard,
      locale: demoLocalePack,
      helpState: { rung: 2 },
    });
    expect(fake.forbidden).toEqual([]);
  });

  it('a fresh session has a null help state', async () => {
    const loaded = await store().store.load(ent(), 'ses_new');
    expect(loaded?.helpState).toBeNull();
  });

  it('another teacher or agent gets null', async () => {
    const { store: s } = store();
    expect(await s.load(ent({ teacherId: 'tch_other' }), 'ses_1')).toBeNull();
    expect(await s.load(ent({ agentId: 'agt_other' }), 'ses_1')).toBeNull();
  });

  it('a package or version not pinned in the basis gets null (no newest-version fallback)', async () => {
    const { store: s } = store();
    expect(await s.load(ent({ packageVersion: paidPkg.version + 1 }), 'ses_1')).toBeNull();
    expect(await s.load(ent({ packageId: 'pkg_unpinned' }), 'ses_1')).toBeNull();
  });

  it('a missing agent version, package row, style card or locale gets null', async () => {
    const locales = () => demoLocalePack;
    const base = { basis, locales, helpState: () => null };
    const noAgent = gateTurnConfigStore({ ...base, repos: fakeRepos(fakeWorld({ agents: [] })).repos });
    expect(await noAgent.load(ent(), 's')).toBeNull();
    const noPkg = gateTurnConfigStore({ ...base, repos: fakeRepos(fakeWorld({ packages: [] })).repos });
    expect(await noPkg.load(ent(), 's')).toBeNull();
    const noCard = gateTurnConfigStore({
      ...base,
      repos: fakeRepos(fakeWorld({ styleCards: [] })).repos,
    });
    expect(await noCard.load(ent(), 's')).toBeNull();
    expect(await store().store.load(ent({ market: 'none' }), 's')).toBeNull();
  });
});
