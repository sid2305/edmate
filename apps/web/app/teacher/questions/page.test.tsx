// @vitest-environment jsdom
// Task 8.9 Phase C: the /teacher/questions page. Teachers only, the guard runs before any
// database read, and the groups/modules come from the signed-in teacher's own scope.
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

const state = vi.hoisted(() => ({
  requireRole: vi.fn(),
  listGroupsForTeacher: vi.fn(async () => []),
  getOutline: vi.fn(async () => ({ modules: [{ id: 'mod_1', title: 'Fractions' }] })),
  seen: [] as unknown[],
}));

vi.mock('../../../src/auth', () => ({
  requireRole: state.requireRole,
  serverDatabase: () => ({
    repos: {
      teacherQuestions: { listGroupsForTeacher: state.listGroupsForTeacher },
      outline: { getOutline: state.getOutline },
    },
  }),
  TEACHER_PATH: '/teacher',
}));
vi.mock('../actions', () => ({ signOutAndRedirect: vi.fn() }));
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: keyof typeof messages) => {
    const bundle = messages[namespace] as Record<string, string>;
    return (key: string) => bundle[key];
  },
}));
vi.mock('../../../src/studio/questions/QuestionsInboxView', () => ({
  QuestionsInboxView: (props: { groups: unknown[]; modules: unknown[] }) => {
    state.seen.push(props);
    return <p>questions inbox view</p>;
  },
}));

import QuestionsPage from './page';

beforeEach(() => {
  state.requireRole.mockReset();
  state.listGroupsForTeacher.mockClear();
  state.getOutline.mockClear();
  state.seen = [];
});

describe('/teacher/questions', () => {
  it("asks for a teacher, then reads only that teacher's groups and modules", async () => {
    state.requireRole.mockResolvedValueOnce({ userId: 'tch_a', role: 'teacher' });
    render(await QuestionsPage());
    expect(state.requireRole).toHaveBeenCalledWith(['teacher']);
    expect(state.listGroupsForTeacher).toHaveBeenCalledWith(
      { teacherId: 'tch_a' },
      { limit: expect.any(Number) },
    );
    expect(state.getOutline).toHaveBeenCalledWith({ teacherId: 'tch_a' });
    expect(state.seen).toEqual([{ groups: [], modules: [{ id: 'mod_1', title: 'Fractions' }] }]);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Questions inbox');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Questions' })).toHaveAttribute(
      'href',
      '/teacher/questions',
    );
  });

  it('reads nothing when the guard refuses', async () => {
    state.requireRole.mockRejectedValueOnce(new Error('NOT_FOUND'));
    await expect(QuestionsPage()).rejects.toThrow('NOT_FOUND');
    expect(state.listGroupsForTeacher).not.toHaveBeenCalled();
    expect(state.getOutline).not.toHaveBeenCalled();
  });
});
