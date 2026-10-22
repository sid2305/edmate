// @vitest-environment jsdom
// Task 9.3 Phase B: the /packages/[agentId] page. Students only (clearance: 'agent'); the agent
// must be live, and an already-subscribed student skips the compare UI -- upgrading (9.6) is out
// of scope here.
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

const state = vi.hoisted(() => ({
  requireRole: vi.fn(),
  owner: vi.fn(),
  findLive: vi.fn(),
  liveForAgent: vi.fn(),
  compareProps: [] as Array<Record<string, unknown>>,
}));

vi.mock('../../../src/auth', () => ({
  requireRole: state.requireRole,
  serverDatabase: () => ({
    repos: {
      agents: { owner: state.owner },
      subscriptions: { findLive: state.findLive },
      packageVersions: { liveForAgent: state.liveForAgent },
    },
  }),
}));
vi.mock('../../home/actions', () => ({ signOutAndRedirect: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: keyof typeof messages) => {
    const bundle = messages[namespace] as Record<string, unknown>;
    return (key: string) => bundle[key] as string;
  },
}));
vi.mock('next-intl', () => ({
  NextIntlClientProvider: ({ children }: { children: unknown }) => children,
}));
vi.mock('./PackageCompare', () => ({
  PackageCompare: (props: { packages: unknown[] }) => {
    state.compareProps.push(props);
    return <p>compare: {props.packages.length} packages</p>;
  },
}));

import PackagesPage from './page';

beforeEach(() => {
  state.requireRole.mockReset();
  state.owner.mockReset();
  state.findLive.mockReset();
  state.liveForAgent.mockReset();
  state.compareProps.length = 0;
});

const OFFER = {
  packageId: 'pkg_paid',
  name: 'Full Course',
  pricePerMonth: { amountMinor: 1999, currency: 'USD' },
  trialDays: 7,
  dailyMessageLimit: 100,
  liveClassesPerMonth: 2,
  skills: ['explain'],
};

describe('/packages/[agentId]', () => {
  it('asks for a student with agent clearance before any database read', async () => {
    state.requireRole.mockResolvedValueOnce({ userId: 'std_amy', role: 'student' });
    state.owner.mockResolvedValueOnce({ teacherId: 'tch_asha' });
    state.findLive.mockResolvedValueOnce(null);
    state.liveForAgent.mockResolvedValueOnce([{ packageVersionId: 'pv_1', offer: OFFER }]);
    render(await PackagesPage({ params: Promise.resolve({ agentId: 'agt_demo' }) }));
    expect(state.requireRole).toHaveBeenCalledWith(['student'], { clearance: 'agent' });
  });

  it('an unknown or not-live agent is notFound, before any subscription read', async () => {
    state.requireRole.mockResolvedValueOnce({ userId: 'std_amy', role: 'student' });
    state.owner.mockResolvedValueOnce(null);
    await expect(
      PackagesPage({ params: Promise.resolve({ agentId: 'agt_missing' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(state.findLive).not.toHaveBeenCalled();
  });

  it('a student with a live subscription skips the compare UI', async () => {
    state.requireRole.mockResolvedValueOnce({ userId: 'std_amy', role: 'student' });
    state.owner.mockResolvedValueOnce({ teacherId: 'tch_asha' });
    state.findLive.mockResolvedValueOnce({
      id: 'sub_1',
      packageVersionId: 'pv_1',
      status: 'active',
      periodEnd: '2026-11-01T00:00:00.000Z',
    });
    render(await PackagesPage({ params: Promise.resolve({ agentId: 'agt_demo' }) }));
    expect(screen.getByText('You already have a package with this teacher.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue to chat' })).toHaveAttribute(
      'href',
      '/learn/agt_demo',
    );
    expect(state.liveForAgent).not.toHaveBeenCalled();
  });

  it('a rejected teacher (liveForAgent empty) is notFound, not an empty compare view', async () => {
    state.requireRole.mockResolvedValueOnce({ userId: 'std_amy', role: 'student' });
    state.owner.mockResolvedValueOnce({ teacherId: 'tch_asha' });
    state.findLive.mockResolvedValueOnce(null);
    state.liveForAgent.mockResolvedValueOnce([]);
    await expect(
      PackagesPage({ params: Promise.resolve({ agentId: 'agt_demo' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('a student with no live subscription sees the compare view, scoped to the owner', async () => {
    state.requireRole.mockResolvedValueOnce({ userId: 'std_amy', role: 'student' });
    state.owner.mockResolvedValueOnce({ teacherId: 'tch_asha' });
    state.findLive.mockResolvedValueOnce(null);
    state.liveForAgent.mockResolvedValueOnce([{ packageVersionId: 'pv_1', offer: OFFER }]);
    render(await PackagesPage({ params: Promise.resolve({ agentId: 'agt_demo' }) }));
    expect(state.findLive).toHaveBeenCalledWith({ studentId: 'std_amy', teacherId: 'tch_asha' });
    expect(state.liveForAgent).toHaveBeenCalledWith({ agentId: 'agt_demo' });
    expect(screen.getByText('compare: 1 packages')).toBeInTheDocument();
  });

  it('passes the client component only the public offer fields (no internal config)', async () => {
    state.requireRole.mockResolvedValueOnce({ userId: 'std_amy', role: 'student' });
    state.owner.mockResolvedValueOnce({ teacherId: 'tch_asha' });
    state.findLive.mockResolvedValueOnce(null);
    state.liveForAgent.mockResolvedValueOnce([{ packageVersionId: 'pv_1', offer: OFFER }]);
    render(await PackagesPage({ params: Promise.resolve({ agentId: 'agt_demo' }) }));
    const props = state.compareProps[0];
    expect(Object.keys(props ?? {}).sort()).toEqual(['agentId', 'packages']);
    const sent = props?.packages as Array<Record<string, unknown>>;
    expect(sent).toEqual([OFFER]);
    expect(Object.keys(sent[0] ?? {}).sort()).toEqual([
      'dailyMessageLimit',
      'liveClassesPerMonth',
      'name',
      'packageId',
      'pricePerMonth',
      'skills',
      'trialDays',
    ]);
    const wire = JSON.stringify(props);
    for (const k of [
      'packageVersionId',
      'moduleIds',
      'helpCeiling',
      'finalAnswers',
      'lockedReply',
      'teacherId',
    ]) {
      expect(wire).not.toContain(k);
    }
  });

  it('reads no database when the guard refuses (anonymous or wrong role)', async () => {
    state.requireRole.mockRejectedValueOnce(new Error('NOT_FOUND'));
    await expect(
      PackagesPage({ params: Promise.resolve({ agentId: 'agt_demo' }) }),
    ).rejects.toThrow('NOT_FOUND');
    expect(state.owner).not.toHaveBeenCalled();
  });
});
