// Task 9.4 Phase C: the /home chat links. There is no repository method that lists a student's
// subscriptions yet, so the candidates are the configured agents (EDMATE_CHAT_AGENTS; the seeded
// `demo-agent` outside production) and each one is checked: live agent, and a live, unpaused
// subscription with its teacher.
import type { StudentScope } from '@edmate/db';
import { describe, expect, it, vi } from 'vitest';
import type { Principal } from '../auth/guard';
import {
  chatAgentCandidates,
  homeChatLinks,
  homeStartLinks,
  liveChatAgents,
  startableAgents,
  type LiveChatDeps,
} from './liveChats';

const STUDENT: Principal = { userId: 'stu_1', role: 'student' };

function deps(subs: Record<string, string>): LiveChatDeps {
  const owners: Record<string, string> = { agt_a: 'tch_a', agt_b: 'tch_b', agt_c: 'tch_c' };
  return {
    agents: {
      owner: vi.fn(async ({ agentId }: { agentId: string }) => {
        const teacherId = owners[agentId];
        return teacherId === undefined ? null : { teacherId };
      }),
    },
    subscriptions: {
      findLive: vi.fn(async (scope: StudentScope) => {
        const status = subs[`${scope.studentId}:${scope.teacherId}`];
        return status === undefined ? null : { status };
      }),
    },
  };
}

describe('chatAgentCandidates', () => {
  it('reads a comma list, trimmed, deduplicated, ids only', () => {
    expect(chatAgentCandidates({ EDMATE_CHAT_AGENTS: ' agt_a, agt_b ,,agt_a, bad id ' })).toEqual([
      'agt_a',
      'agt_b',
    ]);
  });

  it('defaults to the seeded demo agent outside production, none in production', () => {
    expect(chatAgentCandidates({})).toEqual(['demo-agent']);
    expect(chatAgentCandidates({ NODE_ENV: 'development' })).toEqual(['demo-agent']);
    expect(chatAgentCandidates({ NODE_ENV: 'production' })).toEqual([]);
    expect(chatAgentCandidates({ NODE_ENV: 'production', EDMATE_CHAT_AGENTS: 'agt_a' })).toEqual(['agt_a']);
  });
});

describe('liveChatAgents', () => {
  it('keeps agents with a live, unpaused subscription for this student', async () => {
    const d = deps({ 'stu_1:tch_a': 'active', 'stu_1:tch_b': 'paused', 'stu_2:tch_c': 'trial' });
    expect(await liveChatAgents(d, STUDENT, ['agt_a', 'agt_b', 'agt_c', 'agt_draft'])).toEqual(['agt_a']);
  });

  it.each(['trial', 'active', 'past_due'])('%s counts as live', async (status) => {
    const d = deps({ 'stu_1:tch_a': status });
    expect(await liveChatAgents(d, STUDENT, ['agt_a'])).toEqual(['agt_a']);
  });

  it('an ended subscription gives no link', async () => {
    expect(await liveChatAgents(deps({ 'stu_1:tch_a': 'ended' }), STUDENT, ['agt_a'])).toEqual([]);
  });
});

describe('homeChatLinks', () => {
  it('a database failure gives no links and logs the error name only', async () => {
    const log = { error: vi.fn() };
    const links = await homeChatLinks(
      () => {
        throw new RangeError('connection details that must not be logged');
      },
      STUDENT,
      ['agt_a'],
      log,
    );
    expect(links).toEqual([]);
    expect(log.error).toHaveBeenCalledWith('home.chat_links_failed', { error: 'RangeError' });
    expect(JSON.stringify(log.error.mock.calls)).not.toContain('connection details');
  });

  it('no candidates opens nothing', async () => {
    const open = vi.fn();
    expect(await homeChatLinks(open, STUDENT, [], { error: vi.fn() })).toEqual([]);
    expect(open).not.toHaveBeenCalled();
  });

  it('returns the live ones', async () => {
    const d = deps({ 'stu_1:tch_a': 'active' });
    expect(await homeChatLinks(() => d, STUDENT, ['agt_a', 'agt_b'], { error: vi.fn() })).toEqual(['agt_a']);
  });
});

describe('startableAgents', () => {
  it('offers a start link for a live agent never subscribed to, or whose subscription ended', async () => {
    const d = deps({ 'stu_1:tch_b': 'ended' });
    expect(await startableAgents(d, STUDENT, ['agt_a', 'agt_b', 'agt_draft'])).toEqual(['agt_a', 'agt_b']);
  });

  it.each(['trial', 'active', 'past_due', 'paused'])(
    'a %s subscription has no start link (paused is neither chat nor start -- 9.6)',
    async (status) => {
      const d = deps({ 'stu_1:tch_a': status });
      expect(await startableAgents(d, STUDENT, ['agt_a'])).toEqual([]);
    },
  );
});

describe('homeStartLinks', () => {
  it('a database failure gives no links and logs the error name only', async () => {
    const log = { error: vi.fn() };
    const links = await homeStartLinks(
      () => {
        throw new RangeError('connection details that must not be logged');
      },
      STUDENT,
      ['agt_a'],
      log,
    );
    expect(links).toEqual([]);
    expect(log.error).toHaveBeenCalledWith('home.start_links_failed', { error: 'RangeError' });
    expect(JSON.stringify(log.error.mock.calls)).not.toContain('connection details');
  });

  it('no candidates opens nothing', async () => {
    const open = vi.fn();
    expect(await homeStartLinks(open, STUDENT, [], { error: vi.fn() })).toEqual([]);
    expect(open).not.toHaveBeenCalled();
  });

  it('returns the startable ones', async () => {
    const d = deps({ 'stu_1:tch_a': 'active' });
    expect(await homeStartLinks(() => d, STUDENT, ['agt_a', 'agt_b'], { error: vi.fn() })).toEqual(['agt_b']);
  });
});
