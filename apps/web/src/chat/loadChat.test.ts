// Task 9.4 Phase C: what the /learn/[agentId] page loads. The student comes from the guard; a
// non-live agent is not found; `?s=` is used only when it is the student's own open session with
// this agent (another student's or an ended one starts empty).
import type { Message } from '@edmate/contracts';
import type { StudentScope } from '@edmate/db';
import { describe, expect, it, vi } from 'vitest';
import type { Principal } from '../auth/guard';
import { HISTORY_LIMIT, loadChat, type ChatPageDeps, type ChatRepos } from './loadChat';

const STUDENT: Principal = { userId: 'stu_1', role: 'student' };

class NotFound extends Error {}

const HISTORY: Message[] = [
  { id: 'msg_1', role: 'student', text: 'Hi', createdAt: '2026-10-20T10:00:00.000Z' },
  {
    id: 'msg_2',
    role: 'agent',
    text: 'Hello.',
    createdAt: '2026-10-20T10:00:01.000Z',
    sources: [{ title: 'Notes', locator: 'p. 1', kind: 'material' }],
  },
  { id: 'msg_3', role: 'teacher', text: 'See you Friday.', createdAt: '2026-10-20T10:00:02.000Z' },
];

function deps(over: Partial<ChatRepos> = {}) {
  const sessions: Record<string, { studentId: string; agentId: string; endedAt: string | null }> = {
    ses_own: { studentId: 'stu_1', agentId: 'agt_a', endedAt: null },
    ses_other_student: { studentId: 'stu_2', agentId: 'agt_a', endedAt: null },
    ses_other_agent: { studentId: 'stu_1', agentId: 'agt_b', endedAt: null },
    ses_ended: { studentId: 'stu_1', agentId: 'agt_a', endedAt: '2026-10-19T10:00:00.000Z' },
  };
  const repos: ChatRepos = {
    agents: {
      owner: vi.fn(async ({ agentId }: { agentId: string }) =>
        agentId === 'agt_a' || agentId === 'agt_b' ? { teacherId: 'tch_a' } : null,
      ),
    },
    sessions: {
      get: vi.fn(async (scope: StudentScope, id: string) => {
        const s = sessions[id];
        return s !== undefined && s.studentId === scope.studentId ? s : null;
      }),
    },
    messages: { history: vi.fn(async () => HISTORY) },
    ...over,
  };
  const d: ChatPageDeps = {
    requireStudent: vi.fn(async () => STUDENT),
    repos: vi.fn(() => repos),
    notFound: () => {
      throw new NotFound();
    },
  };
  return { d, repos };
}

describe('loadChat', () => {
  it('loads the own open session history, mapped for the view', async () => {
    const { d, repos } = deps();
    const data = await loadChat(d, 'agt_a', 'ses_own');
    expect(data.agentId).toBe('agt_a');
    expect(data.sessionId).toBe('ses_own');
    expect(repos.messages.history).toHaveBeenCalledWith(
      expect.objectContaining({ studentId: 'stu_1', teacherId: 'tch_a' }),
      'ses_own',
      HISTORY_LIMIT,
    );
    expect(data.history).toEqual([
      { id: 'msg_1', role: 'student', text: 'Hi' },
      { id: 'msg_2', role: 'agent', text: 'Hello.', sources: [{ title: 'Notes', locator: 'p. 1', kind: 'material' }] },
      { id: 'msg_3', role: 'teacher', text: 'See you Friday.' },
    ]);
  });

  it.each(['ses_other_student', 'ses_other_agent', 'ses_ended', 'ses_missing'])(
    '%s is ignored: the chat starts empty with no session',
    async (s) => {
      const { d, repos } = deps();
      const data = await loadChat(d, 'agt_a', s);
      expect(data).toEqual({ agentId: 'agt_a', sessionId: null, history: [] });
      expect(repos.messages.history).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, '', ['ses_own', 'ses_x'], 'bad id with spaces'])(
    'a missing or malformed ?s= (%s) starts empty without a lookup',
    async (s) => {
      const { d, repos } = deps();
      const data = await loadChat(d, 'agt_a', s);
      expect(data.sessionId).toBeNull();
      expect(repos.sessions.get).not.toHaveBeenCalled();
    },
  );

  it('a non-live or unknown agent is not found', async () => {
    const { d } = deps();
    await expect(loadChat(d, 'agt_draft', undefined)).rejects.toBeInstanceOf(NotFound);
  });

  it('a malformed agent id is not found without a lookup', async () => {
    const { d, repos } = deps();
    await expect(loadChat(d, 'bad id/../x', undefined)).rejects.toBeInstanceOf(NotFound);
    expect(repos.agents.owner).not.toHaveBeenCalled();
  });

  it('checks the student first; a refused student never reaches the database', async () => {
    const { d } = deps();
    d.requireStudent = vi.fn(async () => {
      throw new Error('redirect');
    });
    await expect(loadChat(d, 'agt_a', 'ses_own')).rejects.toThrow('redirect');
    expect(d.repos).not.toHaveBeenCalled();
  });
});
