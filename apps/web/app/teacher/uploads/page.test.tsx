// @vitest-environment jsdom
// Task 8.2 Phase 4: the /teacher/uploads page. Teachers only, the guard runs before any database
// read, and the modules come from the session's teacher (never a request field). 8.2a Phase C:
// the page reads modules.list (id + title), not bare ids, so the picker can show real names.
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

const state = vi.hoisted(() => ({
  requireRole: vi.fn(),
  list: vi.fn(async (_scope: { teacherId: string }) => [{ id: 'mod_a', title: 'Algebra' }]),
  seen: [] as unknown[],
}));

vi.mock('../../../src/auth', () => ({
  requireRole: state.requireRole,
  serverDatabase: () => ({ repos: { modules: { list: state.list } } }),
  TEACHER_PATH: '/teacher',
}));
vi.mock('../actions', () => ({ signOutAndRedirect: vi.fn() }));
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: keyof typeof messages) => {
    const bundle = messages[namespace] as Record<string, string>;
    return (key: string) => bundle[key];
  },
}));
vi.mock('./UploadsView', () => ({
  UploadsView: (props: { modules: { id: string; title: string }[] }) => {
    state.seen.push(props.modules);
    return <p>uploads view</p>;
  },
}));

import UploadsPage from './page';

beforeEach(() => {
  state.requireRole.mockReset();
  state.list.mockClear();
  state.seen = [];
});

describe('/teacher/uploads', () => {
  it("asks for a teacher, then reads only that teacher's modules", async () => {
    state.requireRole.mockResolvedValueOnce({ userId: 'tch_a', role: 'teacher' });
    render(await UploadsPage());
    expect(state.requireRole).toHaveBeenCalledWith(['teacher']);
    expect(state.list).toHaveBeenCalledWith({ teacherId: 'tch_a' });
    expect(state.seen).toEqual([[{ id: 'mod_a', title: 'Algebra' }]]);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Your teaching files');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Studio' })).toHaveAttribute('href', '/teacher');
  });

  it('reads nothing when the guard refuses', async () => {
    state.requireRole.mockRejectedValueOnce(new Error('NOT_FOUND'));
    await expect(UploadsPage()).rejects.toThrow('NOT_FOUND');
    expect(state.list).not.toHaveBeenCalled();
  });
});
