// Task 9.4 Phase C: the /home chat links. Task 9.3b: one shared scan, classified once.
//
// Task 9.4a Phase C: the chat and paused links come from the student's own subscriptions
// (`subscriptions.listLiveForStudent`, one query across every teacher), not from the configured
// candidates. `EDMATE_CHAT_AGENTS` (and the dev `demo-agent` default) now only feeds the
// "start a package" (startable) list, minus any agent the student already has a live
// subscription to.
import { describe, expect, it, vi } from 'vitest';
import type { Principal } from '../auth/guard';
import {
  chatAgentCandidates,
  classifyHomeLinks,
  homeLinks,
  type LiveChat,
  type LiveChatDeps,
  type UnavailableChat,
} from './liveChats';

const STUDENT: Principal = { userId: 'stu_1', role: 'student' };

const OWNERS: Record<string, string> = { agt_a: 'tch_a', agt_b: 'tch_b', agt_c: 'tch_c' };

/** `live` and `unavailable` are keyed by student id, as the real queries are: one student never
 * sees another's rows. */
function deps(
  live: Record<string, LiveChat[]>,
  unavailable: Record<string, UnavailableChat[]> = {},
): LiveChatDeps {
  return {
    agents: {
      owner: vi.fn(async ({ agentId }: { agentId: string }) => {
        const teacherId = OWNERS[agentId];
        return teacherId === undefined ? null : { teacherId };
      }),
    },
    subscriptions: {
      listLiveForStudent: vi.fn(async (studentId: string) => live[studentId] ?? []),
      listUnavailableForStudent: vi.fn(async (studentId: string) => unavailable[studentId] ?? []),
    },
  };
}

const row = (agentId: string, status: string): LiveChat => ({
  agentId,
  teacherId: OWNERS[agentId] ?? 'tch_x',
  status,
});

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

describe('classifyHomeLinks', () => {
  it.each(['trial', 'active', 'past_due'])('%s is a chat link', (status) => {
    expect(classifyHomeLinks([row('agt_a', status)])).toEqual({ chats: ['agt_a'], paused: [] });
  });

  it('paused is its own list, not chat', () => {
    expect(classifyHomeLinks([row('agt_a', 'paused')])).toEqual({ chats: [], paused: ['agt_a'] });
  });

  it('an ended row (never returned by the real query) is in neither list', () => {
    expect(classifyHomeLinks([row('agt_a', 'ended')])).toEqual({ chats: [], paused: [] });
  });

  it('splits a mixed list, keeping its order', () => {
    expect(
      classifyHomeLinks([row('agt_a', 'active'), row('agt_b', 'paused'), row('agt_c', 'trial')]),
    ).toEqual({ chats: ['agt_a', 'agt_c'], paused: ['agt_b'] });
  });

  it('an empty list gives no links', () => {
    expect(classifyHomeLinks([])).toEqual({ chats: [], paused: [] });
  });
});

