// @vitest-environment jsdom
// Task 12.1b: the /staff page. Staff only: the guard runs before any database read, the queue is
// read for the session's own staff id, and a failed read renders the fallback view (logging only
// the error's name), never a crash or raw error text.
//
// Task 12.5c: the safety-alert count banner. A failed count read hides the banner (logging only
// the error's name) and never blocks the verification queue.
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../messages/en.json';

const state = vi.hoisted(() => ({
  requireRole: vi.fn(),
  listPendingForStaff: vi.fn(),
  listAlertsForStaff: vi.fn(),
  listActiveForStaff: vi.fn(),
  findLastVerifyForStaff: vi.fn(),
  findSubjectHistoryForStaff: vi.fn(),
  listRepeatInfringersForStaff: vi.fn(),
  seen: [] as unknown[],
}));

vi.mock('../../src/auth', () => ({
  requireRole: state.requireRole,
  serverDatabase: () => ({
    repos: {
      teacherProfiles: { listPendingForStaff: state.listPendingForStaff },
      safetyAlerts: { listForStaff: state.listAlertsForStaff },
      takedowns: { listActiveForStaff: state.listActiveForStaff },
      audit: {
        findLastVerifyForStaff: state.findLastVerifyForStaff,
        findSubjectHistoryForStaff: state.findSubjectHistoryForStaff,
      },
    },
  }),
}));
vi.mock('../api/staff/repeat-infringers/handlers', () => ({
  listRepeatInfringersForStaff: state.listRepeatInfringersForStaff,
}));
vi.mock('../home/actions', () => ({ signOutAndRedirect: vi.fn() }));
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: keyof typeof messages) => {
    const bundle = messages[namespace] as Record<string, string>;
    return (key: string, values?: Record<string, unknown>) =>
      values === undefined
        ? bundle[key]
        : bundle[key]!.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k]));
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

const ALERT_ROW = {
  id: 'alr_1',
  level: 'critical',
  kind: 'distress',
  studentId: 'stu_1',
  teacherId: 'tch_a',
  sessionId: 'ses_1',
  teacherSlug: 'asha-math',
  excerptRedacted: 'synthetic excerpt',
  createdAt: new Date().toISOString(),
  receivedAt: new Date().toISOString(),
  escalatedAt: new Date().toISOString(),
  escalationRound: 1,
  lastPagedAt: new Date().toISOString(),
  acknowledgedAt: null,
  acknowledgedBy: null,
  ackNote: null,
};

