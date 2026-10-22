// Task 8.9 Phase B: the questions backend is built lazily from injected repository hooks (no real
// database; rule 4). A failed build is not cached, so the next call retries.
import type { Repositories } from '@edmate/db';
import { describe, expect, it, vi } from 'vitest';
import { createQuestionsRuntime, type QuestionsHooks } from './runtime';

type Repos = Pick<Repositories, 'teacherQuestions' | 'outline'>;

const FAKE_REPOS: Repos = {
  teacherQuestions: { listGroupsForTeacher: vi.fn(), answer: vi.fn(), dismiss: vi.fn() } as never,
  outline: { getOutline: vi.fn() } as never,
};

function hooks(repos: () => Repos = vi.fn(() => FAKE_REPOS)): QuestionsHooks {
  return { repos, log: { error: vi.fn() } };
}

describe('createQuestionsRuntime', () => {
  it('builds the backend once, from the injected repositories', async () => {
    const h = hooks();
    const runtime = createQuestionsRuntime(h);
    const first = await runtime();
    expect(first.teacherQuestions).toBe(FAKE_REPOS.teacherQuestions);
    expect(first.modules).toBe(FAKE_REPOS.outline);
    expect(first.log).toBe(h.log);
    expect(await runtime()).toBe(first);
    expect(h.repos).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed build; the next call retries', async () => {
    const repos = vi
      .fn<() => Repos>()
      .mockImplementationOnce(() => {
        throw new Error('no DATABASE_URL');
      })
      .mockImplementationOnce(() => FAKE_REPOS);
    const h = hooks(repos);
    const runtime = createQuestionsRuntime(h);
    await expect(runtime()).rejects.toThrow('no DATABASE_URL');
    const second = await runtime();
    expect(second.teacherQuestions).toBe(FAKE_REPOS.teacherQuestions);
    expect(repos).toHaveBeenCalledTimes(2);
  });
});
