// @vitest-environment jsdom
// Task 12.4d: the /staff/agents page. Staff only: the guard runs before any database read, the
// agent list is read for the session's own staff id, and a failed read renders the view's fallback
// (logging only the error's name), never a crash.
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

const state = vi.hoisted(() => ({
  requireRole: vi.fn(),
  listForStaff: vi.fn(),
  seen: [] as unknown[],
}));

vi.mock('../../../src/auth', () => ({
  requireRole: state.requireRole,
  serverDatabase: () => ({ repos: { regulatedSubjects: { listForStaff: state.listForStaff } } }),
}));
vi.mock('../../home/actions', () => ({ signOutAndRedirect: vi.fn() }));
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: keyof typeof messages) => {
    const bundle = messages[namespace] as Record<string, string>;
    return (key: string) => bundle[key];
  },
}));
vi.mock('./view', () => ({
  StaffAgentsView: (props: { initial: unknown }) => {
    state.seen.push(props);
    return <p>staff agents view</p>;
  },
}));

import StaffAgentsPage from './page';

const ROW = {
  agentId: 'agt_1',
  teacherSlug: 'asha-math',
  status: 'draft',
  liveVersion: null,
  regulatedSubject: null,
  approvedAt: null,
  approvedBy: null,
};

beforeEach(() => {
  state.requireRole.mockReset();
  state.listForStaff.mockReset();
  state.seen = [];
});

describe('/staff/agents', () => {
  it("asks for staff, then reads the agent list for the session's own id", async () => {
    state.requireRole.mockResolvedValueOnce({ userId: 'stf_1', role: 'staff' });
    state.listForStaff.mockResolvedValueOnce([ROW]);
    render(await StaffAgentsPage());
    expect(state.requireRole).toHaveBeenCalledWith(['staff']);
    expect(state.listForStaff).toHaveBeenCalledWith('stf_1');
    expect(state.seen).toHaveLength(1);
    const seen = state.seen[0] as { initial: Array<{ agentId: string }> };
    expect(seen.initial).toHaveLength(1);
    expect(seen.initial[0]!.agentId).toBe('agt_1');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Regulated-subject agents');
  });

  it('reads nothing when the guard refuses (signed out, student or teacher)', async () => {
    state.requireRole.mockRejectedValueOnce(new Error('NEXT_NOT_FOUND'));
    await expect(StaffAgentsPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(state.listForStaff).not.toHaveBeenCalled();
  });

  it('a failed read renders the fallback (null) and logs only the error name', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    state.requireRole.mockResolvedValueOnce({ userId: 'stf_1', role: 'staff' });
    state.listForStaff.mockRejectedValueOnce(new TypeError('person@example.test'));
    render(await StaffAgentsPage());
    expect(state.seen).toEqual([{ initial: null }]);
    expect(spy).toHaveBeenCalledWith('[staff] agents page read failed: TypeError');
    spy.mockRestore();
  });
});
