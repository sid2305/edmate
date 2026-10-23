// The test chat's composition (task 8.5 Phase B): the student turn's real ports, but a fresh
// `teacher_preview` entitlement store per package, over stub repositories and fake queues.
import type { Repositories } from '@edmate/db';
import { loadBundledPrices } from '@edmate/gateway';
import { createTurnLimits } from '@edmate/harness';
import { describe, expect, it, vi } from 'vitest';
import { systemClock, systemIds } from '../../turn/deps';
import {
  previewEntitlementsFor,
  testChatDepsFor,
  testChatPorts,
  type TestChatProcess,
} from './deps';

function fakeQueue() {
  return { add: async () => undefined };
}

function stubRepos() {
  const calls: { method: string; args: unknown[] }[] = [];
  const repos = {
    agents: {
      get: async (...args: unknown[]) => {
        calls.push({ method: 'agents.get', args });
        return null;
      },
      owner: async (...args: unknown[]) => {
        calls.push({ method: 'agents.owner', args });
        return { teacherId: 'tch_a' };
      },
    },
  } as unknown as Repositories;
  return { repos, calls };
}

function process(repos: Repositories): TestChatProcess {
  const clock = systemClock();
  return {
    repos,
    market: 'global',
    packMarket: () => 'global',
    queues: { meter: fakeQueue(), commit: fakeQueue(), alert: fakeQueue(), safetyEvent: fakeQueue() },
    limits: createTurnLimits(clock),
    // Built eagerly by createRouter; never called here (no model call in tests).
    factories: { anthropic: () => ({ capabilities: {} }) as never },
    prices: loadBundledPrices(),
    promptPacks: { get: () => undefined } as unknown as TestChatProcess['promptPacks'],
    personas: new Map() as TestChatProcess['personas'],
    ...testChatPorts(repos, { locales: () => null }),
    clock,
    ids: systemIds(),
    log: { error: vi.fn() },
  };
}

const scope = { studentId: 'tch_a', teacherId: 'tch_a' } as Parameters<typeof testChatDepsFor>[1];

describe('previewEntitlementsFor', () => {
  it("resolves teacher_preview in the previewing user's own teacher scope", async () => {
    const { repos, calls } = stubRepos();
    const store = previewEntitlementsFor(process(repos), 'pkg_a');
    const got = await store.resolve(
      { studentId: 'tch_a', agentId: 'agt_a', source: 'teacher_preview' },
      '2026-10-22T10:00:00.000Z',
    );
    expect(got).toBeNull();
    expect(calls).toEqual([{ method: 'agents.get', args: [{ teacherId: 'tch_a' }, 'agt_a'] }]);
  });

  it('never resolves a subscription: the age gate answer is "not clear", so nothing is read', async () => {
    const { repos, calls } = stubRepos();
    const store = previewEntitlementsFor(process(repos), 'pkg_a');
    const got = await store.resolve(
      { studentId: 'stu_1', agentId: 'agt_a', source: 'subscription' },
      '2026-10-22T10:00:00.000Z',
    );
    expect(got).toBeNull();
    expect(calls).toEqual([]);
  });
});

