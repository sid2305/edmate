// @vitest-environment jsdom
// Task 9.6 Phase B: the /learn/[agentId]/progress page. Students only (default clearance, same as
// the memory page: a student waiting on a parent's consent can still see progress); a non-live
// agent gives notFound. No database -- auth and repos are stubbed (rule 4).
import { axe, toHaveNoViolations } from 'jest-axe';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';

expect.extend(toHaveNoViolations);

const state = vi.hoisted(() => ({
  requireRole: vi.fn(),
  owner: vi.fn(),
  profileGet: vi.fn(),
  getOutline: vi.fn(),
  findLive: vi.fn(),
  getById: vi.fn(),
  viewProps: [] as Array<Record<string, unknown>>,
}));

vi.mock('../../../../src/auth', () => ({
  requireRole: state.requireRole,
  serverDatabase: () => ({
    repos: {
      agents: { owner: state.owner },
      learnerProfiles: { get: state.profileGet },
      outline: { getOutline: state.getOutline },
      subscriptions: { findLive: state.findLive },
      packageVersions: { getById: state.getById },
    },
  }),
}));
vi.mock('../../../home/actions', () => ({ signOutAndRedirect: vi.fn() }));
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
vi.mock('../../../../src/progress/ProgressView', () => ({
  ProgressView: (props: Record<string, unknown>) => {
    state.viewProps.push(props);
    return <p>progress view</p>;
  },
}));

import ProgressPage from './page';

beforeEach(() => {
  state.requireRole.mockReset();
  state.owner.mockReset();
  state.profileGet.mockReset();
  state.getOutline.mockReset();
  state.findLive.mockReset();
  state.getById.mockReset();
  state.viewProps.length = 0;
});

const PRINCIPAL = { userId: 'std_amy', role: 'student' as const };

function params(agentId: string) {
  return Promise.resolve({ agentId });
}

describe('ProgressPage', () => {
  it('asks for the student role at the default clearance (age, not agent)', async () => {
    state.requireRole.mockResolvedValueOnce(PRINCIPAL);
    state.owner.mockResolvedValueOnce({ teacherId: 'tch_asha' });
    state.profileGet.mockResolvedValueOnce(null);
    state.getOutline.mockResolvedValueOnce(null);
    state.findLive.mockResolvedValueOnce(null);
    await ProgressPage({ params: params('agt_1') });
    expect(state.requireRole).toHaveBeenCalledWith(['student']);
  });

  it('reads no database when the guard refuses (anonymous or wrong role)', async () => {
    state.requireRole.mockRejectedValueOnce(new Error('NEXT_REDIRECT'));
    await expect(ProgressPage({ params: params('agt_1') })).rejects.toThrow('NEXT_REDIRECT');
    expect(state.owner).not.toHaveBeenCalled();
  });

  it('a non-live or malformed agent gives notFound', async () => {
    state.requireRole.mockResolvedValue(PRINCIPAL);
    state.owner.mockResolvedValue(null);
    await expect(ProgressPage({ params: params('agt_1') })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('renders the view with the resolved progress, using the subscription package to scope next steps', async () => {
    state.requireRole.mockResolvedValue(PRINCIPAL);
    state.owner.mockResolvedValue({ teacherId: 'tch_asha' });
    state.profileGet.mockResolvedValue({
      studentId: 'std_amy',
      teacherId: 'tch_asha',
      lang: 'en',
      mastery: {},
      mistakes: [],
    });
    state.getOutline.mockResolvedValue(null);
    state.findLive.mockResolvedValue({ packageVersionId: 'pkv_1' });
    state.getById.mockResolvedValue({ moduleIds: ['mod_1'] });
    const el = await ProgressPage({ params: params('agt_1') });
    render(el);
    expect(screen.getByText('progress view')).toBeInTheDocument();
    expect(state.getById).toHaveBeenCalledWith({ teacherId: 'tch_asha' }, 'pkv_1');
    expect(state.viewProps[0]).toMatchObject({ agentId: 'agt_1' });
  });

  it('skips the package lookup when there is no live subscription', async () => {
    state.requireRole.mockResolvedValue(PRINCIPAL);
    state.owner.mockResolvedValue({ teacherId: 'tch_asha' });
    state.profileGet.mockResolvedValue(null);
    state.getOutline.mockResolvedValue(null);
    state.findLive.mockResolvedValue(null);
    await ProgressPage({ params: params('agt_1') });
    expect(state.getById).not.toHaveBeenCalled();
  });

  it('has no axe violations', async () => {
    state.requireRole.mockResolvedValue(PRINCIPAL);
    state.owner.mockResolvedValue({ teacherId: 'tch_asha' });
    state.profileGet.mockResolvedValue(null);
    state.getOutline.mockResolvedValue(null);
    state.findLive.mockResolvedValue(null);
    const el = await ProgressPage({ params: params('agt_1') });
    const { container } = render(el);
    expect(await axe(container)).toHaveNoViolations();
  });
});
