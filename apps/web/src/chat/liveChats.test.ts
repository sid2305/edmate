// Task 9.4 Phase C: the /home chat links. There is no repository method that lists a student's
// subscriptions yet, so the candidates are the configured agents (EDMATE_CHAT_AGENTS; the seeded
// `demo-agent` outside production) and each one is checked: live agent, and a live, unpaused
// subscription with its teacher.
//
// Task 9.3b: `homeCandidateScan`/`classifyHomeLinks`/`homeLinks` replace the three separate
// `liveChatAgents`/`pausedAgents`/`startableAgents` + `homeChatLinks`/`homePausedLinks`/
// `homeStartLinks` scans -- one shared scan, classified once.
import type { StudentScope } from '@edmate/db';
import { describe, expect, it, vi } from 'vitest';
import type { Principal } from '../auth/guard';
import {
  chatAgentCandidates,
  classifyHomeLinks,
  homeCandidateScan,
  homeLinks,
  type HomeCandidate,
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

describe('homeCandidateScan', () => {
  it('resolves owner and status once per candidate, dropping an unknown/draft agent', async () => {
    const d = deps({ 'stu_1:tch_a': 'active', 'stu_1:tch_b': 'paused' });
    const rows = await homeCandidateScan(d, STUDENT, ['agt_a', 'agt_b', 'agt_draft']);
    expect(rows).toEqual([
      { agentId: 'agt_a', teacherId: 'tch_a', status: 'active' },
      { agentId: 'agt_b', teacherId: 'tch_b', status: 'paused' },
    ]);
    // One owner call per candidate (including the dropped draft), one findLive call per
    // resolved owner only -- never repeated.
    expect(d.agents.owner).toHaveBeenCalledTimes(3);
    expect(d.subscriptions.findLive).toHaveBeenCalledTimes(2);
  });

  it('never subscribed is status null', async () => {
    const rows = await homeCandidateScan(deps({}), STUDENT, ['agt_a']);
    expect(rows).toEqual([{ agentId: 'agt_a', teacherId: 'tch_a', status: null }]);
  });
});

describe('classifyHomeLinks', () => {
  const row = (agentId: string, teacherId: string, status: string | null): HomeCandidate => ({
    agentId,
    teacherId,
    status,
  });

  it.each(['trial', 'active', 'past_due'])('%s is a chat link', (status) => {
    expect(classifyHomeLinks([row('agt_a', 'tch_a', status)])).toEqual({
      chats: ['agt_a'],
      paused: [],
      startable: [],
    });
  });

  it('paused is its own list, not chat nor startable', () => {
    expect(classifyHomeLinks([row('agt_a', 'tch_a', 'paused')])).toEqual({
      chats: [],
      paused: ['agt_a'],
      startable: [],
    });
  });

  it.each([null, 'ended'])('%s is startable', (status) => {
    expect(classifyHomeLinks([row('agt_a', 'tch_a', status)])).toEqual({
      chats: [],
      paused: [],
      startable: ['agt_a'],
    });
  });

  it('splits a mixed set into all three lists', () => {
    expect(
      classifyHomeLinks([
        row('agt_a', 'tch_a', 'active'),
        row('agt_b', 'tch_b', 'paused'),
        row('agt_c', 'tch_c', null),
      ]),
    ).toEqual({ chats: ['agt_a'], paused: ['agt_b'], startable: ['agt_c'] });
  });
});

describe('homeLinks', () => {
  it('a database failure gives no links and logs the error name only', async () => {
    const log = { error: vi.fn() };
    const links = await homeLinks(
      () => {
        throw new RangeError('connection details that must not be logged');
      },
      STUDENT,
      ['agt_a'],
      log,
    );
    expect(links).toEqual({ chats: [], paused: [], startable: [], teacherIds: [] });
    expect(log.error).toHaveBeenCalledWith('home.links_failed', { error: 'RangeError' });
    expect(JSON.stringify(log.error.mock.calls)).not.toContain('connection details');
  });

  it('no candidates opens nothing', async () => {
    const open = vi.fn();
    expect(await homeLinks(open, STUDENT, [], { error: vi.fn() })).toEqual({
      chats: [],
      paused: [],
      startable: [],
      teacherIds: [],
    });
    expect(open).not.toHaveBeenCalled();
  });

  it('classifies the scan and dedupes teacher ids, from one owner/findLive pass each', async () => {
    const d = deps({ 'stu_1:tch_a': 'active', 'stu_1:tch_b': 'paused', 'stu_1:tch_c': 'ended' });
    const links = await homeLinks(() => d, STUDENT, ['agt_a', 'agt_b', 'agt_c'], { error: vi.fn() });
    expect(links).toEqual({
      chats: ['agt_a'],
      paused: ['agt_b'],
      startable: ['agt_c'],
      teacherIds: ['tch_a', 'tch_b', 'tch_c'],
    });
    expect(d.agents.owner).toHaveBeenCalledTimes(3);
    expect(d.subscriptions.findLive).toHaveBeenCalledTimes(3);
  });
});
