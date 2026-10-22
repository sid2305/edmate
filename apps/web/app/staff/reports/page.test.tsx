// @vitest-environment jsdom
// Task 12.2e: the /staff/reports page. Staff only: the guard runs before any database read, the
// open queue and active takedowns are read for the session's own staff id, and a failed read
// renders the view's fallback (logging only the error's name), never a crash.
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

const state = vi.hoisted(() => ({
  requireRole: vi.fn(),
  listOpenForStaff: vi.fn(),
  listActiveForStaff: vi.fn(),
  seen: [] as unknown[],
}));

vi.mock('../../../src/auth', () => ({
  requireRole: state.requireRole,
  serverDatabase: () => ({
    repos: {
      reports: { listOpenForStaff: state.listOpenForStaff },
      takedowns: { listActiveForStaff: state.listActiveForStaff },
    },
  }),
}));
vi.mock('../../home/actions', () => ({ signOutAndRedirect: vi.fn() }));
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: keyof typeof messages) => {
    const bundle = messages[namespace] as Record<string, string>;
    return (key: string) => bundle[key];
  },
}));
vi.mock('./view', () => ({
  StaffReportsView: (props: { initialReports: unknown; initialTakedowns: unknown }) => {
    state.seen.push(props);
    return <p>staff reports view</p>;
  },
}));

import StaffReportsPage from './page';

const ROW = {
  id: 'rp_1',
  category: 'harmful',
  status: 'open',
  createdAt: '2026-10-22T00:00:00.000Z',
  messageId: 'msg_1',
  teacherId: 'tch_a',
  agentId: 'agt_1',
  teacherSlug: 'asha-math',
  message: { role: 'agent', text: 'synthetic', createdAt: '2026-10-22T00:00:00.000Z' },
  citedDocuments: [],
};
const TAKEDOWN_ROW = {
  id: 'tkd_1',
  kind: 'document',
  targetId: 'doc_1',
  teacherId: 'tch_a',
  teacherSlug: 'asha-math',
  category: 'copyright',
  createdAt: '2026-10-22T00:00:00.000Z',
};

beforeEach(() => {
  state.requireRole.mockReset();
  state.listOpenForStaff.mockReset();
  state.listActiveForStaff.mockReset();
  state.seen = [];
});

describe('/staff/reports', () => {
  it("asks for staff, then reads the queue and active takedowns for the session's own id", async () => {
    state.requireRole.mockResolvedValueOnce({ userId: 'stf_1', role: 'staff' });
    state.listOpenForStaff.mockResolvedValueOnce([ROW]);
    state.listActiveForStaff.mockResolvedValueOnce([TAKEDOWN_ROW]);
    render(await StaffReportsPage());
    expect(state.requireRole).toHaveBeenCalledWith(['staff']);
    expect(state.listOpenForStaff).toHaveBeenCalledWith('stf_1');
    expect(state.listActiveForStaff).toHaveBeenCalledWith('stf_1');
    expect(state.seen).toEqual([{ initialReports: [ROW], initialTakedowns: [TAKEDOWN_ROW] }]);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Reports and takedowns');
  });

  it('reads nothing when the guard refuses (signed out, student or teacher)', async () => {
    state.requireRole.mockRejectedValueOnce(new Error('NEXT_NOT_FOUND'));
    await expect(StaffReportsPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(state.listOpenForStaff).not.toHaveBeenCalled();
    expect(state.listActiveForStaff).not.toHaveBeenCalled();
  });

  it('a failed queue read renders the fallback (null) and logs only the error name', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    state.requireRole.mockResolvedValueOnce({ userId: 'stf_1', role: 'staff' });
    state.listOpenForStaff.mockRejectedValueOnce(new TypeError('person@example.test'));
    state.listActiveForStaff.mockResolvedValueOnce([]);
    render(await StaffReportsPage());
    expect(state.seen).toEqual([{ initialReports: null, initialTakedowns: [] }]);
    expect(spy).toHaveBeenCalledWith('[staff] reports page queue read failed: TypeError');
    spy.mockRestore();
  });

  it('a failed takedowns read renders the fallback (null) and logs only the error name', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    state.requireRole.mockResolvedValueOnce({ userId: 'stf_1', role: 'staff' });
    state.listOpenForStaff.mockResolvedValueOnce([]);
    state.listActiveForStaff.mockRejectedValueOnce(new TypeError('boom'));
    render(await StaffReportsPage());
    expect(state.seen).toEqual([{ initialReports: [], initialTakedowns: null }]);
    expect(spy).toHaveBeenCalledWith('[staff] reports page takedowns read failed: TypeError');
    spy.mockRestore();
  });
});