describe('testChatDepsFor', () => {
  it('is the student turn deps with a fresh teacher_preview entitlement store', () => {
    const { repos } = stubRepos();
    const p = process(repos);
    const deps = testChatDepsFor(p, scope, 'pkg_a');
    expect(deps.entitlementSource).toBe('teacher_preview');
    expect(deps.turnConfig).toBe(p.turnConfig);
    expect(deps.retrieval).toBe(p.retrieval);
    expect(deps.limits).toBe(p.limits);
    expect(deps.promptPacks).toBe(p.promptPacks);
    expect(deps.personas).toBe(p.personas);
    const again = testChatDepsFor(p, scope, 'pkg_a');
    expect(again.entitlements).not.toBe(deps.entitlements);
  });

  it("binds the package to the entitlement store (the session's package, not the client's)", async () => {
    const { repos, calls } = stubRepos();
    repos.agents.get = (async () => ({ teacherId: 'tch_a' })) as never;
    const latest = vi.fn(async () => null);
    (repos as { packageVersions: unknown }).packageVersions = { latest };
    const deps = testChatDepsFor(process(repos), scope, 'pkg_b');
    await deps.entitlements.resolve(
      { studentId: 'tch_a', agentId: 'agt_a', source: 'teacher_preview' },
      '2026-10-22T10:00:00.000Z',
    );
    expect(latest).toHaveBeenCalledWith({ teacherId: 'tch_a' }, 'pkg_b');
    expect(calls).toEqual([]);
  });

  it('an escalation writes no teacher_questions row: `open` never reaches the repository, and the turn still gets a question id back (8.5b review MEDIUM)', async () => {
    const { repos } = stubRepos();
    // A `teacherQuestions` port that would fail the test if the deps' own store ever delegated to
    // it, standing in for the real `teacherQuestionStoreFor(repos, scope)` this preview must not use.
    const open = vi.fn(async () => {
      throw new Error('must never be called: a preview question must not become a teacher_questions row');
    });
    (repos as { teacherQuestions: unknown }).teacherQuestions = { open };
    const deps = testChatDepsFor(process(repos), scope, 'pkg_a');
    const similar = await deps.teacherQuestions.findSimilar('tch_a', 'What is a fraction?');
    expect(similar).toEqual([]);
    const question = await deps.teacherQuestions.open({
      teacherId: 'tch_a',
      agentId: 'agt_a',
      studentId: 'tch_a',
      text: 'What is a fraction?',
      similarIds: [],
    });
    expect(open).not.toHaveBeenCalled();
    expect(question).toMatchObject({
      teacherId: 'tch_a',
      agentId: 'agt_a',
      studentId: 'tch_a',
      text: 'What is a fraction?',
      status: 'open',
    });
    expect(question.id).toMatch(/^tq_preview_/);
  });

  it('applyEvidence writes no evidence or profile row and returns the pair unmoved (8.5b review MEDIUM)', async () => {
    const { repos } = stubRepos();
    const appendAndFold = vi.fn(async () => {
      throw new Error('must never be called: a preview must not write evidence for the teacher');
    });
    (repos as { evidenceEvents: unknown }).evidenceEvents = { appendAndFold };
    (repos as { learnerProfiles: unknown }).learnerProfiles = {
      get: vi.fn(async () => {
        throw new Error('must never be called: a preview must not read the teacher\'s own profile row');
      }),
    };
    const deps = testChatDepsFor(process(repos), scope, 'pkg_a');
    const fresh = await deps.profiles.get('tch_a', 'tch_a');
    expect(fresh).toEqual({ studentId: 'tch_a', teacherId: 'tch_a', lang: 'en', mastery: {}, mistakes: [] });
    const moved = await deps.profiles.applyEvidence([
      { studentId: 'tch_a', teacherId: 'tch_a', topicId: 'top_1', correct: true, source: 'check', weight: 1, ts: '2026-10-23T10:00:00.000Z' },
    ]);
    expect(moved).toEqual(fresh);
    expect(appendAndFold).not.toHaveBeenCalled();
    const empty = await deps.profiles.applyEvidence([]);
    expect(empty).toEqual({ studentId: '', teacherId: '', lang: 'en', mastery: {}, mistakes: [] });
  });

  it('a recorded usage job carries source `teacher_preview` (8.5b review LOW: through testChatDepsFor)', async () => {
    const { repos } = stubRepos();
    const added: unknown[] = [];
    const p = process(repos);
    p.queues = { ...p.queues, meter: { add: async (_name: string, data: unknown) => void added.push(data) } };
    const deps = testChatDepsFor(p, scope, 'pkg_a');
    await deps.usage.record(
      { model: 'claude-haiku-4-5', tier: 'main', inputTokens: 1, outputTokens: 1, costMicroUsd: 1 },
      { teacherId: 'tch_a', packageId: 'pkg_a', studentId: 'tch_a', turnId: 'trn_1', source: deps.entitlementSource },
    );
    expect(added).toEqual([expect.objectContaining({ source: 'teacher_preview' })]);
  });
});
