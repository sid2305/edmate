// @vitest-environment jsdom
// Task 11.1b Phase B: the /teacher/live-classes page. Teachers only, the guard runs before any
// database read, and the classes/packages come from the signed-in teacher's own scope.
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

const state = vi.hoisted(() => ({
  requireRole: vi.fn(),
  listForTeacher: vi.fn(async () => []),
  packagesListForTeacher: vi.fn(async () => []),
  listQueueForTeacher: vi.fn(async () => []),
  listGroupsForTeacher: vi.fn(async () => []),
  seen: [] as unknown[],
}));

vi.mock('../../../src/auth', () => ({
  requireRole: state.requireRole,
  serverDatabase: () => ({
    repos: {
      liveClasses: { listForTeacher: state.listForTeacher },
      packages: { listForTeacher: state.packagesListForTeacher },
      classQuestions: { listQueueForTeacher: state.listQueueForTeacher },
      teacherQuestions: { listGroupsForTeacher: state.listGroupsForTeacher },
    },
  }),
}));
vi.mock('../actions', () => ({ signOutAndRedirect: vi.fn() }));
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: keyof typeof messages) => {
    const bundle = messages[namespace] as Record<string, string>;
    return (key: string) => bundle[key];
  },
}));
vi.mock('./LiveClassesView', () => ({
  LiveClassesView: (props: {
    classes: unknown[];
    packages: unknown[];
    studentQueue: unknown[];
    askQueue: unknown[];
  }) => {
    state.seen.push(props);
    return <p>live classes view</p>;
  },
}));

import LiveClassesPage from './page';

beforeEach(() => {
  state.requireRole.mockReset();
  state.listForTeacher.mockClear();
  state.packagesListForTeacher.mockClear();
  state.listQueueForTeacher.mockClear();
  state.listGroupsForTeacher.mockClear();
  state.seen = [];
});

describe('/teacher/live-classes', () => {
  it("asks for a teacher, then reads only that teacher's classes, packages and both question queues (11.2b)", async () => {
    state.requireRole.mockResolvedValueOnce({ userId: 'tch_a', role: 'teacher' });
    render(await LiveClassesPage());
    expect(state.requireRole).toHaveBeenCalledWith(['teacher']);
    expect(state.listForTeacher).toHaveBeenCalledWith({ teacherId: 'tch_a' });
    expect(state.packagesListForTeacher).toHaveBeenCalledWith({ teacherId: 'tch_a' });
    expect(state.listQueueForTeacher).toHaveBeenCalledWith({ teacherId: 'tch_a' });
    expect(state.listGroupsForTeacher).toHaveBeenCalledWith({ teacherId: 'tch_a' }, { limit: 5 });
    expect(state.seen).toEqual([{ classes: [], packages: [], studentQueue: [], askQueue: [] }]);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Live classes');
  });

  it('reads nothing when the guard refuses', async () => {
    state.requireRole.mockRejectedValueOnce(new Error('NOT_FOUND'));
    await expect(LiveClassesPage()).rejects.toThrow('NOT_FOUND');
    expect(state.listForTeacher).not.toHaveBeenCalled();
    expect(state.packagesListForTeacher).not.toHaveBeenCalled();
    expect(state.listQueueForTeacher).not.toHaveBeenCalled();
    expect(state.listGroupsForTeacher).not.toHaveBeenCalled();
  });
});
