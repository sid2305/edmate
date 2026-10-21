// @vitest-environment jsdom
// Task 8.2 Phase 4: the /teacher/uploads page. Teachers only, the guard runs before any database
// read, and the module ids come from the session's teacher (never a request field).
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

const state = vi.hoisted(() => ({
  requireRole: vi.fn(),
  ids: vi.fn(async (_scope: { teacherId: string }) => ['mod_a']),
  seen: [] as unknown[],
}));

vi.mock('../../../src/auth', () => ({
  requireRole: state.requireRole,
  serverDatabase: () => ({ repos: { modules: { ids: state.ids } } }),
}));
vi.mock('../actions', () => ({ signOutAndRedirect: vi.fn() }));
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: keyof typeof messages) => {
    const bundle = messages[namespace] as Record<string, string>;
    return (key: string) => bundle[key];
  },
}));
vi.mock('./UploadsView', () => ({
  UploadsView: (props: { moduleIds: string[] }) => {
    state.seen.push(props.moduleIds);
    return <p>uploads view</p>;
  },
}));

import UploadsPage from './page';

beforeEach(() => {
  state.requireRole.mockReset();
  state.ids.mockClear();
  state.seen = [];
});

describe('/teacher/uploads', () => {
  it("asks for a teacher, then reads only that teacher's module ids", async () => {
    state.requireRole.mockResolvedValueOnce({ userId: 'tch_a', role: 'teacher' });
    render(await UploadsPage());
    expect(state.requireRole).toHaveBeenCalledWith(['teacher']);
    expect(state.ids).toHaveBeenCalledWith({ teacherId: 'tch_a' });
    expect(state.seen).toEqual([['mod_a']]);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Your teaching files');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Studio' })).toHaveAttribute('href', '/teacher');
  });

  it('reads nothing when the guard refuses', async () => {
    state.requireRole.mockRejectedValueOnce(new Error('NOT_FOUND'));
    await expect(UploadsPage()).rejects.toThrow('NOT_FOUND');
    expect(state.ids).not.toHaveBeenCalled();
  });
});