describe('homeLinks', () => {
  it("chat and paused links come from the student's own subscriptions, not the candidates", async () => {
    const d = deps({
      stu_1: [row('agt_a', 'active'), row('agt_b', 'paused')],
      stu_2: [row('agt_c', 'active')],
    });
    const links = await homeLinks(() => d, STUDENT, [], { error: vi.fn() });
    expect(links).toEqual({
      chats: ['agt_a'],
      paused: ['agt_b'],
      startable: [],
      teacherIds: ['tch_a', 'tch_b'],
      unavailable: [],
    });
    // Keyed by the signed-in principal's own id, once.
    expect(d.subscriptions.listLiveForStudent).toHaveBeenCalledTimes(1);
    expect(d.subscriptions.listLiveForStudent).toHaveBeenCalledWith('stu_1');
    expect(d.subscriptions.listUnavailableForStudent).toHaveBeenCalledTimes(1);
    expect(d.subscriptions.listUnavailableForStudent).toHaveBeenCalledWith('stu_1');
    expect(d.agents.owner).not.toHaveBeenCalled();
  });

  it('a different student gets only their own list', async () => {
    const d = deps({ stu_1: [row('agt_a', 'active')], stu_2: [row('agt_c', 'active')] });
    const links = await homeLinks(() => d, { userId: 'stu_2', role: 'student' }, [], {
      error: vi.fn(),
    });
    expect(links.chats).toEqual(['agt_c']);
    expect(links.teacherIds).toEqual(['tch_c']);
  });

  it('startable is the live candidates the student has no live subscription to', async () => {
    const d = deps({ stu_1: [row('agt_a', 'active'), row('agt_b', 'paused')] });
    const links = await homeLinks(() => d, STUDENT, ['agt_a', 'agt_b', 'agt_c', 'agt_draft'], {
      error: vi.fn(),
    });
    expect(links).toEqual({
      chats: ['agt_a'],
      paused: ['agt_b'],
      // agt_a/agt_b are already live (never double-listed); agt_draft has no live owner.
      startable: ['agt_c'],
      // Startable candidates are not part of the live-classes teacher set.
      teacherIds: ['tch_a', 'tch_b'],
      unavailable: [],
    });
    // Only the candidates not already live are checked for a live agent.
    expect(d.agents.owner).toHaveBeenCalledTimes(2);
    expect(d.agents.owner).not.toHaveBeenCalledWith({ agentId: 'agt_a' });
  });

  it('an ended subscription leaves its agent startable again', async () => {
    const d = deps({ stu_1: [row('agt_a', 'ended')] });
    const links = await homeLinks(() => d, STUDENT, ['agt_a'], { error: vi.fn() });
    expect(links).toEqual({
      chats: [],
      paused: [],
      startable: ['agt_a'],
      teacherIds: [],
      unavailable: [],
    });
  });

  it('dedupes teacher ids across the live list', async () => {
    const d = deps({
      stu_1: [
        { agentId: 'agt_a', teacherId: 'tch_a', status: 'active' },
        { agentId: 'agt_a2', teacherId: 'tch_a', status: 'paused' },
      ],
    });
    const links = await homeLinks(() => d, STUDENT, [], { error: vi.fn() });
    expect(links.teacherIds).toEqual(['tch_a']);
  });

  it('no subscriptions and no candidates gives no links', async () => {
    const links = await homeLinks(() => deps({}), STUDENT, [], { error: vi.fn() });
    expect(links).toEqual({
      chats: [],
      paused: [],
      startable: [],
      teacherIds: [],
      unavailable: [],
    });
  });

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
    expect(links).toEqual({
      chats: [],
      paused: [],
      startable: [],
      teacherIds: [],
      unavailable: [],
    });
    expect(log.error).toHaveBeenCalledWith('home.links_failed', { error: 'RangeError' });
    expect(JSON.stringify(log.error.mock.calls)).not.toContain('connection details');
  });

  it('a failing live-list query gives no links (fails closed), logged by name only', async () => {
    const d = deps({});
    vi.mocked(d.subscriptions.listLiveForStudent).mockRejectedValue(new TypeError('secret sql'));
    const log = { error: vi.fn() };
    expect(await homeLinks(() => d, STUDENT, ['agt_c'], log)).toEqual({
      chats: [],
      paused: [],
      startable: [],
      teacherIds: [],
      unavailable: [],
    });
    expect(log.error).toHaveBeenCalledWith('home.links_failed', { error: 'TypeError' });
    expect(JSON.stringify(log.error.mock.calls)).not.toContain('secret sql');
  });

  // Task 9.3f Phase C / B-49: a subscription whose agent is no longer live shows up as a
  // blame-free "unavailable" line, not as a chat.
  describe('unavailable (task 9.3f Phase C / B-49)', () => {
    it('a subscription whose agent is suspended appears in unavailable, not chats', async () => {
      const d = deps(
        { stu_1: [row('agt_a', 'active')] },
        { stu_1: [{ agentId: 'agt_s', teacherId: 'tch_s' }] },
      );
      const links = await homeLinks(() => d, STUDENT, [], { error: vi.fn() });
      expect(links.chats).toEqual(['agt_a']);
      expect(links.unavailable).toEqual(['agt_s']);
    });

    it('a draft agent (taken back off live) also appears in unavailable', async () => {
      const d = deps({}, { stu_1: [{ agentId: 'agt_d', teacherId: 'tch_d' }] });
      const links = await homeLinks(() => d, STUDENT, [], { error: vi.fn() });
      expect(links.unavailable).toEqual(['agt_d']);
    });

    it('dedupes unavailable agent ids', async () => {
      const d = deps(
        {},
        {
          stu_1: [
            { agentId: 'agt_s', teacherId: 'tch_s' },
            { agentId: 'agt_s', teacherId: 'tch_s' },
          ],
        },
      );
      const links = await homeLinks(() => d, STUDENT, [], { error: vi.fn() });
      expect(links.unavailable).toEqual(['agt_s']);
    });

    it('a different student only sees their own unavailable rows', async () => {
      const d = deps(
        {},
        { stu_1: [{ agentId: 'agt_s', teacherId: 'tch_s' }], stu_2: [] },
      );
      const links = await homeLinks(() => d, { userId: 'stu_2', role: 'student' }, [], {
        error: vi.fn(),
      });
      expect(links.unavailable).toEqual([]);
    });

    it('a failure still returns unavailable: [] (fails closed, one shared catch)', async () => {
      const log = { error: vi.fn() };
      const links = await homeLinks(
        () => {
          throw new RangeError('boom');
        },
        STUDENT,
        [],
        log,
      );
      expect(links.unavailable).toEqual([]);
    });

    it('starts the live and unavailable reads together, before either resolves', async () => {
      const calls: string[] = [];
      let resolveLive!: (rows: LiveChat[]) => void;
      let resolveUnavailable!: (rows: UnavailableChat[]) => void;
      const d: LiveChatDeps = {
        agents: { owner: vi.fn(async () => null) },
        subscriptions: {
          listLiveForStudent: vi.fn(() => {
            calls.push('live.start');
            return new Promise<LiveChat[]>((resolve) => {
              resolveLive = (rows) => {
                calls.push('live.resolve');
                resolve(rows);
              };
            });
          }),
          listUnavailableForStudent: vi.fn(() => {
            calls.push('unavailable.start');
            return new Promise<UnavailableChat[]>((resolve) => {
              resolveUnavailable = (rows) => {
                calls.push('unavailable.resolve');
                resolve(rows);
              };
            });
          }),
        },
      };
      const pending = homeLinks(() => d, STUDENT, [], { error: vi.fn() });
      // Both reads start before either resolves -- neither is gated on the other.
      expect(calls).toEqual(['live.start', 'unavailable.start']);
      resolveUnavailable([{ agentId: 'agt_s', teacherId: 'tch_s' }]);
      resolveLive([row('agt_a', 'active')]);
      const links = await pending;
      expect(links.chats).toEqual(['agt_a']);
      expect(links.unavailable).toEqual(['agt_s']);
    });

    it('a failing unavailable-list query gives no links at all (fails closed, shared catch)', async () => {
      const d = deps({ stu_1: [row('agt_a', 'active')] });
      vi.mocked(d.subscriptions.listUnavailableForStudent).mockRejectedValue(
        new TypeError('secret sql'),
      );
      const log = { error: vi.fn() };
      expect(await homeLinks(() => d, STUDENT, [], log)).toEqual({
        chats: [],
        paused: [],
        startable: [],
        teacherIds: [],
        unavailable: [],
      });
      expect(log.error).toHaveBeenCalledWith('home.links_failed', { error: 'TypeError' });
    });
  });
});
