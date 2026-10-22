// Task 8.5 Phase C: the test-chat page load. The guard runs before any database read; only the
// signed-in teacher's own agent loads (drafts too); packages and modules are read in that scope.
import type { TeacherScope } from '@edmate/db';
import { describe, expect, it, vi } from 'vitest';
import { loadTestChat, type TestChatRepos } from './loadTestChat';

class NotFound extends Error {}

function setup(opts: { outline?: { modules: { id: string; title: string; order: number }[] } | null } = {}) {
  const repos = {
    agents: {
      get: vi.fn(async (scope: TeacherScope, agentId: string) =>
        scope.teacherId === 'tch_a' && agentId === 'agt_a' ? { status: 'draft' } : null,
      ),
    },
    packageVersions: {
      listForAgent: vi.fn(async (_s: TeacherScope, _a: string) => [{ packageId: 'pkg_1', name: 'Starter' }]),
    },
    outline: {
      getOutline: vi.fn(async (_s: TeacherScope) =>
        opts.outline === undefined ? { modules: [{ id: 'mod_1', title: 'Fractions', order: 1 }] } : opts.outline,
      ),
    },
  } satisfies TestChatRepos;
  const opened = vi.fn(() => repos);
  const deps = {
    requireTeacher: vi.fn(async () => ({ userId: 'tch_a', role: 'teacher' as const })),
    repos: opened,
    notFound: (): never => {
      throw new NotFound();
    },
  };
  return { repos, deps, opened };
}

describe('loadTestChat', () => {
  it("loads the teacher's own (draft) agent with its packages and the teacher's modules", async () => {
    const { deps, repos } = setup();
    await expect(loadTestChat(deps, 'agt_a')).resolves.toEqual({
      agentId: 'agt_a',
      packages: [{ packageId: 'pkg_1', name: 'Starter' }],
      modules: [{ id: 'mod_1', title: 'Fractions' }],
    });
    expect(repos.packageVersions.listForAgent).toHaveBeenCalledWith({ teacherId: 'tch_a' }, 'agt_a');
    expect(repos.outline.getOutline).toHaveBeenCalledWith({ teacherId: 'tch_a' });
  });

  it('a teacher with no outline yet gets no modules', async () => {
    const { deps } = setup({ outline: null });
    await expect(loadTestChat(deps, 'agt_a')).resolves.toMatchObject({ modules: [] });
  });

  it("another teacher's or an unknown agent is not found, and nothing else is read", async () => {
    const { deps, repos } = setup();
    await expect(loadTestChat(deps, 'agt_b')).rejects.toBeInstanceOf(NotFound);
    expect(repos.packageVersions.listForAgent).not.toHaveBeenCalled();
    expect(repos.outline.getOutline).not.toHaveBeenCalled();
  });

  it.each([[''], [42], [undefined], ['x'.repeat(500)]])('a malformed agent id %# is not found before any read', async (raw) => {
    const { deps, opened } = setup();
    await expect(loadTestChat(deps, raw)).rejects.toBeInstanceOf(NotFound);
    expect(opened).not.toHaveBeenCalled();
  });

  it('opens nothing when the guard refuses', async () => {
    const { deps, opened } = setup();
    deps.requireTeacher.mockRejectedValueOnce(new Error('REDIRECT'));
    await expect(loadTestChat(deps, 'agt_a')).rejects.toThrow('REDIRECT');
    expect(opened).not.toHaveBeenCalled();
  });
});
