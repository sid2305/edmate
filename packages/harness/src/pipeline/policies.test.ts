// One describe per step: each failure policy of the Turn pipeline spec, on throw and on timeout,
// on the virtual clock. Test names quote the spec's "On failure" column (STEP_SPEC.onFailure).
import type { ModelGateway, TurnEvent, TurnTrace } from '@edmate/contracts';
import {
  demoChunk,
  demoEntitlementSubscription,
  demoSafetyAlert,
  demoTurnInput,
  turnInputHint,
  usageMain,
  usageSmall,
} from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { driveEvents, driveTurn } from '../testing/driveTurn.js';
import { memoryAlertSink, unusedPort } from '../testing/memoryPorts.js';
import { scriptedStreamProviderError, scriptedStreamText } from '../testing/gatewayFixtures.js';
import {
  type StepOverrides,
  TEST_CARING_REPLY,
  TEST_DISTRESS_REPLY,
  TEST_SAFE_REPLY,
  testAskDecision,
  testDeps,
  testSteps,
} from '../testing/testSteps.js';
import type { GatewayScript } from '../testing/scriptedGateway.js';
import type { MemoryAlertSink } from '../testing/memoryPorts.js';
import { VIRTUAL_EPOCH_MS } from '../testing/virtualClock.js';
import { TurnAbort, TurnRejection } from './errors.js';
import { LAST_RESORT_DISTRESS_REPLY, runTurn } from './runner.js';
import { ALERT_ATTEMPT_TIMEOUT_MS, STEP_SPEC, type StepName } from './spec.js';
import type { StepEnv, TurnRunResult } from './types.js';

const boom = (): Promise<never> => Promise.reject(new Error('step failed'));
/** Sleeps past any budget; resolves only if the runner fails to time it out. */
const hang =
  <R>(ms = 60_000, r?: R) =>
  async (env: StepEnv): Promise<R> => {
    await env.deps.clock.sleep(ms);
    return r as R;
  };

async function run(
  overrides: StepOverrides,
  opts: { script?: GatewayScript; alerts?: MemoryAlertSink; gateway?: ModelGateway } = {},
) {
  const t = testDeps({
    ...(opts.script === undefined ? {} : { script: opts.script }),
    ...(opts.alerts === undefined ? {} : { alerts: opts.alerts }),
    ...(opts.gateway === undefined ? {} : { overrides: { gateway: opts.gateway } }),
  });
  const steps = testSteps(overrides);
  const out = await driveTurn(runTurn(demoTurnInput, { deps: t.deps, steps }), t.clock);
  return { ...out, t, steps };
}

const outcomeOf = (r: TurnRunResult, name: StepName) =>
  r.trace?.steps.find((s) => s.name === name)?.outcome;
const ran = (log: { step: string; phase: string }[], step: string) =>
  log.some((l) => l.step === step && l.phase === 'start');
const policy = (name: StepName) => `"${STEP_SPEC[name].onFailure}"`;

describe(`admit: ${policy('admit')}`, () => {
  const noModel = () => {
    const calls: string[] = [];
    return { calls, gateway: unusedPort<ModelGateway>('gateway', calls) };
  };

  it('a TurnRejection becomes its own error event; no model call, no later step, no trace', async () => {
    const m = noModel();
    const { events, steps, t, result } = await run(
      { admit: () => Promise.reject(new TurnRejection('input_too_large')) },
      { gateway: m.gateway },
    );
    expect(events).toEqual([{ type: 'error', code: 'input_too_large', retryable: false }]);
    expect(m.calls).toEqual([]);
    expect(steps.log.filter((l) => l.phase === 'start').map((l) => l.step)).toEqual(['admit']);
    expect(t.traces.records).toEqual([]);
    expect(result.trace).toBeNull();
    expect(steps.commits).toEqual([]);
  });

  it('throw → error rate_limited, retryable', async () => {
    const m = noModel();
    const { events } = await run({ admit: boom }, { gateway: m.gateway });
    expect(events).toEqual([{ type: 'error', code: 'rate_limited', retryable: true }]);
    expect(m.calls).toEqual([]);
  });

  it('timeout at 50 ms → error rate_limited, retryable', async () => {
    const { events, timed } = await run({ admit: hang() });
    expect(events).toEqual([{ type: 'error', code: 'rate_limited', retryable: true }]);
    expect(timed[0]?.at).toBe(VIRTUAL_EPOCH_MS + 50);
  });
});