beforeEach(() => {
  state.requireRole.mockReset();
  state.listPendingForStaff.mockReset();
  state.listAlertsForStaff.mockReset();
  state.listAlertsForStaff.mockResolvedValue([]);
  state.listActiveForStaff.mockReset();
  state.listActiveForStaff.mockResolvedValue([]);
  state.findLastVerifyForStaff.mockReset();
  state.findLastVerifyForStaff.mockResolvedValue(null);
  state.findSubjectHistoryForStaff.mockReset();
  state.findSubjectHistoryForStaff.mockResolvedValue([]);
  state.listRepeatInfringersForStaff.mockReset();
  state.listRepeatInfringersForStaff.mockResolvedValue([]);
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
          {
            teacherId: 'tch_a',
            slug: 'asha-math',
            subject: 'Math',
            name: 'Asha',
            email: 'asha@example.test',
            activeTakedowns: [],
            lastDecision: null,
            subjectHistory: [],
          },
        ],
      },
    ]);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Teacher verification');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Verification' })).toHaveAttribute(
      'href',
      '/staff',
    );
  });

  it('the SSR initial prop carries active takedowns and the last decision (9.3h)', async () => {
    state.requireRole.mockResolvedValueOnce({ userId: 'stf_1', role: 'staff' });
    state.listPendingForStaff.mockResolvedValueOnce([ROW]);
    state.listActiveForStaff.mockResolvedValueOnce([
      {
        id: 'tkd_1',
        kind: 'document',
        targetId: 'doc_1',
        teacherId: 'tch_a',
        teacherSlug: 'asha-math',
        category: 'other',
        createdAt: '2026-10-20T00:00:00.000Z',
      },
    ]);
    state.findLastVerifyForStaff.mockResolvedValueOnce({
      status: 'rejected',
      reason: 'unsafe advice',
      ts: '2026-10-19T00:00:00.000Z',
    });
    render(await StaffPage());
    expect(state.seen).toEqual([
      {
        initial: [
          {
            teacherId: 'tch_a',
            slug: 'asha-math',
            subject: 'Math',
            name: 'Asha',
            email: 'asha@example.test',
            activeTakedowns: [
              { kind: 'document', category: 'other', createdAt: '2026-10-20T00:00:00.000Z' },
            ],
            lastDecision: { status: 'rejected', ts: '2026-10-19T00:00:00.000Z' },
            subjectHistory: [],
          },
        ],
      },
    ]);
  });

  it('the SSR initial prop carries subject history (9.3m, B-58)', async () => {
    state.requireRole.mockResolvedValueOnce({ userId: 'stf_1', role: 'staff' });
    state.listPendingForStaff.mockResolvedValueOnce([ROW]);
    state.findSubjectHistoryForStaff.mockResolvedValueOnce([
      { from: 'Math', to: 'Physics', ts: '2026-10-20T00:00:00.000Z' },
    ]);
    render(await StaffPage());
    expect(state.seen).toEqual([
      {
        initial: [
          {
            teacherId: 'tch_a',
            slug: 'asha-math',
            subject: 'Math',
            name: 'Asha',
            email: 'asha@example.test',
            activeTakedowns: [],
            lastDecision: null,
            subjectHistory: [{ from: 'Math', to: 'Physics', ts: '2026-10-20T00:00:00.000Z' }],
          },
        ],
      },
    ]);
  });

  it('reads nothing when the guard refuses (signed out, student or teacher)', async () => {
    state.requireRole.mockRejectedValueOnce(new Error('NEXT_NOT_FOUND'));
    await expect(StaffPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(state.listPendingForStaff).not.toHaveBeenCalled();
    expect(state.listAlertsForStaff).not.toHaveBeenCalled();
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

  it('shows the open/escalated alert banner, linking to /staff/alerts', async () => {
    state.requireRole.mockResolvedValueOnce({ userId: 'stf_1', role: 'staff' });
    state.listPendingForStaff.mockResolvedValueOnce([]);
    state.listAlertsForStaff.mockResolvedValueOnce([
      ALERT_ROW,
      { ...ALERT_ROW, id: 'alr_2', escalatedAt: null },
    ]);
    render(await StaffPage());
    expect(state.listAlertsForStaff).toHaveBeenCalledWith('stf_1', { status: 'open', limit: 50 });
    const link = screen.getByRole('link', {
      name: '2 open safety alerts, 1 escalated. Go to the alert inbox.',
    });
    expect(link).toHaveAttribute('href', '/staff/alerts');
  });

  it('no banner when there are no open alerts', async () => {
    state.requireRole.mockResolvedValueOnce({ userId: 'stf_1', role: 'staff' });
    state.listPendingForStaff.mockResolvedValueOnce([]);
    render(await StaffPage());
    expect(screen.queryByRole('link', { name: /safety alert/ })).toBeNull();
  });

  it('a failed alert count read hides the banner and logs only the error name', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    state.requireRole.mockResolvedValueOnce({ userId: 'stf_1', role: 'staff' });
    state.listPendingForStaff.mockResolvedValueOnce([]);
    state.listAlertsForStaff.mockRejectedValueOnce(new TypeError('person@example.test'));
    render(await StaffPage());
    expect(screen.queryByRole('link', { name: /safety alert/ })).toBeNull();
    expect(spy).toHaveBeenCalledWith('[staff] page alert count read failed: TypeError');
    spy.mockRestore();
  });

  it('shows the repeat-infringer banner, linking to /staff/repeat-infringers (12.3d)', async () => {
    state.requireRole.mockResolvedValueOnce({ userId: 'stf_1', role: 'staff' });
    state.listPendingForStaff.mockResolvedValueOnce([]);
    state.listRepeatInfringersForStaff.mockResolvedValueOnce([
      { teacherId: 'tch_a', slug: 'asha-math' },
      { teacherId: 'tch_b', slug: 'ben-physics' },
    ]);
    render(await StaffPage());
    expect(state.listRepeatInfringersForStaff).toHaveBeenCalledWith(expect.anything(), 'stf_1');
    const link = screen.getByRole('link', {
      name: '2 teachers flagged as repeat infringers. Go to the list.',
    });
    expect(link).toHaveAttribute('href', '/staff/repeat-infringers');
  });

  it('no repeat-infringer banner when the count is zero', async () => {
    state.requireRole.mockResolvedValueOnce({ userId: 'stf_1', role: 'staff' });
    state.listPendingForStaff.mockResolvedValueOnce([]);
    render(await StaffPage());
    expect(screen.queryByRole('link', { name: /repeat infringer/ })).toBeNull();
  });

  it('a failed repeat-infringer count read hides the banner and logs only the error name', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    state.requireRole.mockResolvedValueOnce({ userId: 'stf_1', role: 'staff' });
    state.listPendingForStaff.mockResolvedValueOnce([]);
    state.listRepeatInfringersForStaff.mockRejectedValueOnce(new TypeError('person@example.test'));
    render(await StaffPage());
    expect(screen.queryByRole('link', { name: /repeat infringer/ })).toBeNull();
    expect(spy).toHaveBeenCalledWith('[staff] page repeat-infringer count read failed: TypeError');
    spy.mockRestore();
  });
});
