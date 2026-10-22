// @vitest-environment jsdom
// Task 8.7k: the /teacher route reads the scope's own "changed since last publish" flag (never a
// request field) and passes it to TeacherView, same `serverDatabase()`/`requireRole` pattern as
// `insights/page.test.tsx`.
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../messages/en.json';

const state = vi.hoisted(() => ({
  requireRole: vi.fn(),
  changedSinceLastPublish: vi.fn(),
  seenScope: [] as unknown[],
}));

vi.mock('../../src/auth', () => ({
  requireRole: state.requireRole,
  serverDatabase: () => ({
    repos: {
      publish: {
        changedSinceLastPublish: (...args: unknown[]) => {
          state.seenScope.push(args[0]);
          return state.changedSinceLastPublish(...args);
        },
      },
    },
  }),
}));
vi.mock('./actions', () => ({ signOutAndRedirect: vi.fn() }));
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: keyof typeof messages) => {
    const bundle = messages[namespace] as Record<string, string>;
    return (key: string) => bundle[key];
  },
}));

import TeacherPage from './page';

beforeEach(() => {
  state.requireRole.mockReset();
  state.changedSinceLastPublish.mockReset();
  state.seenScope = [];
});

describe('/teacher', () => {
  it("asks for a teacher, then reads only that teacher's changed-since-publish flag", async () => {
    state.requireRole.mockResolvedValueOnce({ userId: 'tch_a', role: 'teacher' });
    state.changedSinceLastPublish.mockResolvedValueOnce(true);
    render(await TeacherPage());
    expect(state.requireRole).toHaveBeenCalledWith(['teacher']);
    expect(state.seenScope).toEqual([{ teacherId: 'tch_a' }]);
    expect(
      screen.getByText("You've made changes since your last publish."),
    ).toBeInTheDocument();
  });

  it('shows no note when nothing has changed since publish', async () => {
    state.requireRole.mockResolvedValueOnce({ userId: 'tch_a', role: 'teacher' });
    state.changedSinceLastPublish.mockResolvedValueOnce(false);
    render(await TeacherPage());
    expect(
      screen.queryByText("You've made changes since your last publish."),
    ).not.toBeInTheDocument();
  });

  it('reads nothing when the guard refuses', async () => {
    state.requireRole.mockRejectedValueOnce(new Error('NOT_FOUND'));
    await expect(TeacherPage()).rejects.toThrow('NOT_FOUND');
    expect(state.changedSinceLastPublish).not.toHaveBeenCalled();
  });
});
