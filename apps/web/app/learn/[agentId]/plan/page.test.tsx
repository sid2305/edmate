// @vitest-environment jsdom
// Task 9.6 Phase D: the /learn/[agentId]/plan page. Students only (default clearance, same as
// the memory and progress pages); a non-live agent gives notFound. No database -- auth and repos
// are stubbed (rule 4).
import { axe, toHaveNoViolations } from 'jest-axe';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';

expect.extend(toHaveNoViolations);

const state = vi.hoisted(() => ({
  requireRole: vi.fn(),
  owner: vi.fn(),
  findLive: vi.fn(),
  liveForAgent: vi.fn(),
  getById: vi.fn(),
  viewProps: [] as Array<Record<string, unknown>>,
}));

vi.mock('../../../../src/auth', () => ({
  requireRole: state.requireRole,
  serverDatabase: () => ({
    repos: {
      agents: { owner: state.owner },
      subscriptions: { findLive: state.findLive },
      packageVersions: { liveForAgent: state.liveForAgent, getById: state.getById },
    },
  }),
}));
vi.mock('../../../home/actions', () => ({ signOutAndRedirect: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: keyof typeof messages) => {
    const bundle = messages[namespace] as Record<string, unknown>;
    return (key: string) => bundle[key] as string;
  },
}));
vi.mock('next-intl', () => ({
  NextIntlClientProvider: ({ children }: { children: unknown }) => children,
  useTranslations: () => (key: string) => key,
}));
vi.mock('../../../../src/subscriptions/PlanView', () => ({
  PlanView: (props: Record<string, unknown>) => {
    state.viewProps.push(props);
    return <p>plan view</p>;
  },
}));

import PlanPage from './page';

beforeEach(() => {
  state.requireRole.mockReset();
  state.owner.mockReset();
  state.findLive.mockReset();
  state.liveForAgent.mockReset();
  state.getById.mockReset();
  state.viewProps.length = 0;
});

const PRINCIPAL = { userId: 'std_amy', role: 'student' as const };

function params(agentId: string) {
  return Promise.resolve({ agentId });
}

const OFFER = {
  packageVersionId: 'pv_paid_1',
  offer: {
    packageId: 'pkg_paid',
    name: 'Full Course',
    skills: ['explain'],
    dailyMessageLimit: 50,
    liveClassesPerMonth: 1,
    pricePerMonth: { amountMinor: 1999, currency: 'USD' },
    trialDays: 0,
  },
};

describe('PlanPage', () => {
  it('asks for the student role at the default clearance (age, not agent)', async () => {
    state.requireRole.mockResolvedValueOnce(PRINCIPAL);
    state.owner.mockResolvedValueOnce({ teacherId: 'tch_asha' });
    state.findLive.mockResolvedValueOnce(null);
    state.liveForAgent.mockResolvedValueOnce([]);
    await PlanPage({ params: params('agt_1') });
    expect(state.requireRole).toHaveBeenCalledWith(['student']);
  });

  it('reads no database when the guard refuses (anonymous or wrong role)', async () => {
    state.requireRole.mockRejectedValueOnce(new Error('NEXT_REDIRECT'));
    await expect(PlanPage({ params: params('agt_1') })).rejects.toThrow('NEXT_REDIRECT');
    expect(state.owner).not.toHaveBeenCalled();
  });

  it('a non-live or malformed agent gives notFound', async () => {
    state.requireRole.mockResolvedValue(PRINCIPAL);
    state.owner.mockResolvedValue(null);
    await expect(PlanPage({ params: params('agt_1') })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('renders the view with the live subscription, mapping the package version to its id', async () => {
    state.requireRole.mockResolvedValue(PRINCIPAL);
    state.owner.mockResolvedValue({ teacherId: 'tch_asha' });
    state.findLive.mockResolvedValue({
      id: 'sub_1',
      packageVersionId: 'pv_paid_1',
      status: 'active',
      periodEnd: '2026-11-21T00:00:00.000Z',
    });
    state.liveForAgent.mockResolvedValue([OFFER]);
    state.getById.mockResolvedValue({ id: 'pkg_paid' });
    const el = await PlanPage({ params: params('agt_1') });
    render(el);
    expect(screen.getByText('plan view')).toBeInTheDocument();
    expect(state.getById).toHaveBeenCalledWith({ teacherId: 'tch_asha' }, 'pv_paid_1');
    expect(state.viewProps[0]).toMatchObject({
      agentId: 'agt_1',
      subscription: { id: 'sub_1', status: 'active', packageId: 'pkg_paid' },
      offers: [{ packageId: 'pkg_paid', name: 'Full Course', amountMinor: 1999, currency: 'USD' }],
    });
  });

  it('skips the package lookup when there is no live subscription', async () => {
    state.requireRole.mockResolvedValue(PRINCIPAL);
    state.owner.mockResolvedValue({ teacherId: 'tch_asha' });
    state.findLive.mockResolvedValue(null);
    state.liveForAgent.mockResolvedValue([OFFER]);
    render(await PlanPage({ params: params('agt_1') }));
    expect(state.getById).not.toHaveBeenCalled();
    expect(state.viewProps[0]).toMatchObject({ subscription: null });
  });

  it('treats an ended subscription the same as no subscription', async () => {
    state.requireRole.mockResolvedValue(PRINCIPAL);
    state.owner.mockResolvedValue({ teacherId: 'tch_asha' });
    state.findLive.mockResolvedValue({
      id: 'sub_1',
      packageVersionId: 'pv_paid_1',
      status: 'ended',
      periodEnd: '2026-11-21T00:00:00.000Z',
    });
    state.liveForAgent.mockResolvedValue([OFFER]);
    render(await PlanPage({ params: params('agt_1') }));
    expect(state.getById).not.toHaveBeenCalled();
    expect(state.viewProps[0]).toMatchObject({ subscription: null });
  });

  it('has no axe violations', async () => {
    state.requireRole.mockResolvedValue(PRINCIPAL);
    state.owner.mockResolvedValue({ teacherId: 'tch_asha' });
    state.findLive.mockResolvedValue(null);
    state.liveForAgent.mockResolvedValue([]);
    const el = await PlanPage({ params: params('agt_1') });
    const { container } = render(el);
    expect(await axe(container)).toHaveNoViolations();
  });
});
