// @vitest-environment jsdom
// Task 12.1b: the /staff page. Staff only: the guard runs before any database read, the queue is
// read for the session's own staff id, and a failed read renders the fallback view (logging only
// the error's name), never a crash or raw error text.
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../messages/en.json';

const state = vi.hoisted(() => ({
  requireRole: vi.fn(),
  listPendingForStaff: vi.fn(),
  seen: [] as unknown[],
}));

vi.mock('../../src/auth', () => ({
  requireRole: state.requireRole,
  serverDatabase: () => ({
    repos: { teacherProfiles: { listPendingForStaff: state.listPendingForStaff } },
  }),
}));
vi.mock('../home/actions', () => ({ signOutAndRedirect: vi.fn() }));
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: keyof typeof messages) => {
    const bundle = messages[namespace] as Record<string, string>;
    return (key: string) => bundle[key];
  },
}));
vi.mock('./view', () => ({
  StaffQueueView: (props: { initial: unknown }) => {
    state.seen.push(props);
    return <p>staff queue view</p>;
  },
}));

import StaffPage from './page';

const ROW = {
  id: 'tp_1',
  teacherId: 'tch_a',
  slug: 'asha-math',
  subject: 'Math',
  verificationStatus: 'pending',
  name: 'Asha',
  email: 'asha@example.test',
};

beforeEach(() => {
  state.requireRole.mockReset();
  state.listPendingForStaff.mockReset();
  state.seen = [];
});

describe('/staff', () => {
  it("asks for staff, then reads the queue for the session's own id", async () => {
    state.requireRole.mockResolvedValueOnce({ userId: 'stf_1', role: 'staff' });
    state.listPendingForStaff.mockResolvedValueOnce([ROW]);
    render(await StaffPage());
    expect(state.requireRole).toHaveBeenCalledWith(['staff']);
    expect(state.listPendingForStaff).toHaveBeenCalledWith('stf_1');
    expect(state.seen).toEqual([
      {
        initial: [
          { teacherId: 'tch_a', slug: 'asha-math', subject: 'Math', name: 'Asha', email: 'asha@example.test' },
        ],
      },
    ]);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Teacher verification');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Verification' })).toHaveAttribute('href', '/staff');
  });

  it('reads nothing when the guard refuses (signed out, student or teacher)', async () => {
    state.requireRole.mockRejectedValueOnce(new Error('NEXT_NOT_FOUND'));
    await expect(StaffPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(state.listPendingForStaff).not.toHaveBeenCalled();
  });

  it('a failed read renders the fallback (null) and logs only the error name', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    state.requireRole.mockResolvedValueOnce({ userId: 'stf_1', role: 'staff' });
    state.listPendingForStaff.mockRejectedValueOnce(new TypeError('person@example.test'));
    render(await StaffPage());
    expect(state.seen).toEqual([{ initial: null }]);
    expect(spy).toHaveBeenCalledWith('[staff] page queue read failed: TypeError');
    spy.mockRestore();
  });
});
