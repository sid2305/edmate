// @vitest-environment jsdom
// Task 8.5 Phase C: the /teacher/test-chat/[agentId] page. Teachers only, the guard runs before
// any database read, only the teacher's own agent loads, and an agent with no package to test
// shows a plain message instead of the chat.
import type { TeacherScope } from '@edmate/db';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';

class NotFound extends Error {}

const state = vi.hoisted(() => ({
  requireRole: vi.fn(),
  packages: [] as { packageId: string; name: string }[],
  listForAgent: vi.fn(),
  dbOpened: 0,
  seen: [] as unknown[],
}));

vi.mock('../../../../src/auth', () => ({
  requireRole: state.requireRole,
  serverDatabase: () => {
    state.dbOpened += 1;
    return {
      repos: {
        agents: {
          get: async (scope: TeacherScope, agentId: string) =>
            scope.teacherId === 'tch_a' && agentId === 'agt_a' ? { status: 'draft' } : null,
        },
        packageVersions: { listForAgent: state.listForAgent },
        outline: { getOutline: async () => ({ modules: [{ id: 'mod_1', title: 'Fractions', order: 1 }] }) },
      },
    };
  },
}));
vi.mock('../../actions', () => ({ signOutAndRedirect: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new NotFound();
  },
}));
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: keyof typeof messages) => {
    const bundle = messages[namespace] as Record<string, string>;
    return (key: string) => bundle[key];
  },
}));
vi.mock('../../../../src/studio/testChat/TestChatView', () => ({
  TestChatView: (props: unknown) => {
    state.seen.push(props);
    return <p>test chat view</p>;
  },
}));

import TestChatPage from './page';

const params = (agentId: string) => ({ params: Promise.resolve({ agentId }) });

beforeEach(() => {
  state.requireRole.mockReset();
  state.listForAgent.mockReset();
  state.listForAgent.mockImplementation(async () => state.packages);
  state.packages = [{ packageId: 'pkg_1', name: 'Starter' }];
  state.dbOpened = 0;
  state.seen = [];
});

describe('/teacher/test-chat/[agentId]', () => {
  it("asks for a teacher, then renders the chat on the teacher's own agent's packages", async () => {
    state.requireRole.mockResolvedValueOnce({ userId: 'tch_a', role: 'teacher' });
    render(await TestChatPage(params('agt_a')));
    expect(state.requireRole).toHaveBeenCalledWith(['teacher']);
    expect(state.listForAgent).toHaveBeenCalledWith({ teacherId: 'tch_a' }, 'agt_a');
    expect(state.seen).toEqual([
      { agentId: 'agt_a', packages: [{ packageId: 'pkg_1', name: 'Starter' }], modules: [{ id: 'mod_1', title: 'Fractions' }] },
    ]);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Test chat');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Studio' })).toHaveAttribute('href', '/teacher');
  });

  it('an agent with no package to test shows a plain message and no chat or link', async () => {
    state.packages = [];
    state.requireRole.mockResolvedValueOnce({ userId: 'tch_a', role: 'teacher' });
    render(await TestChatPage(params('agt_a')));
    expect(screen.getByText(/no package to test yet/)).toBeInTheDocument();
    expect(state.seen).toEqual([]);
    expect(within(screen.getByRole('main')).queryByRole('link')).toBeNull();
  });

  it("another teacher's agent is not found", async () => {
    state.requireRole.mockResolvedValueOnce({ userId: 'tch_b', role: 'teacher' });
    await expect(TestChatPage(params('agt_a'))).rejects.toBeInstanceOf(NotFound);
    expect(state.listForAgent).not.toHaveBeenCalled();
  });

  it('reads nothing when the guard refuses', async () => {
    state.requireRole.mockRejectedValueOnce(new Error('NOT_FOUND'));
    await expect(TestChatPage(params('agt_a'))).rejects.toThrow('NOT_FOUND');
    expect(state.dbOpened).toBe(0);
  });
});
