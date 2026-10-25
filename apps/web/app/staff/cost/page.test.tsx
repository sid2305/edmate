// @vitest-environment jsdom
// Task 13.5 Phase B: the /staff/cost page. Staff only: the guard runs before any database read;
// the default 30-day window's join (`loadCostRows`) is read once server-side; a failed read
// renders the view's fallback (null), logging only the error's name, never a crash.
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

const state = vi.hoisted(() => ({
  requireRole: vi.fn(),
  costByPackageSince: vi.fn(),
  activeCountByPackage: vi.fn(),
  listForTeacher: vi.fn(),
  get: vi.fn(),
  seen: [] as unknown[],
}));

vi.mock('../../../src/auth', () => ({
  requireRole: state.requireRole,
  serverDatabase: () => ({
    repos: {
      usageLedger: { costByPackageSince: state.costByPackageSince },
      subscriptions: { activeCountByPackage: state.activeCountByPackage },
      packages: { listForTeacher: state.listForTeacher },
      packageVersions: { get: state.get },
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
  StaffCostView: (props: { initialRows: unknown }) => {
    state.seen.push({ initialRows: props.initialRows });
    return <p>staff cost view</p>;
  },
}));

import StaffCostPage from './page';

beforeEach(() => {
  state.requireRole.mockReset();
  state.costByPackageSince.mockReset();
  state.activeCountByPackage.mockReset();
  state.listForTeacher.mockReset();
  state.get.mockReset();
  state.seen = [];
});

describe('/staff/cost', () => {
  it('asks for staff, then reads the default window and joins by package', async () => {
    state.requireRole.mockResolvedValueOnce({ userId: 'stf_1', role: 'staff' });
    state.costByPackageSince.mockResolvedValueOnce([]);
    state.activeCountByPackage.mockResolvedValueOnce([]);
    render(await StaffCostPage());
    expect(state.requireRole).toHaveBeenCalledWith(['staff']);
    expect(state.costByPackageSince).toHaveBeenCalledTimes(1);
    expect(state.activeCountByPackage).toHaveBeenCalledTimes(1);
    expect(state.seen).toEqual([{ initialRows: [] }]);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('AI cost dashboard');
  });

  it('reads nothing when the guard refuses (signed out, student or teacher)', async () => {
    state.requireRole.mockRejectedValueOnce(new Error('NEXT_NOT_FOUND'));
    await expect(StaffCostPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(state.costByPackageSince).not.toHaveBeenCalled();
  });

  it('a failed read renders the fallback (null) and logs only the error name', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    state.requireRole.mockResolvedValueOnce({ userId: 'stf_1', role: 'staff' });
    state.costByPackageSince.mockRejectedValueOnce(new TypeError('person@example.test'));
    render(await StaffCostPage());
    expect(state.seen).toEqual([{ initialRows: null }]);
    expect(spy).toHaveBeenCalledWith('[staff] cost page read failed: TypeError');
    spy.mockRestore();
  });
});
