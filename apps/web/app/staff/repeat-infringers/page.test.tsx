// @vitest-environment jsdom
// Task 12.3d: the /staff/repeat-infringers page. Staff only: the guard runs before any database
// read, the flagged list is read through the same helper the API route uses, and a failed read
// renders the view's fallback (logging only the error's name), never a crash.
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

const state = vi.hoisted(() => ({
  requireRole: vi.fn(),
  listRepeatInfringersForStaff: vi.fn(),
  seen: [] as unknown[],
}));

vi.mock('../../../src/auth', () => ({
  requireRole: state.requireRole,
  serverDatabase: () => ({ repos: {} }),
}));
vi.mock('../../api/staff/repeat-infringers/handlers', () => ({
  listRepeatInfringersForStaff: state.listRepeatInfringersForStaff,
}));
vi.mock('../../home/actions', () => ({ signOutAndRedirect: vi.fn() }));
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: keyof typeof messages) => {
    const bundle = messages[namespace] as Record<string, string>;
    return (key: string) => bundle[key];
  },
}));
vi.mock('./view', () => ({
  StaffRepeatInfringersView: (props: { initial: unknown }) => {
    state.seen.push(props);
    return <p>staff repeat infringers view</p>;
  },
}));

import StaffRepeatInfringersPage from './page';

const TEACHER = {
  teacherId: 'tch_a',
  slug: 'asha-math',
  displayName: 'Asha',
  subject: 'Math',
  name: 'Asha K',
  email: 'asha@example.test',
  activeTakedowns: [],
  lastDecision: null,
  subjectHistory: [],
  verificationStatus: 'verified',
};

beforeEach(() => {
  state.requireRole.mockReset();
  state.listRepeatInfringersForStaff.mockReset();
  state.seen = [];
});

describe('/staff/repeat-infringers', () => {
  it("asks for staff, then reads the flagged list for the session's own id", async () => {
    state.requireRole.mockResolvedValueOnce({ userId: 'stf_1', role: 'staff' });
    state.listRepeatInfringersForStaff.mockResolvedValueOnce([TEACHER]);
    render(await StaffRepeatInfringersPage());
    expect(state.requireRole).toHaveBeenCalledWith(['staff']);
    expect(state.listRepeatInfringersForStaff).toHaveBeenCalledWith({}, 'stf_1');
    expect(state.seen).toEqual([{ initial: [TEACHER] }]);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Repeat infringers');
  });

  it('reads nothing when the guard refuses (signed out, student or teacher)', async () => {
    state.requireRole.mockRejectedValueOnce(new Error('NEXT_NOT_FOUND'));
    await expect(StaffRepeatInfringersPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(state.listRepeatInfringersForStaff).not.toHaveBeenCalled();
  });

  it('a failed read renders the fallback (null) and logs only the error name', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    state.requireRole.mockResolvedValueOnce({ userId: 'stf_1', role: 'staff' });
    state.listRepeatInfringersForStaff.mockRejectedValueOnce(new TypeError('person@example.test'));
    render(await StaffRepeatInfringersPage());
    expect(state.seen).toEqual([{ initial: null }]);
    expect(spy).toHaveBeenCalledWith('[staff] repeat-infringers page read failed: TypeError');
    spy.mockRestore();
  });
});
