// @vitest-environment jsdom
// Task 12.5c: the /staff/alerts page. Staff only: the guard runs before any database read, the
// open-alert list is read for the session's own staff id, and a failed read renders the view's
// fallback (logging only the error's name), never a crash.
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
  serverDatabase: () => ({ repos: { safetyAlerts: { listForStaff: state.listForStaff } } }),
}));
vi.mock('../../home/actions', () => ({ signOutAndRedirect: vi.fn() }));
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: keyof typeof messages) => {
    const bundle = messages[namespace] as Record<string, string>;
    return (key: string) => bundle[key];
  },
}));
vi.mock('./view', () => ({
  StaffAlertView: (props: { initial: unknown }) => {
    state.seen.push(props);
    return <p>staff alert view</p>;
  },
}));

import StaffAlertsPage from './page';

const ROW = {
  id: 'alr_1',
  level: 'alert',
  kind: 'distress',
  studentId: 'stu_1',
  teacherId: 'tch_a',
  sessionId: 'ses_1',
  teacherSlug: 'asha-math',
  excerptRedacted: 'synthetic excerpt',
  createdAt: new Date().toISOString(),
  receivedAt: new Date().toISOString(),
  escalatedAt: null,
  escalationRound: 0,
  lastPagedAt: null,
  acknowledgedAt: null,
  acknowledgedBy: null,
  ackNote: null,
};

beforeEach(() => {
  state.requireRole.mockReset();
  state.listForStaff.mockReset();
  state.seen = [];
});

describe('/staff/alerts', () => {
  it("asks for staff, then reads the open alerts for the session's own id", async () => {
    state.requireRole.mockResolvedValueOnce({ userId: 'stf_1', role: 'staff' });
    state.listForStaff.mockResolvedValueOnce([ROW]);
    render(await StaffAlertsPage());
    expect(state.requireRole).toHaveBeenCalledWith(['staff']);
    expect(state.listForStaff).toHaveBeenCalledWith('stf_1', { status: 'open', limit: expect.any(Number) });
    expect(state.seen).toHaveLength(1);
    const seen = state.seen[0] as { initial: Array<{ id: string }> };
    expect(seen.initial).toHaveLength(1);
    expect(seen.initial[0]!.id).toBe('alr_1');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Safety alert inbox');
  });

  it('reads nothing when the guard refuses (signed out, student or teacher)', async () => {
    state.requireRole.mockRejectedValueOnce(new Error('NEXT_NOT_FOUND'));
    await expect(StaffAlertsPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(state.listForStaff).not.toHaveBeenCalled();
  });

  it('a failed read renders the fallback (null) and logs only the error name', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    state.requireRole.mockResolvedValueOnce({ userId: 'stf_1', role: 'staff' });
    state.listForStaff.mockRejectedValueOnce(new TypeError('person@example.test'));
    render(await StaffAlertsPage());
    expect(state.seen).toEqual([{ initial: null }]);
    expect(spy).toHaveBeenCalledWith('[staff] alerts page read failed: TypeError');
    spy.mockRestore();
  });
});
