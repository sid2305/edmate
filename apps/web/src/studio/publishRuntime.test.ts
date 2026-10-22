// Task 8.7 Phase D: the publish backend is built lazily: the newest signed prompt-pack set and
// MODEL_MIX.paid (the packages runtime's pins, reused read-only), the release judge from
// EDMATE_JUDGE_MODEL and the gate queue on REDIS_URL. Anything missing is StudioUnavailableError
// -> 503, logged by reason only. The gate job is enqueued after startRun; a failed enqueue ends
// the run `error`. Fake repos and a fake queue: no database, Redis or model (rule 4).
import { resolve } from 'node:path';
import { join } from 'node:path';
import { newestSignedSet, readPromptPackLibrary } from '@edmate/content';
import { MODEL_MIX } from '@edmate/gateway';
import { GATE_JOB, gateJobOptions } from '@edmate/queue';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import type { RoleContext } from '../auth/guard';
import { createPublishHandlers, type PublishBackend } from './publish';
import { createPublishRuntime, judgeModelPin } from './publishRuntime';
import { StudioUnavailableError } from './routes';

const CONTENT = resolve(__dirname, '../../../../content');
const ENV = {
  EDMATE_CONTENT_DIR: CONTENT,
  REDIS_URL: 'redis://127.0.0.1:1',
  EDMATE_JUDGE_MODEL: ' anthropic : claude-judge ',
};
const ctx: RoleContext = { principal: { userId: 't_asha', role: 'teacher' }, params: Promise.resolve({}) };

function fakeRepos(order: string[]) {
  const step = (m: string) => order.push(m);
  return {
    teacherProfiles: { assertVerifiedForPublish: async () => void step('assert') },
    packages: { listForTeacher: async () => (step('list'), [{ agentId: 'agt_1' }]) },
    courses: { ensureDefault: async () => (step('course'), { id: 'c_1' }) },
    styleCards: { latest: async () => (step('card'), { id: 'sc_1' }) },
    publish: {
      startRun: vi.fn(async () => (step('startRun'), { id: 'run_1' })),
      finishRun: vi.fn(async () => void step('finishRun')),
      latestRun: async () => null,
      failedCases: async () => [],
      changedSinceLastPublish: async () => false,
    },
  } as unknown as PublishBackend['repos'];
}

function hooks(order: string[], add: (name: string, data: unknown, opts: unknown) => Promise<unknown>) {
  const repos = fakeRepos(order);
  const queue = vi.fn(() => ({ add: vi.fn(add) }));
  return { repos: () => repos, queue, log: { error: vi.fn() }, r: repos };
}

const post = () =>
  new NextRequest('http://localhost/api/studio/publish', { method: 'POST', body: '{}' });

describe('judgeModelPin', () => {
  it('is "<provider>:<model>" trimmed, like the worker reads it', () => {
    expect(judgeModelPin({ EDMATE_JUDGE_MODEL: ' anthropic : claude-judge ' })).toBe('anthropic:claude-judge');
    expect(judgeModelPin({ EDMATE_JUDGE_MODEL: 'openai:gpt:x' })).toBe('openai:gpt:x');
  });

  it.each([undefined, '', '  ', 'anthropic', ':m', 'anthropic:'])('refuses %j', (raw) => {
    expect(() => judgeModelPin({ EDMATE_JUDGE_MODEL: raw })).toThrow(StudioUnavailableError);
  });
});

