// Task 8.9 Phase C: the /teacher/questions page load. The guard runs before any database read;
// groups and modules are read in the signed-in teacher's own scope (never a request field).
import type { TeacherScope } from '@edmate/db';
import { describe, expect, it, vi } from 'vitest';
import { loadQuestions, type QuestionsPageRepos } from './loadQuestions';

function setup(opts: { outline?: null } = {}) {
  const repos = {
    teacherQuestions: {
      listGroupsForTeacher: vi.fn(async (_s: TeacherScope, _o: { limit: number }) => [
        {
          groupId: 'grp_1',
          count: 2,
          oldestAt: '2026-10-20T00:00:00.000Z',
          questions: [
            { id: 'q_1', text: 'What is a fraction?', createdAt: '2026-10-20T00:00:00.000Z' },
            { id: 'q_2', text: 'What is a fraction exactly?', createdAt: '2026-10-21T00:00:00.000Z' },
          ],
        },
      ]),
    },
    outline: {
      getOutline: vi.fn(async (_s: TeacherScope) =>
        opts.outline === undefined
          ? {
              courseId: 'crs_1',
              outlineVersion: 1,
              modules: [{ id: 'mod_1', title: 'Fractions', order: 1, topics: [] }],
            }
          : opts.outline,
      ),
    },
  } satisfies QuestionsPageRepos;
  const opened = vi.fn(() => repos);
  const deps = {
    requireTeacher: vi.fn(async () => ({ userId: 'tch_a', role: 'teacher' as const })),
    repos: opened,
  };
  return { repos, deps, opened };
}

describe('loadQuestions', () => {
  it("loads the signed-in teacher's open groups and their modules", async () => {
    const { deps, repos } = setup();
    await expect(loadQuestions(deps)).resolves.toEqual({
      groups: [
        {
          groupId: 'grp_1',
          count: 2,
          oldestAt: '2026-10-20T00:00:00.000Z',
          questions: [
            { id: 'q_1', text: 'What is a fraction?', createdAt: '2026-10-20T00:00:00.000Z' },
            { id: 'q_2', text: 'What is a fraction exactly?', createdAt: '2026-10-21T00:00:00.000Z' },
          ],
        },
      ],
      modules: [{ id: 'mod_1', title: 'Fractions' }],
    });
    expect(repos.teacherQuestions.listGroupsForTeacher).toHaveBeenCalledWith(
      { teacherId: 'tch_a' },
      { limit: expect.any(Number) },
    );
    expect(repos.outline.getOutline).toHaveBeenCalledWith({ teacherId: 'tch_a' });
  });

  it('a teacher with no outline yet gets no modules', async () => {
    const { deps } = setup({ outline: null });
    await expect(loadQuestions(deps)).resolves.toMatchObject({ modules: [] });
  });

  it('opens nothing when the guard refuses', async () => {
    const { deps, opened } = setup();
    deps.requireTeacher.mockRejectedValueOnce(new Error('REDIRECT'));
    await expect(loadQuestions(deps)).rejects.toThrow('REDIRECT');
    expect(opened).not.toHaveBeenCalled();
  });
});
