import type { TurnTrace } from '@edmate/contracts';
import { describe, expect, it } from 'vitest';
import { computeHealthMetrics } from './health.js';

/** A schema-valid, minimal TurnTrace fixture; override just the fields a test cares about. */
function trace(x: {
  steps?: TurnTrace['steps'];
  guards?: TurnTrace['guards'];
  turnId?: string;
}): TurnTrace {
  return {
    turnId: x.turnId ?? 'turn_1',
    sessionId: 'sess_1',
    agentVersion: 1,
    packageVersion: 1,
    steps: x.steps ?? [],
    intent: 'on_task',
    move: 'explain',
    guards: x.guards ?? [],
    usage: [],
  };
}

describe('computeHealthMetrics', () => {
  it('returns zeroed stats, not NaN, for an empty array', () => {
    const r = computeHealthMetrics([]);
    expect(r).toEqual({
      turns: 0,
      stepLatencyMs: {},
      errorRate: 0,
      errorsByStep: {},
      guardRate: 0,
      guardsByName: {},
    });
  });

  it('computes nearest-rank p50/p95 for a known 20-value array', () => {
    // ms 1..20 for the `generate` step, one trace per value.
    const traces = Array.from({ length: 20 }, (_, i) =>
      trace({ steps: [{ name: 'generate', ms: i + 1, outcome: 'ok' }] }),
    );
    const r = computeHealthMetrics(traces);
    expect(r.turns).toBe(20);
    // nearest-rank: p50 -> ceil(0.50*20)=10th value (1-indexed) = 10; p95 -> ceil(0.95*20)=19th = 19.
    expect(r.stepLatencyMs.generate).toEqual({ p50: 10, p95: 19, n: 20 });
  });

  it('keeps stats per step name, including firstToken, and excludes turns missing a step', () => {
    const traces = [
      trace({
        steps: [
          { name: 'generate', ms: 100, outcome: 'ok' },
          { name: 'firstToken', ms: 50, outcome: 'ok' },
        ],
      }),
      trace({ steps: [{ name: 'generate', ms: 200, outcome: 'ok' }] }), // no firstToken
    ];
    const r = computeHealthMetrics(traces);
    expect(r.stepLatencyMs.generate).toEqual({ p50: 100, p95: 200, n: 2 });
    expect(r.stepLatencyMs.firstToken).toEqual({ p50: 50, p95: 50, n: 1 });
  });

  it('errorRate is per turn (>=1 failed step), with a per-step breakdown', () => {
    const traces = [
      trace({ steps: [{ name: 'generate', ms: 1, outcome: 'ok' }] }),
      trace({
        steps: [
          { name: 'generate', ms: 1, outcome: 'failed' },
          { name: 'commit', ms: 1, outcome: 'failed' },
        ],
      }),
      trace({ steps: [{ name: 'commit', ms: 1, outcome: 'failed' }] }),
    ];
    const r = computeHealthMetrics(traces);
    expect(r.turns).toBe(3);
    expect(r.errorRate).toBeCloseTo(2 / 3);
    expect(r.errorsByStep).toEqual({ generate: 1, commit: 2 });
  });

  it('guardRate is per turn (>=1 blocking guard), with a per-guard-name breakdown', () => {
    const traces = [
      trace({ guards: [{ name: 'piiScrub', ok: true }] }),
      trace({ guards: [{ name: 'answerLeak', ok: false }] }),
      trace({
        guards: [
          { name: 'answerLeak', ok: false },
          { name: 'moderationIn', ok: false },
        ],
      }),
    ];
    const r = computeHealthMetrics(traces);
    expect(r.turns).toBe(3);
    expect(r.guardRate).toBeCloseTo(2 / 3);
    expect(r.guardsByName).toEqual({ answerLeak: 2, moderationIn: 1 });
  });
});
