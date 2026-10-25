// @vitest-environment jsdom
// Task 9.3 Phase C: the /home route passes both the chat links (9.4) and the new "start a
// package" links (9.3) through to HomeView, from the same candidate list and the same opened
// repos, so a database failure in either is isolated to its own list (see liveChats.test.ts).
//
// Task 9.3b: `homeChatLinks`/`homeStartLinks`/`homePausedLinks` are replaced by one `homeLinks`
// call (one shared scan, classified into all three lists plus the teacher ids the live-classes
// loader needs); `agents.owner` is no longer called a second time from this page.
// Task 9.4a Phase C: `homeLinks` reads the student's own subscriptions; the candidates only feed
// the startable list.
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  requireRole: vi.fn(),
  chatAgentCandidates: vi.fn(),
  homeLinks: vi.fn(),
  listUpcomingForStudent: vi.fn(),
}));

vi.mock('../../src/auth', () => ({
  requireRole: state.requireRole,
  serverDatabase: () => ({
    repos: {
      liveClasses: { listUpcomingForStudent: state.listUpcomingForStudent },
    },
  }),
}));
vi.mock('../../src/turn/runtime', () => ({
  consoleLog: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));
vi.mock('../../src/chat/liveChats', () => ({
  chatAgentCandidates: state.chatAgentCandidates,
  homeLinks: state.homeLinks,
}));
vi.mock('./view', () => ({
  HomeView: vi.fn(
    ({
      chats,
      startable,
      paused,
      liveClasses,
      unavailable,
    }: {
      chats: string[];
      startable: string[];
      paused: string[];
      liveClasses: { id: string }[];
      unavailable: string[];
    }) => (
      <div>
        <span data-testid="chats">{chats.join(',')}</span>
        <span data-testid="startable">{startable.join(',')}</span>
        <span data-testid="paused">{paused.join(',')}</span>
        <span data-testid="liveClasses">{liveClasses.map((lc) => lc.id).join(',')}</span>
        <span data-testid="unavailable">{unavailable.join(',')}</span>
      </div>
    ),
  ),
}));

import HomePage from './page';

beforeEach(() => {
  state.requireRole.mockReset();
  state.chatAgentCandidates.mockReset();
  state.homeLinks.mockReset();
  state.listUpcomingForStudent.mockReset();
  state.requireRole.mockResolvedValue({ userId: 'stu_1', role: 'student' });
  state.chatAgentCandidates.mockReturnValue(['agt_a', 'agt_b']);
  state.homeLinks.mockResolvedValue({
    chats: ['agt_a'],
    startable: ['agt_b'],
    paused: [],
    teacherIds: ['tch_a', 'tch_b'],
    unavailable: [],
  });
  state.listUpcomingForStudent.mockResolvedValue([]);
});

describe('/home page', () => {
  it('passes chats and startable links from one shared scan to HomeView', async () => {
    render(await HomePage());
    expect(state.homeLinks).toHaveBeenCalledWith(
      expect.any(Function),
      { userId: 'stu_1', role: 'student' },
      ['agt_a', 'agt_b'],
      expect.anything(),
    );
    expect(state.homeLinks).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('chats')).toHaveTextContent('agt_a');
    expect(screen.getByTestId('startable')).toHaveTextContent('agt_b');
  });

  // Task 9.6e: the paused list comes from the same shared scan.
  it('passes the paused links from the same shared scan to HomeView', async () => {
    state.homeLinks.mockResolvedValue({
      chats: [],
      startable: [],
      paused: ['agt_c'],
      teacherIds: [],
      unavailable: [],
    });
    render(await HomePage());
    expect(screen.getByTestId('paused')).toHaveTextContent('agt_c');
  });

  // Task 9.3f Phase C / B-49: the unavailable list comes from the same shared scan.
  it('passes the unavailable links from the same shared scan to HomeView', async () => {
    state.homeLinks.mockResolvedValue({
      chats: [],
      startable: [],
      paused: [],
      teacherIds: [],
      unavailable: ['agt_s'],
    });
    render(await HomePage());
    expect(screen.getByTestId('unavailable')).toHaveTextContent('agt_s');
  });

  // Task 11.1c Phase C: upcoming live classes, by the shared scan's own teacher ids.
  it('loads upcoming live classes per distinct teacher from the shared scan and sorts by start time', async () => {
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

  it('with no live subscriptions (and so no teacher ids), live classes are never queried', async () => {
    state.chatAgentCandidates.mockReturnValue([]);
    state.homeLinks.mockResolvedValue({
      chats: [],
      startable: [],
      paused: [],
      teacherIds: [],
      unavailable: [],
    });
    render(await HomePage());
    expect(state.listUpcomingForStudent).not.toHaveBeenCalled();
    expect(screen.getByTestId('liveClasses')).toHaveTextContent('');
  });
});
