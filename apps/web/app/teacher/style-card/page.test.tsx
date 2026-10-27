// @vitest-environment jsdom
// Task 8.4b: the /teacher/style-card page. Teachers only, the guard runs before any database
// read, and the card read is always the session's own teacher's.
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

const state = vi.hoisted(() => ({
  requireRole: vi.fn(),
  latest: vi.fn(async (_scope: { teacherId: string }): Promise<unknown> => null),
  listPending: vi.fn(async (_scope: { teacherId: string }): Promise<unknown[]> => []),
  seen: [] as unknown[],
  seenProposals: [] as unknown[],
}));

vi.mock('../../../src/auth', () => ({
  requireRole: state.requireRole,
  serverDatabase: () => ({
    repos: {
      styleCards: { latest: state.latest },
      mistakeProposals: { listPending: state.listPending },
    },
  }),
  TEACHER_PATH: '/teacher',
}));
vi.mock('../actions', () => ({ signOutAndRedirect: vi.fn() }));
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: keyof typeof messages) => {
    const bundle = messages[namespace] as Record<string, string>;
    return (key: string) => bundle[key];
  },
}));
vi.mock('./StyleCardView', () => ({
  StyleCardView: (props: { initialCard: unknown; initialProposals: unknown[] }) => {
    state.seen.push(props.initialCard);
    state.seenProposals.push(props.initialProposals);
    return <p>style card view</p>;
  },
}));

import StyleCardPage from './page';

beforeEach(() => {
  state.requireRole.mockReset();
  state.latest.mockClear();
  state.listPending.mockClear();
  state.seen = [];
  state.seenProposals = [];
});

describe('/teacher/style-card', () => {
  it("asks for a teacher, then reads only that teacher's current card", async () => {
    state.requireRole.mockResolvedValueOnce({ userId: 'tch_a', role: 'teacher' });
    const card = { id: 'sty_1', teacherId: 'tch_a', version: 1, text: 'x', mistakeTags: [] };
    const proposals = [
      { tag: 'units', count: 1, lastSeen: '2026-10-01T00:00:00Z', status: 'pending' },
    ];
    state.latest.mockResolvedValueOnce(card);
    state.listPending.mockResolvedValueOnce(proposals);
    render(await StyleCardPage());
    expect(state.requireRole).toHaveBeenCalledWith(['teacher']);
    expect(state.latest).toHaveBeenCalledWith({ teacherId: 'tch_a' });
    expect(state.listPending).toHaveBeenCalledWith({ teacherId: 'tch_a' });
    expect(state.seen).toEqual([card]);
    expect(state.seenProposals).toEqual([proposals]);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Your teaching style');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Studio' })).toHaveAttribute('href', '/teacher');
  });

  it('reads nothing when the guard refuses', async () => {
    state.requireRole.mockRejectedValueOnce(new Error('NOT_FOUND'));
    await expect(StyleCardPage()).rejects.toThrow('NOT_FOUND');
    expect(state.latest).not.toHaveBeenCalled();
    expect(state.listPending).not.toHaveBeenCalled();
  });
});
