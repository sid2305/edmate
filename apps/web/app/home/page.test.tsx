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
}));

vi.mock('../../src/auth', () => ({
  requireRole: state.requireRole,
  serverDatabase: () => ({ repos: {} }),
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
  HomeView: vi.fn(({ chats, startable }: { chats: string[]; startable: string[] }) => (
    <div>
      <span data-testid="chats">{chats.join(',')}</span>
      <span data-testid="startable">{startable.join(',')}</span>
    </div>
  )),
}));

import HomePage from './page';

beforeEach(() => {
  state.requireRole.mockReset();
  state.chatAgentCandidates.mockReset();
  state.homeChatLinks.mockReset();
  state.homeStartLinks.mockReset();
  state.requireRole.mockResolvedValue({ userId: 'stu_1', role: 'student' });
  state.chatAgentCandidates.mockReturnValue(['agt_a', 'agt_b']);
  state.homeChatLinks.mockResolvedValue(['agt_a']);
  state.homeStartLinks.mockResolvedValue(['agt_b']);
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
});