describe(`entitle: ${policy('entitle')}`, () => {
  it('a limit_reached rejection is passed through; no model call, no trace', async () => {
    const calls: string[] = [];
    const { events, t, steps } = await run(
      { entitle: () => Promise.reject(new TurnRejection('limit_reached')) },
      { gateway: unusedPort<ModelGateway>('gateway', calls) },
    );
    expect(events).toEqual([{ type: 'error', code: 'limit_reached', retryable: false }]);
    expect(calls).toEqual([]);
    expect(t.traces.records).toEqual([]);
    expect(steps.commits).toEqual([]);
  });

  it('throw → no_access (fail closed)', async () => {
    const { events } = await run({ entitle: boom });
    expect(events).toEqual([{ type: 'error', code: 'no_access', retryable: true }]);
  });

  it('timeout at 50 ms → no_access (fail closed)', async () => {
    const { events, timed } = await run({ entitle: hang() });
    expect(events).toEqual([{ type: 'error', code: 'no_access', retryable: true }]);
    expect(timed[0]?.at).toBe(VIRTUAL_EPOCH_MS + 50);
  });

  it('a schema-invalid entitlement → no_access, not retryable', async () => {
    const happy = testSteps();
    const { events } = await run({
      entitle: async (env) => ({
        ...(await happy.entitle(env)),
        entitlement: { ...demoEntitlementSubscription, allowedModuleIds: ['mod_test_04'] },
      }),
    });
    expect(events).toEqual([{ type: 'error', code: 'no_access', retryable: false }]);
  });

  it.each([
    ['another student', { studentId: 'stu_other' }],
    ['another agent', { agentId: 'agt_other' }],
    ['a paused subscription', { status: 'paused' }],
    ['an ended subscription', { status: 'ended' }],
  ] as const)('an entitlement for %s → no_access', async (_label, patch) => {
    const happy = testSteps();
    const { events } = await run({
      entitle: async (env) => ({
        ...(await happy.entitle(env)),
        entitlement: { ...demoEntitlementSubscription, ...patch },
      }),
    });
    expect(events).toEqual([{ type: 'error', code: 'no_access', retryable: false }]);
  });
});

