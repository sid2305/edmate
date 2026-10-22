// @vitest-environment jsdom
// Task 6.5 Phase B: the /learn/[agentId]/memory page. Students only (the guard stub redirects
// others); a non-live agent gives notFound. No database -- auth and repos are stubbed (rule 4).
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';

const state = vi.hoisted(() => ({
  requireRole: vi.fn(),
  owner: vi.fn(),
  get: vi.fn(),
  viewProps: [] as Array<Record<string, unknown>>,
}));

vi.mock('../../../../src/auth', () => ({
  requireRole: state.requireRole,
  serverDatabase: () => ({
    repos: { agents: { owner: state.owner }, learnerProfiles: { get: state.get } },
  }),
  HOME_PATH: '/home',
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
vi.mock('../../../../src/memory/MemoryView', () => ({
  MemoryView: (props: Record<string, unknown>) => {
    state.viewProps.push(props);
    return <p>memory view</p>;
  },
}));

import MemoryPage from './page';

beforeEach(() => {
  state.requireRole.mockReset();
  state.owner.mockReset();
  state.get.mockReset();
  state.viewProps.length = 0;
});

const PRINCIPAL = { userId: 'std_amy', role: 'student' as const };

function params(agentId: string) {
  return Promise.resolve({ agentId });
}

describe('MemoryPage', () => {
  it('asks for the student role at the default clearance (age, not agent)', async () => {
    state.requireRole.mockResolvedValueOnce(PRINCIPAL);
    state.owner.mockResolvedValueOnce({ teacherId: 'tch_asha' });
    state.get.mockResolvedValueOnce(null);
    await MemoryPage({ params: params('agt_1') });
    expect(state.requireRole).toHaveBeenCalledWith(['student']);
  });

  it('reads no database when the guard refuses (anonymous or wrong role)', async () => {
    state.requireRole.mockRejectedValueOnce(new Error('NEXT_REDIRECT'));
    await expect(MemoryPage({ params: params('agt_1') })).rejects.toThrow('NEXT_REDIRECT');
    expect(state.owner).not.toHaveBeenCalled();
  });

  it('a non-live or malformed agent gives notFound', async () => {
    state.requireRole.mockResolvedValue(PRINCIPAL);
    state.owner.mockResolvedValue(null);
    await expect(MemoryPage({ params: params('agt_1') })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('renders the view with the resolved scope\'s profile', async () => {
    state.requireRole.mockResolvedValue(PRINCIPAL);
    state.owner.mockResolvedValue({ teacherId: 'tch_asha' });
    state.get.mockResolvedValue({
      studentId: 'std_amy',
      teacherId: 'tch_asha',
      lang: 'en',
      mastery: {},
      mistakes: [],
    });
    const el = await MemoryPage({ params: params('agt_1') });
    render(el);
    expect(screen.getByText('memory view')).toBeInTheDocument();
    expect(state.get).toHaveBeenCalledWith({ studentId: 'std_amy', teacherId: 'tch_asha' });
    expect(state.viewProps[0]).toMatchObject({ agentId: 'agt_1' });
  });
});
