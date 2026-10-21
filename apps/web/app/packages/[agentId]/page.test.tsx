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
  PackageCompare: ({ packages }: { packages: unknown[] }) => (
    <p>compare: {packages.length} packages</p>
  ),
}));

import PackagesPage from './page';

beforeEach(() => {
  state.requireRole.mockReset();
  state.owner.mockReset();
  state.findLive.mockReset();
  state.liveForAgent.mockReset();
});

describe('/packages/[agentId]', () => {
  it('asks for a student with agent clearance before any database read', async () => {
    state.requireRole.mockResolvedValueOnce({ userId: 'std_amy', role: 'student' });
    state.owner.mockResolvedValueOnce({ teacherId: 'tch_asha' });
    state.findLive.mockResolvedValueOnce(null);
    state.liveForAgent.mockResolvedValueOnce([]);
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

  it('a student with no live subscription sees the compare view, scoped to the owner', async () => {
    state.requireRole.mockResolvedValueOnce({ userId: 'std_amy', role: 'student' });
    state.owner.mockResolvedValueOnce({ teacherId: 'tch_asha' });
    state.findLive.mockResolvedValueOnce(null);
    state.liveForAgent.mockResolvedValueOnce([{ packageVersionId: 'pv_1', config: {} }]);
    render(await PackagesPage({ params: Promise.resolve({ agentId: 'agt_demo' }) }));
    expect(state.findLive).toHaveBeenCalledWith({ studentId: 'std_amy', teacherId: 'tch_asha' });
    expect(state.liveForAgent).toHaveBeenCalledWith({ agentId: 'agt_demo' });
    expect(screen.getByText('compare: 1 packages')).toBeInTheDocument();
  });

  it('reads no database when the guard refuses (anonymous or wrong role)', async () => {
    state.requireRole.mockRejectedValueOnce(new Error('NOT_FOUND'));
    await expect(
      PackagesPage({ params: Promise.resolve({ agentId: 'agt_demo' }) }),
    ).rejects.toThrow('NOT_FOUND');
    expect(state.owner).not.toHaveBeenCalled();
  });
});