describe('createPublishRuntime', () => {
  it('pins the newest signed set, MODEL_MIX.paid and the judge; built once; enqueue goes after startRun', async () => {
    const order: string[] = [];
    const add = vi.fn(async (name: string, data: unknown, opts: unknown) => {
      order.push('enqueue');
      return { name, data, opts };
    });
    const h = hooks(order, add);
    const runtime = createPublishRuntime(() => ENV, h);
    const b = await runtime();
    const expected = newestSignedSet(readPromptPackLibrary(join(CONTENT, 'prompt-packs')));
    expect(b.promptPackVersion).toBe(expected!.version);
    expect(b.modelPolicy).toBe(MODEL_MIX.paid);
    expect(b.judgeModel).toBe('anthropic:claude-judge');
    expect(await runtime()).toBe(b);
    expect(h.queue).toHaveBeenCalledTimes(1);
    expect(h.queue).toHaveBeenCalledWith('redis://127.0.0.1:1', h.log);

    const res = await createPublishHandlers(runtime, h.log).start(post(), ctx);
    expect(res.status).toBe(202);
    expect(order).toEqual(['assert', 'list', 'card', 'course', 'startRun', 'enqueue']);
    expect(add).toHaveBeenCalledWith(GATE_JOB, { runId: 'run_1', teacherId: 't_asha' }, gateJobOptions('run_1'));
    expect(h.r.publish.startRun).toHaveBeenCalledWith(
      { teacherId: 't_asha' },
      {
        agentId: 'agt_1',
        courseId: 'c_1',
        styleCardId: 'sc_1',
        promptPackVersion: expected!.version,
        modelPolicy: MODEL_MIX.paid,
        judgeModel: 'anthropic:claude-judge',
      },
    );
    expect(h.log.error).not.toHaveBeenCalled();
  });

  it('a queue that refuses the job ends the run error (enqueue_failed): 503', async () => {
    const order: string[] = [];
    const h = hooks(order, async () => Promise.reject(new Error('ECONNREFUSED 127.0.0.1')));
    const res = await createPublishHandlers(createPublishRuntime(() => ENV, h), h.log).start(post(), ctx);
    expect(res.status).toBe(503);
    expect(order).toEqual(['assert', 'list', 'card', 'course', 'startRun', 'finishRun']);
    expect(h.r.publish.finishRun).toHaveBeenCalledWith(
      { teacherId: 't_asha' },
      { runId: 'run_1', status: 'error', summary: { groups: [], errorCode: 'enqueue_failed' } },
    );
    expect(JSON.stringify(h.log.error.mock.calls)).not.toContain('127.0.0.1');
  });

  it.each([
    ['REDIS_URL', { ...ENV, REDIS_URL: ' ' }],
    ['judge_model', { ...ENV, EDMATE_JUDGE_MODEL: undefined }],
  ])('a missing %s is StudioUnavailableError, logged, not cached, and opens no queue', async (reason, env) => {
    const h = hooks([], async () => undefined);
    let current: Record<string, string | undefined> = env;
    const runtime = createPublishRuntime(() => current, h);
    await expect(runtime()).rejects.toMatchObject({ reason });
    expect(h.queue).not.toHaveBeenCalled();
    expect(h.log.error).toHaveBeenCalledWith('studio.publish_runtime_unavailable', { reason });
    current = ENV;
    await expect(runtime()).resolves.toBeDefined();
  });

  it('no signed prompt-pack set is unavailable (the packages runtime reason)', async () => {
    const h = hooks([], async () => undefined);
    const runtime = createPublishRuntime(() => ENV, { ...h, readPromptPacks: () => new Map() as never });
    await expect(runtime()).rejects.toMatchObject({ reason: 'prompt_packs_unsigned' });
    expect(h.log.error).toHaveBeenCalledWith('studio.publish_runtime_unavailable', {
      reason: 'prompt_packs_unsigned',
    });
    expect(h.queue).not.toHaveBeenCalled();
  });

  it('a non-coded build error is logged by name', async () => {
    const h = hooks([], async () => undefined);
    const runtime = createPublishRuntime(() => ENV, {
      ...h,
      queue: () => {
        throw new TypeError('bad url redis://secret');
      },
    });
    await expect(runtime()).rejects.toThrow(TypeError);
    expect(h.log.error).toHaveBeenCalledWith('studio.publish_runtime_unavailable', { reason: 'TypeError' });
  });

  it('the repos getter is read lazily, per access', async () => {
    const r = vi.fn(() => ({}) as never);
    const h = hooks([], async () => undefined);
    const b = await createPublishRuntime(() => ENV, { ...h, repos: r })();
    expect(r).not.toHaveBeenCalled();
    void b.repos;
    expect(r).toHaveBeenCalledTimes(1);
  });
});
