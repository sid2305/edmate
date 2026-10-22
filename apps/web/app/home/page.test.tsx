// @vitest-environment jsdom
// Task 9.3 Phase C: the /home route passes both the chat links (9.4) and the new "start a
// package" links (9.3) through to HomeView, from the same candidate list and the same opened
// repos, so a database failure in either is isolated to its own list (see liveChats.test.ts).
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  requireRole: vi.fn(),
  chatAgentCandidates: vi.fn(),
  homeChatLinks: vi.fn(),
  homeStartLinks: vi.fn(),
  ownerByAgent: {} as Record<string, string | null>,
  listUpcomingForStudent: vi.fn(),
}));

vi.mock('../../src/auth', () => ({
  requireRole: state.requireRole,
  serverDatabase: () => ({
    repos: {
      agents: {
        owner: vi.fn(async ({ agentId }: { agentId: string }) => {
          const teacherId = state.ownerByAgent[agentId];
          return teacherId == null ? null : { teacherId };
        }),
      },
      liveClasses: { listUpcomingForStudent: state.listUpcomingForStudent },
    },
  }),
}));
vi.mock('../../src/turn/runtime', () => ({
  consoleLog: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));
vi.mock('../../src/chat/liveChats', () => ({
  chatAgentCandidates: state.chatAgentCandidates,
  homeChatLinks: state.homeChatLinks,
  homeStartLinks: state.homeStartLinks,
}));
vi.mock('./view', () => ({
  HomeView: vi.fn(
    ({
      chats,
      startable,
      liveClasses,
    }: {
      chats: string[];
      startable: string[];
      liveClasses: { id: string }[];
    }) => (
      <div>
        <span data-testid="chats">{chats.join(',')}</span>
        <span data-testid="startable">{startable.join(',')}</span>
        <span data-testid="liveClasses">{liveClasses.map((lc) => lc.id).join(',')}</span>
      </div>
    ),
  ),
}));

import HomePage from './page';

beforeEach(() => {
  state.requireRole.mockReset();
  state.chatAgentCandidates.mockReset();
  state.homeChatLinks.mockReset();
  state.homeStartLinks.mockReset();
  state.listUpcomingForStudent.mockReset();
  state.ownerByAgent = {};
  state.requireRole.mockResolvedValue({ userId: 'stu_1', role: 'student' });
  state.chatAgentCandidates.mockReturnValue(['agt_a', 'agt_b']);
  state.homeChatLinks.mockResolvedValue(['agt_a']);
  state.homeStartLinks.mockResolvedValue(['agt_b']);
  state.ownerByAgent = { agt_a: 'tch_a', agt_b: 'tch_b' };
  state.listUpcomingForStudent.mockResolvedValue([]);
});

describe('/home page', () => {
  it('passes chats and startable links from the same candidate list to HomeView', async () => {
    render(await HomePage());
    expect(state.homeChatLinks).toHaveBeenCalledWith(
      expect.any(Function),
      { userId: 'stu_1', role: 'student' },
      ['agt_a', 'agt_b'],
      expect.anything(),
    );
    expect(state.homeStartLinks).toHaveBeenCalledWith(
      expect.any(Function),
      { userId: 'stu_1', role: 'student' },
      ['agt_a', 'agt_b'],
      expect.anything(),
    );
    expect(screen.getByTestId('chats')).toHaveTextContent('agt_a');
    expect(screen.getByTestId('startable')).toHaveTextContent('agt_b');
  });

  // Task 11.1c Phase C: upcoming live classes.
  it('loads upcoming live classes per distinct candidate teacher and sorts by start time', async () => {
    state.listUpcomingForStudent.mockImplementation(async (scope: { teacherId: string }) => {
      if (scope.teacherId === 'tch_a') {
        return [{ id: 'lc_2', title: 'B', link: null, startsAt: '2099-01-02T00:00:00.000Z', window: 'later' }];
      }
      return [{ id: 'lc_1', title: 'A', link: null, startsAt: '2099-01-01T00:00:00.000Z', window: 'later' }];
    });
    render(await HomePage());
    expect(state.listUpcomingForStudent).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('liveClasses')).toHaveTextContent('lc_1,lc_2');
  });

  it('a live-classes failure logs and shows none, without affecting chats/startable', async () => {
    state.listUpcomingForStudent.mockRejectedValue(new Error('boom'));
    render(await HomePage());
    expect(screen.getByTestId('liveClasses')).toHaveTextContent('');
    expect(screen.getByTestId('chats')).toHaveTextContent('agt_a');
  });

  it('with no candidates, live classes are never queried', async () => {
    state.chatAgentCandidates.mockReturnValue([]);
    state.homeChatLinks.mockResolvedValue([]);
    state.homeStartLinks.mockResolvedValue([]);
    render(await HomePage());
    expect(state.listUpcomingForStudent).not.toHaveBeenCalled();
    expect(screen.getByTestId('liveClasses')).toHaveTextContent('');
  });
});