describe(`preGuard: ${policy('preGuard')}`, () => {
  const blocked = { type: 'error', code: 'guard_blocked', retryable: true } as const;

  it('scrub throw → guard_blocked; nothing else runs; commit gets no unscrubbed text', async () => {
    const { events, steps, result } = await run({ scrub: boom });
    expect(events).toEqual([blocked]);
    for (const s of ['preGuard', 'route', 'buildContext', 'decide', 'generate']) {
      expect(ran(steps.log, s)).toBe(false);
    }
    expect(steps.commits[0]).toMatchObject({ outcome: 'blocked', input: null });
    expect(steps.log.find((l) => l.step === 'commit')?.text).toBeUndefined();
    expect(outcomeOf(result, 'preGuard')).toBe('failed');
    expect(result.trace?.move).toBe('redirect');
  });

  it('scrub timeout at 400 ms → guard_blocked', async () => {
    const { timed } = await run({ scrub: hang() });
    expect(timed).toEqual([{ event: blocked, at: VIRTUAL_EPOCH_MS + 400 }]);
  });

  it('a scrub that drops the text → guard_blocked', async () => {
    const { events } = await run({ scrub: () => Promise.resolve({ guards: [] }) });
    expect(events).toEqual([blocked]);
  });

  it('a scrub that invents text for a text-less input → guard_blocked', async () => {
    const t = testDeps();
    const steps = testSteps({ scrub: () => Promise.resolve({ text: 'x', guards: [] }) });
    const { events } = await driveTurn(runTurn(turnInputHint, { deps: t.deps, steps }), t.clock);
    expect(events).toEqual([blocked]);
  });

  it('checks throw → guard_blocked; decide never runs', async () => {
    const { events, steps, result } = await run({ preGuard: boom });
    expect(events).toEqual([blocked]);
    expect(ran(steps.log, 'decide')).toBe(false);
    expect(outcomeOf(result, 'preGuard')).toBe('failed');
    expect(steps.commits[0]?.outcome).toBe('blocked');
  });

  it('checks timeout → guard_blocked at 400 ms', async () => {
    const { timed } = await run({ preGuard: hang() });
    expect(timed).toEqual([{ event: blocked, at: VIRTUAL_EPOCH_MS + 400 }]);
  });

  it('the scrub and the checks share one 400 ms budget', async () => {
    const { events, result } = await run({
      scrub: async (env) => {
        await env.deps.clock.sleep(300);
        return { text: 'x', guards: [] };
      },
      preGuard: hang(150, { result: 'ok' as const, guards: [], usage: [] }),
    });
    expect(events).toEqual([blocked]);
    expect(result.trace?.steps.find((s) => s.name === 'preGuard')).toEqual({
      name: 'preGuard',
      ms: 400,
      outcome: 'failed',
    });
  });

  it('a block verdict → guard_blocked, not retryable; outcome ok', async () => {
    const { events, result } = await run({
      preGuard: () =>
        Promise.resolve({
          result: 'block',
          guards: [{ name: 'jailbreak', ok: false, action: 'block' }],
          usage: [usageSmall],
        }),
    });
    expect(events).toEqual([{ type: 'error', code: 'guard_blocked', retryable: false }]);
    expect(outcomeOf(result, 'preGuard')).toBe('ok');
    expect(result.trace?.guards).toContainEqual({ name: 'jailbreak', ok: false, action: 'block' });
  });

  it('a guard entry with reason text fails the schema → guard_blocked (no text into the trace)', async () => {
    const { events } = await run({
      preGuard: () =>
        Promise.resolve({
          result: 'ok',
          guards: [{ name: 'x', ok: true, reason: 'student said ...' } as never],
          usage: [],
        }),
    });
    expect(events).toEqual([blocked]);
  });
});

describe(`route: ${policy('route')}`, () => {
  it('throw → onFailure default on_task / none, turn continues', async () => {
    const { events, steps, result } = await run({ route: { run: boom } });
    expect(events.at(-1)?.type).toBe('done');
    expect(ran(steps.log, 'route.onFailure')).toBe(true);
    expect(outcomeOf(result, 'route')).toBe('fallback');
    expect(result.trace?.intent).toBe('on_task');
    expect(steps.commits[0]?.context).toMatchObject({ intent: 'on_task', attempt: 'none' });
  });

  it('timeout at 400 ms → fallback; decide starts at 400 ms', async () => {
    const { steps, result } = await run({ route: { run: hang() } });
    expect(outcomeOf(result, 'route')).toBe('fallback');
    expect(steps.log.find((l) => l.step === 'decide')?.at).toBe(VIRTUAL_EPOCH_MS + 400);
  });

  it('distress keywords still escalate: onFailure → distress', async () => {
    const { events, steps } = await run({
      route: { run: boom, onFailure: () => ({ intent: 'distress', attempt: 'none' }) },
    });
    expect(events[0]).toEqual({ type: 'safety', level: 'alert' });
    expect(ran(steps.log, 'escalate')).toBe(true);
  });

  describe('onFailure itself throws or returns junk', () => {
    const badOnFailures = [
      () => {
        throw new Error('x');
      },
      () => ({ intent: 'nope', attempt: 'none' }) as never,
    ];

    it('the distress check finds nothing → on_task / none; route marked failed', async () => {
      for (const onFailure of badOnFailures) {
        const { events, result } = await run({ route: { run: boom, onFailure } });
        expect(events.at(-1)?.type).toBe('done');
        expect(result.trace?.intent).toBe('on_task');
        expect(outcomeOf(result, 'route')).toBe('fallback');
      }
    });

    it('the injected distress check still escalates on a hit', async () => {
      for (const onFailure of badOnFailures) {
        const seen: string[] = [];
        const t = testDeps({
          overrides: {
            distressCheck: (text) => {
              seen.push(text);
              return true;
            },
          },
        });
        const steps = testSteps({ route: { run: boom, onFailure } });
        const { events, result } = await driveTurn(
          runTurn(demoTurnInput, { deps: t.deps, steps }),
          t.clock,
        );
        expect(events[0]).toEqual({ type: 'safety', level: 'alert' });
        expect(seen).toEqual([demoTurnInput.text]);
        expect(t.alerts.raised).toHaveLength(1);
        expect(result.trace?.intent).toBe('distress');
        expect(outcomeOf(result, 'route')).toBe('fallback');
      }
    });

    it('the distress check also throws → on_task / none, route marked failed and reported', async () => {
      const t = testDeps({
        overrides: {
          distressCheck: () => {
            throw new Error('check down');
          },
        },
      });
      const steps = testSteps({
        route: {
          run: boom,
          onFailure: () => {
            throw new Error('x');
          },
        },
      });
      const { events, result } = await driveTurn(
        runTurn(demoTurnInput, { deps: t.deps, steps }),
        t.clock,
      );
      expect(events.at(-1)?.type).toBe('done');
      expect(result.trace?.intent).toBe('on_task');
      expect(outcomeOf(result, 'route')).toBe('failed');
      expect(result.background.map((b) => b.task)).toEqual(['runner', 'runner']);
    });
  });
});

