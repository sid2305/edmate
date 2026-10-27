import { PublishRefusedError, RepositoryError, type GateRunRow } from '@edmate/db';
import { MODEL_MIX } from '@edmate/gateway';
import { describe, expect, it, vi } from 'vitest';
import type { LogLine } from '../log.js';
import { regateSweepJob, type RegateSweepDeps } from './sweep.js';
import type { PinsResult } from './pins.js';

const PINS: PinsResult = {
  ok: true,
  pins: {
    promptPackVersion: '1.0.0',
    modelPolicy: MODEL_MIX.paid,
    judgeModel: 'anthropic:claude-sonnet-5',
  },
};

function run(run: Partial<GateRunRow> = {}): GateRunRow {
  return {
    id: 'run_1',
    agentId: 'agent_1',
    status: 'queued',
    changes: ['material'],
    summary: null,
    scorecard: null,
    createdAt: '2026-10-27T00:00:00.000Z',
    finishedAt: null,
    publishedAt: null,
    ...run,
  } as GateRunRow;
}

function deps(overrides: Partial<RegateSweepDeps> = {}): RegateSweepDeps {
  return {
    candidates: () => Promise.resolve([]),
    repos: {
      styleCards: { latest: () => Promise.resolve({ id: 'card_1' } as never) },
      courses: { ensureDefault: () => Promise.resolve({ id: 'course_1' } as never) },
      publish: {
        startRun: () => Promise.resolve(run()),
        finishRun: () => Promise.resolve(),
      } as never,
    },
    pins: () => Promise.resolve(PINS),
    enqueue: () => Promise.resolve(),
    log: () => undefined,
    ...overrides,
  };
}