describe(`escalate: ${policy('escalate')}`, () => {
  const distressGuard: StepOverrides = {
    preGuard: () =>
      Promise.resolve({
        result: 'escalate',
        alert: demoSafetyAlert,
        guards: [{ name: 'distressDetect', ok: false, action: 'escalate' }],
        usage: [usageSmall],
      }),
  };

  it('a distress verdict → safety alert, caring reply, done; skips 6-9; alert delivered', async () => {
    const { events, steps, t, result } = await run(distressGuard);
    expect(events).toEqual([
      { type: 'safety', level: 'alert' },
      { type: 'token', text: TEST_CARING_REPLY },
      { type: 'done', messageId: 'message_1', usage: [usageSmall] },
    ]);
    for (const s of ['decide', 'generate', 'postGuard']) expect(ran(steps.log, s)).toBe(false);
    expect(t.alerts.raised).toEqual([demoSafetyAlert]);
    expect(steps.commits[0]).toMatchObject({
      outcome: 'escalated',
      intent: 'distress',
      replyText: TEST_CARING_REPLY,
      alert: demoSafetyAlert,
    });
    expect(result.trace).toMatchObject({ intent: 'distress', move: 'redirect' });
    expect(outcomeOf(result, 'escalate')).toBe('ok');
    // Meter still runs: the small-model call in step 3 is usage.
    expect(t.usage.rows.map((r) => r.usage)).toEqual([usageSmall]);
  });

  it('throw → the locale fallback reply and a runner-built alert (no excerpt text)', async () => {
    const { events, t, result } = await run({
      route: { run: () => Promise.resolve({ intent: 'distress', attempt: 'none', usage: [] }) },
      escalate: boom,
    });
    expect(events).toEqual([
      { type: 'safety', level: 'alert' },
      { type: 'token', text: TEST_DISTRESS_REPLY },
      { type: 'done', messageId: 'message_1', usage: [] },
    ]);
    expect(t.alerts.raised).toEqual([
      {
        id: 'alert_1',
        level: 'alert',
        kind: 'distress',
        studentId: demoTurnInput.studentId,
        teacherId: 'tch_test_01',
        sessionId: demoTurnInput.sessionId,
        excerptRedacted: '',
        createdAt: new Date(VIRTUAL_EPOCH_MS).toISOString(),
      },
    ]);
    expect(outcomeOf(result, 'escalate')).toBe('fallback');
  });

  it('timeout at 200 ms → fallback reply; the guard alert is still raised', async () => {
    const { events, t, result } = await run({ ...distressGuard, escalate: hang() });
    expect(events[1]).toEqual({ type: 'token', text: TEST_DISTRESS_REPLY });
    expect(t.alerts.raised).toEqual([demoSafetyAlert]);
    expect(outcomeOf(result, 'escalate')).toBe('fallback');
  });

  it('an alert from escalate replaces the guard alert', async () => {
    const enriched = { ...demoSafetyAlert, id: 'alt_enriched', level: 'critical' as const };
    const { t } = await run({
      ...distressGuard,
      escalate: () => Promise.resolve({ replyText: 'r', alert: enriched }),
    });
    expect(t.alerts.raised).toEqual([enriched]);
  });

  it('escalate beats block: moderation blocks but route says distress', async () => {
    const { events, steps } = await run({
      preGuard: () => Promise.resolve({ result: 'block', guards: [], usage: [] }),
      route: { run: () => Promise.resolve({ intent: 'distress', attempt: 'none', usage: [] }) },
    });
    expect(events[0]).toEqual({ type: 'safety', level: 'alert' });
    expect(steps.commits[0]?.outcome).toBe('escalated');
  });

  it('escalate beats a failed preGuard too', async () => {
    const { events } = await run({
      preGuard: boom,
      route: { run: () => Promise.resolve({ intent: 'distress', attempt: 'none', usage: [] }) },
    });
    expect(events.map((e) => e.type)).toEqual(['safety', 'token', 'done']);
  });

  it('alert retried until delivered: 250, 500, 1000 ms backoff; finished waits for it', async () => {
    const alerts = memoryAlertSink({ failTimes: 3 });
    const { t, result, timed } = await run(distressGuard, { alerts });
    expect(alerts.attempts).toBe(4);
    expect(alerts.raised).toEqual([demoSafetyAlert]);
    expect(result.background.map((b) => b.task)).toEqual(['alert', 'alert', 'alert']);
    // done went out at once; the last attempt is at +250+500+1000 after the first.
    const doneAt = timed.at(-1)?.at ?? 0;
    expect(t.clock.now() - doneAt).toBe(1_750);
  });

  it('backoff doubles to a 30 s cap with no attempt limit', async () => {
    const t = testDeps();
    const times: number[] = [];
    let n = 0;
    t.deps.alerts = {
      raise: () => {
        times.push(t.clock.now());
        return ++n <= 10 ? Promise.reject(new Error('down')) : Promise.resolve();
      },
    };
    const steps = testSteps(distressGuard);
    await driveTurn(runTurn(demoTurnInput, { deps: t.deps, steps }), t.clock);
    const gaps = times.slice(1).map((x, i) => x - (times[i] ?? 0));
    expect(gaps).toEqual([250, 500, 1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
  });

  it('a hanging raise counts as failed after 5 s and is retried', async () => {
    const t = testDeps();
    let n = 0;
    t.deps.alerts = {
      raise: () => (++n === 1 ? new Promise<void>(() => undefined) : Promise.resolve()),
    };
    const { result } = await driveTurn(
      runTurn(demoTurnInput, { deps: t.deps, steps: testSteps(distressGuard) }),
      t.clock,
    );
    expect(n).toBe(2);
    expect(result.background).toHaveLength(1);
    expect(String(result.background[0]?.error)).toMatch(/timed out/);
    expect(ALERT_ATTEMPT_TIMEOUT_MS).toBe(5_000);
  });

  describe('last-resort caring reply (escalate and its fallback text both fail)', () => {
    const brokenTexts = (distress: () => string) =>
      testDeps({
        overrides: { fallbackReplies: { safeReply: () => TEST_SAFE_REPLY, distress } },
      });

    it.each([
      [
        'throws',
        () => {
          throw new Error('no text');
        },
      ],
      ['returns empty text', () => ''],
    ])(
      'fallback text %s → the built-in reply; alert, commit and trace still happen',
      async (_l, distress) => {
        const t = brokenTexts(distress);
        const steps = testSteps({ ...distressGuard, escalate: boom });
        const { events, result } = await driveTurn(
          runTurn(demoTurnInput, { deps: t.deps, steps }),
          t.clock,
        );
        expect(events).toEqual([
          { type: 'safety', level: 'alert' },
          { type: 'token', text: LAST_RESORT_DISTRESS_REPLY },
          { type: 'done', messageId: 'message_1', usage: [usageSmall] },
        ]);
        expect(t.alerts.raised).toEqual([demoSafetyAlert]);
        expect(steps.commits[0]).toMatchObject({
          outcome: 'escalated',
          replyText: LAST_RESORT_DISTRESS_REPLY,
          alert: demoSafetyAlert,
        });
        expect(t.traces.records).toHaveLength(1);
        expect(outcomeOf(result, 'escalate')).toBe('failed');
        expect(result.background.some((b) => b.task === 'runner')).toBe(true);
      },
    );

    it('an escalate step that returns empty text also gets the fallback text', async () => {
      const { events } = await run({
        ...distressGuard,
        escalate: () => Promise.resolve({ replyText: '' }),
      });
      expect(events[1]).toEqual({ type: 'token', text: TEST_DISTRESS_REPLY });
    });

    it('the built-in reply is warm, country-neutral and has no phone numbers', () => {
      expect(LAST_RESORT_DISTRESS_REPLY.trim().length).toBeGreaterThan(40);
      expect(LAST_RESORT_DISTRESS_REPLY).not.toMatch(/\d/);
      expect(LAST_RESORT_DISTRESS_REPLY).toMatch(/trusted adult/);
      expect(LAST_RESORT_DISTRESS_REPLY).toMatch(/emergency services/);
    });
  });
});

describe(`buildContext: ${policy('buildContext')}`, () => {
  const decideSees = () => {
    const seen: { retrieved: unknown[]; lockedHit: boolean; history: unknown[] }[] = [];
    return {
      seen,
      decide: {
        run: (
          _env: StepEnv,
          ctx: { retrieved: unknown[]; lockedHit: boolean; history: unknown[] },
        ) => {
          seen.push(ctx);
          return Promise.resolve(testAskDecision);
        },
      },
    };
  };

  it('throw → proceed without retrieval (retrieved [], lockedHit false)', async () => {
    const d = decideSees();
    const { events, result } = await run({ buildContext: boom, decide: d.decide as never });
    expect(events.at(-1)?.type).toBe('done');
    expect(d.seen[0]).toMatchObject({ retrieved: [], lockedHit: false, history: [], helpRung: 0 });
    expect(outcomeOf(result, 'buildContext')).toBe('fallback');
  });

  it('timeout at 300 ms → fallback context', async () => {
    const d = decideSees();
    const { result } = await run({ buildContext: hang(), decide: d.decide as never });
    expect(d.seen[0]).toMatchObject({ retrieved: [] });
    expect(result.trace?.steps.find((s) => s.name === 'buildContext')).toEqual({
      name: 'buildContext',
      ms: 300,
      outcome: 'fallback',
    });
  });

  it('a chunk from a locked module never reaches decide (TurnContext refine → fallback)', async () => {
    const d = decideSees();
    const happy = testSteps();
    const { events, result } = await run({
      buildContext: async (env, e) => ({
        ...(await happy.buildContext(env, e)),
        retrieved: [{ ...demoChunk, moduleId: 'mod_test_04' }],
        lockedHit: true,
      }),
      decide: d.decide as never,
    });
    expect(events.at(-1)?.type).toBe('done');
    expect(d.seen).toEqual([expect.objectContaining({ retrieved: [], lockedHit: false })]);
    expect(outcomeOf(result, 'buildContext')).toBe('fallback');
  });

  it('a package that does not match the entitlement → no_access; decide never runs', async () => {
    const happy = testSteps();
    const { events, steps } = await run({
      entitle: async (env) => {
        const e = await happy.entitle(env);
        return { ...e, pkg: { ...e.pkg, version: e.pkg.version + 1 } };
      },
    });
    expect(events).toEqual([{ type: 'error', code: 'no_access', retryable: false }]);
    expect(ran(steps.log, 'decide')).toBe(false);
    expect(steps.commits[0]?.outcome).toBe('error');
  });
});

describe(`decide: ${policy('decide')}`, () => {
  it('throw → the `ask` fallback; the turn replies', async () => {
    const { events, steps, result } = await run({ decide: { run: boom } });
    expect(events.at(-1)?.type).toBe('done');
    expect(steps.commits[0]?.decision?.move).toBe('ask');
    expect(outcomeOf(result, 'decide')).toBe('fallback');
    expect(result.trace?.move).toBe('ask');
  });

  it('timeout at 50 ms → the `ask` fallback', async () => {
    const { result } = await run({ decide: { run: hang() } });
    expect(result.trace?.steps.find((s) => s.name === 'decide')).toEqual({
      name: 'decide',
      ms: 50,
      outcome: 'fallback',
    });
  });

  it('an invalid decision → the `ask` fallback', async () => {
    const { result } = await run({
      decide: { run: () => Promise.resolve({ move: 'teleport' } as never) },
    });
    expect(outcomeOf(result, 'decide')).toBe('fallback');
  });

  it('a fallback that is not `ask` → provider_error', async () => {
    const { events, result } = await run({
      decide: { run: boom, fallback: () => ({ ...testAskDecision, move: 'solution' }) },
    });
    expect(events).toEqual([{ type: 'error', code: 'provider_error', retryable: true }]);
    expect(outcomeOf(result, 'decide')).toBe('failed');
    expect(result.background.map((b) => b.task)).toEqual(['runner']);
  });
});

describe(`generate: ${policy('generate')}`, () => {
  it('throw after streamed tokens → replace "" then one retry that succeeds', async () => {
    const { events, steps, result } = await run(
      {},
      { script: { stream: [scriptedStreamProviderError, scriptedStreamText] } },
    );
    expect(events).toEqual([
      { type: 'token', text: 'Partial' },
      { type: 'replace', text: '' },
      { type: 'token', text: 'What do you notice ' },
      { type: 'token', text: 'about the denominators?' },
      { type: 'done', messageId: 'message_1', usage: [usageMain] },
    ]);
    expect(
      steps.log.filter((l) => l.step === 'generate' && l.phase === 'start').map((l) => l.attempt),
    ).toEqual(['primary', 'fallback']);
    expect(outcomeOf(result, 'generate')).toBe('fallback');
  });

  it('a throw before any token retries without a replace', async () => {
    let n = 0;
    const { events } = await run({
      generate: (_env, _x, emit) => {
        if (++n === 1) return boom();
        emit({ type: 'token', text: 'hi' });
        return Promise.resolve({ draft: 'hi', usage: [] });
      },
    });
    expect(events.map((e) => e.type)).toEqual(['token', 'done']);
  });

  it('both attempts fail → apologetic error provider_error', async () => {
    const { events, steps, result } = await run({ generate: boom });
    expect(events).toEqual([{ type: 'error', code: 'provider_error', retryable: true }]);
    expect(outcomeOf(result, 'generate')).toBe('failed');
    expect(steps.commits[0]).toMatchObject({ outcome: 'error' });
    expect(ran(steps.log, 'postGuard')).toBe(false);
  });

  it('timeout is 15 s per attempt: a 14 s retry after a timed-out first attempt succeeds', async () => {
    let n = 0;
    const { events, result } = await run({
      generate: async (env) => {
        await env.deps.clock.sleep(++n === 1 ? 20_000 : 14_000);
        return { draft: 'ok', usage: [] };
      },
    });
    expect(events.at(-1)?.type).toBe('done');
    expect(result.trace?.steps.find((s) => s.name === 'generate')).toEqual({
      name: 'generate',
      ms: 29_000,
      outcome: 'fallback',
    });
  });

  it('TurnAbort(turn_cost_exceeded) ends the turn with that code and is not retried', async () => {
    const { events, steps } = await run({
      generate: () => Promise.reject(new TurnAbort('turn_cost_exceeded')),
    });
    expect(events).toEqual([{ type: 'error', code: 'turn_cost_exceeded', retryable: false }]);
    expect(steps.log.filter((l) => l.step === 'generate' && l.phase === 'start')).toHaveLength(1);
  });
});

describe(`postGuard: ${policy('postGuard')}`, () => {
  it('a replace verdict → replace with its text, then done', async () => {
    const { events, steps } = await run({
      postGuard: () =>
        Promise.resolve({
          result: 'replace',
          text: 'rewritten',
          guards: [{ name: 'answerLeak', ok: false, action: 'rewrite' }],
          usage: [usageSmall],
        }),
    });
    expect(events.slice(-2)).toEqual([
      { type: 'replace', text: 'rewritten' },
      { type: 'done', messageId: 'message_1', usage: [usageMain, usageSmall] },
    ]);
    expect(steps.commits[0]?.replyText).toBe('rewritten');
  });

  it('throw → replace with the safe reply (fail closed), then done', async () => {
    const { events, result, steps } = await run({ postGuard: boom });
    expect(events.slice(-2).map((e) => e.type)).toEqual(['replace', 'done']);
    expect(events.at(-2)).toEqual({ type: 'replace', text: TEST_SAFE_REPLY });
    expect(outcomeOf(result, 'postGuard')).toBe('fallback');
    expect(steps.commits[0]?.replyText).toBe(TEST_SAFE_REPLY);
  });

  it('timeout at 2 s → safe reply', async () => {
    const { timed } = await run({ postGuard: hang() });
    const replace = timed.find((x) => x.event.type === 'replace');
    expect(replace?.event).toEqual({ type: 'replace', text: TEST_SAFE_REPLY });
  });

  it('a throwing safe-reply text still replaces the draft (with empty text) and reports it', async () => {
    const t = testDeps({
      overrides: {
        fallbackReplies: {
          safeReply: () => {
            throw new Error('no text');
          },
          distress: () => TEST_DISTRESS_REPLY,
        },
      },
    });
    const steps = testSteps({ postGuard: boom });
    const { events, result } = await driveTurn(
      runTurn(demoTurnInput, { deps: t.deps, steps }),
      t.clock,
    );
    expect(events.at(-2)).toEqual({ type: 'replace', text: '' });
    expect(result.background.map((b) => b.task)).toEqual(['runner']);
  });
});

describe(`meter: ${policy('meter')}`, () => {
  it('throw → done still sent; reported in finished; trace says failed', async () => {
    const { events, result } = await run({ meter: boom });
    expect(events.at(-1)?.type).toBe('done');
    expect(result.background.map((b) => b.task)).toEqual(['meter']);
    expect(outcomeOf(result, 'meter')).toBe('failed');
  });

  it('a 10 s meter does not delay done', async () => {
    const { timed, result } = await run({ meter: hang(10_000) });
    const doneAt = timed.at(-1)?.at ?? Infinity;
    expect(doneAt).toBeLessThan(VIRTUAL_EPOCH_MS + 1_000);
    expect(result.trace?.steps.find((s) => s.name === 'meter')).toEqual({
      name: 'meter',
      ms: 10_000,
      outcome: 'ok',
    });
  });

  it('is skipped when there is no usage', async () => {
    const { steps, result } = await run(
      {},
      { script: { stream: [{ steps: [{ type: 'text', text: 'hi' }] }] } },
    );
    expect(ran(steps.log, 'meter')).toBe(false);
    expect(outcomeOf(result, 'meter')).toBeUndefined();
  });
});

describe(`commit: ${policy('commit')}`, () => {
  it('throw → done still sent; reported in finished; trace still recorded with commit failed', async () => {
    const { events, result, t } = await run({ commit: boom });
    expect(events.at(-1)?.type).toBe('done');
    expect(result.background.map((b) => b.task)).toEqual(['commit']);
    expect((t.traces.records[0] as TurnTrace).steps.at(-1)).toMatchObject({
      name: 'commit',
      outcome: 'failed',
    });
  });

  it('runs for every turn that passed entitle, even blocked and errored ones', async () => {
    for (const o of [{ preGuard: boom }, { generate: boom }, { scrub: boom }] as StepOverrides[]) {
      const { steps, t } = await run(o);
      expect(steps.commits).toHaveLength(1);
      expect(t.traces.records).toHaveLength(1);
    }
  });

  it('a slow commit does not delay done', async () => {
    const t = testDeps();
    const steps = testSteps({ commit: hang(30_000) });
    const timed = await driveEvents(runTurn(demoTurnInput, { deps: t.deps, steps }), t.clock);
    expect((timed.at(-1)?.event as TurnEvent).type).toBe('done');
    expect(timed.at(-1)?.at).toBeLessThan(VIRTUAL_EPOCH_MS + 1_000);
  });
});

describe('trace sink failures', () => {
  it('a failing TraceSink is reported in finished, never thrown into the stream', async () => {
    const t = testDeps();
    t.deps.traces = { record: () => Promise.reject(new Error('down')) };
    const { events, result } = await driveTurn(
      runTurn(demoTurnInput, { deps: t.deps, steps: testSteps() }),
      t.clock,
    );
    expect(events.at(-1)?.type).toBe('done');
    expect(result.background.map((b) => b.task)).toEqual(['trace']);
    expect(result.trace).not.toBeNull();
  });
});