describe('regateSweepJob', () => {
  it('zero candidates: a no-op summary, no repo or queue calls', async () => {
    const pins = vi.fn(() => Promise.resolve(PINS));
    const enqueue = vi.fn(() => Promise.resolve());
    const lines: LogLine[] = [];
    const summary = await regateSweepJob(
      deps({ candidates: () => Promise.resolve([]), pins, enqueue, log: (l) => lines.push(l) }),
    )();
    expect(summary).toEqual({ candidates: 0, started: 0, skipped: 0, failed: 0 });
    expect(pins).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(lines).toEqual([
      {
        level: 'info',
        event: 'regate_sweep.run',
        candidates: 0,
        started: 0,
        skipped: 0,
        failed: 0,
      },
    ]);
  });

  it('one candidate: styleCards.latest, courses.ensureDefault, startRun, then enqueueGate once', async () => {
    const calls: string[] = [];
    const startRun = vi.fn((_scope, pins) => {
      calls.push('startRun');
      expect(pins).toEqual({
        agentId: 'agent_1',
        courseId: 'course_1',
        styleCardId: 'card_1',
        promptPackVersion: '1.0.0',
        modelPolicy: MODEL_MIX.paid,
        judgeModel: 'anthropic:claude-sonnet-5',
      });
      return Promise.resolve(run());
    });
    const enqueue = vi.fn((job) => {
      calls.push('enqueue');
      expect(job).toEqual({ runId: 'run_1', teacherId: 'tch_1' });
      return Promise.resolve();
    });
    const lines: LogLine[] = [];
    const summary = await regateSweepJob(
      deps({
        candidates: () => Promise.resolve([{ teacherId: 'tch_1', agentId: 'agent_1' }]),
        repos: {
          styleCards: {
            latest: () => {
              calls.push('styleCards');
              return Promise.resolve({ id: 'card_1' } as never);
            },
          },
          courses: {
            ensureDefault: () => {
              calls.push('courses');
              return Promise.resolve({ id: 'course_1' } as never);
            },
          },
          publish: { startRun, finishRun: () => Promise.resolve() } as never,
        },
        enqueue,
        log: (l) => lines.push(l),
      }),
    )();
    expect(calls).toEqual(['styleCards', 'courses', 'startRun', 'enqueue']);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(summary).toEqual({ candidates: 1, started: 1, skipped: 0, failed: 0 });
    expect(lines.at(-1)).toEqual({
      level: 'info',
      event: 'regate_sweep.run',
      candidates: 1,
      started: 1,
      skipped: 0,
      failed: 0,
    });
  });

  it('a candidate refused by startRun (PublishRefusedError) is logged and skipped; the next still runs', async () => {
    const started: string[] = [];
    const startRun = vi.fn((scope: { teacherId: string }) => {
      if (scope.teacherId === 'tch_bad') {
        return Promise.reject(new PublishRefusedError('invalid', 'publish.startRun', 'suspended'));
      }
      started.push(scope.teacherId);
      return Promise.resolve(run());
    });
    const enqueue = vi.fn(() => Promise.resolve());
    const lines: LogLine[] = [];
    const summary = await regateSweepJob(
      deps({
        candidates: () =>
          Promise.resolve([
            { teacherId: 'tch_bad', agentId: 'agent_bad' },
            { teacherId: 'tch_ok', agentId: 'agent_ok' },
          ]),
        repos: {
          styleCards: { latest: () => Promise.resolve({ id: 'card_1' } as never) },
          courses: { ensureDefault: () => Promise.resolve({ id: 'course_1' } as never) },
          publish: { startRun, finishRun: () => Promise.resolve() } as never,
        },
        enqueue,
        log: (l) => lines.push(l),
      }),
    )();
    expect(started).toEqual(['tch_ok']);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(summary).toEqual({ candidates: 2, started: 1, skipped: 1, failed: 0 });
    expect(lines).toContainEqual({
      level: 'warn',
      event: 'regate_sweep.candidate_refused',
      teacherId: 'tch_bad',
      agentId: 'agent_bad',
      reason: 'suspended',
    });
  });

  it('an enqueueGate failure ends that run error and the sweep continues', async () => {
    const finishRun = vi.fn(() => Promise.resolve());
    const enqueue = vi.fn((job: { teacherId: string }) =>
      job.teacherId === 'tch_down' ? Promise.reject(new Error('redis down')) : Promise.resolve(),
    );
    const lines: LogLine[] = [];
    const summary = await regateSweepJob(
      deps({
        candidates: () =>
          Promise.resolve([
            { teacherId: 'tch_down', agentId: 'agent_down' },
            { teacherId: 'tch_ok', agentId: 'agent_ok' },
          ]),
        repos: {
          styleCards: { latest: () => Promise.resolve({ id: 'card_1' } as never) },
          courses: { ensureDefault: () => Promise.resolve({ id: 'course_1' } as never) },
          publish: { startRun: () => Promise.resolve(run()), finishRun } as never,
        },
        enqueue,
        log: (l) => lines.push(l),
      }),
    )();
    expect(summary).toEqual({ candidates: 2, started: 1, skipped: 0, failed: 1 });
    expect(finishRun).toHaveBeenCalledWith(
      { teacherId: 'tch_down' },
      { runId: 'run_1', status: 'error', summary: { groups: [], errorCode: 'enqueue_failed' } },
    );
    expect(lines).toContainEqual(
      expect.objectContaining({ event: 'regate_sweep.enqueue_failed', teacherId: 'tch_down' }),
    );
  });

  it('a finishRun failure after a failed enqueue is logged too (never thrown)', async () => {
    const lines: LogLine[] = [];
    const summary = await regateSweepJob(
      deps({
        candidates: () => Promise.resolve([{ teacherId: 'tch_1', agentId: 'agent_1' }]),
        repos: {
          styleCards: { latest: () => Promise.resolve({ id: 'card_1' } as never) },
          courses: { ensureDefault: () => Promise.resolve({ id: 'course_1' } as never) },
          publish: {
            startRun: () => Promise.resolve(run()),
            finishRun: () => Promise.reject(new Error('db down')),
          } as never,
        },
        enqueue: () => Promise.reject(new Error('redis down')),
        log: (l) => lines.push(l),
      }),
    )();
    expect(summary).toEqual({ candidates: 1, started: 0, skipped: 0, failed: 1 });
    expect(lines).toContainEqual(
      expect.objectContaining({ event: 'regate_sweep.finish_failed', teacherId: 'tch_1' }),
    );
  });

  it('a candidate with no style card is skipped (style_card_required) without a write', async () => {
    const ensureDefault = vi.fn(() => Promise.resolve({ id: 'course_1' } as never));
    const lines: LogLine[] = [];
    const summary = await regateSweepJob(
      deps({
        candidates: () => Promise.resolve([{ teacherId: 'tch_1', agentId: 'agent_1' }]),
        repos: {
          styleCards: { latest: () => Promise.resolve(null) },
          courses: { ensureDefault },
          publish: { startRun: vi.fn(), finishRun: vi.fn() } as never,
        },
        log: (l) => lines.push(l),
      }),
    )();
    expect(ensureDefault).not.toHaveBeenCalled();
    expect(summary).toEqual({ candidates: 1, started: 0, skipped: 1, failed: 0 });
    expect(lines).toContainEqual(
      expect.objectContaining({
        event: 'regate_sweep.candidate_skipped',
        reason: 'style_card_required',
      }),
    );
  });

  it('pins unavailable: the whole sweep logs once and returns with zero started, no repo call', async () => {
    const startRun = vi.fn();
    const lines: LogLine[] = [];
    const summary = await regateSweepJob(
      deps({
        candidates: () => Promise.resolve([{ teacherId: 'tch_1', agentId: 'agent_1' }]),
        pins: () => Promise.resolve({ ok: false, reason: 'content_missing' }),
        repos: {
          styleCards: { latest: vi.fn() },
          courses: { ensureDefault: vi.fn() },
          publish: { startRun, finishRun: vi.fn() } as never,
        },
        log: (l) => lines.push(l),
      }),
    )();
    expect(startRun).not.toHaveBeenCalled();
    expect(summary).toEqual({ candidates: 1, started: 0, skipped: 0, failed: 0 });
    expect(lines).toEqual([
      { level: 'error', event: 'regate_sweep.pins_unavailable', reason: 'content_missing' },
      {
        level: 'warn',
        event: 'regate_sweep.run',
        candidates: 1,
        started: 0,
        skipped: 0,
        failed: 0,
      },
    ]);
  });

  it('a non-refusal, non-RepositoryError thrown by a repo call is still skipped, not thrown', async () => {
    const lines: LogLine[] = [];
    const summary = await regateSweepJob(
      deps({
        candidates: () => Promise.resolve([{ teacherId: 'tch_1', agentId: 'agent_1' }]),
        repos: {
          styleCards: { latest: () => Promise.reject(new RepositoryError('scope', 'test')) },
          courses: { ensureDefault: vi.fn() },
          publish: { startRun: vi.fn(), finishRun: vi.fn() } as never,
        },
        log: (l) => lines.push(l),
      }),
    )();
    expect(summary).toEqual({ candidates: 1, started: 0, skipped: 1, failed: 0 });
    expect(lines).toContainEqual(
      expect.objectContaining({ event: 'regate_sweep.candidate_refused', reason: 'scope' }),
    );
  });
});
