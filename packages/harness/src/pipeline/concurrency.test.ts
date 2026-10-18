// Accept: "steps 3, 4 and retrieval run concurrently" (build plan § Turn pipeline spec).
import { demoTurnInput } from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { driveTurn } from '../testing/driveTurn.js';
import { type StepLogEntry, testDeps, testSteps } from '../testing/testSteps.js';
import { VIRTUAL_EPOCH_MS } from '../testing/virtualClock.js';
import { runTurn } from './runner.js';
import type { StepEnv } from './types.js';

const at = (log: StepLogEntry[], step: string, phase: StepLogEntry['phase']) =>
  log.find((l) => l.step === step && l.phase === phase)?.at;

describe('steps 3, 4 and 6 run concurrently after the scrub', () => {
  it('decide starts at admit + entitle + 300 ms, not + 900 ms', async () => {
    const t = testDeps();
    const sleepy =
      <R>(r: R) =>
      async (env: StepEnv): Promise<R> => {
        await env.deps.clock.sleep(300);
        return r;
      };
    const steps = testSteps({
      admit: async (env) => env.deps.clock.sleep(10),
      entitle: async (env) => {
        await env.deps.clock.sleep(20);
        return testSteps().entitle(env);
      },
      preGuard: sleepy({ result: 'ok' as const, guards: [], usage: [] }),
      route: { run: sleepy({ intent: 'on_task' as const, attempt: 'none' as const, usage: [] }) },
      buildContext: async (env, e) => {
        await env.deps.clock.sleep(299); // inside its 300 ms budget
        return testSteps().buildContext(env, e);
      },
    });
    const { events, result } = await driveTurn(
      runTurn(demoTurnInput, { deps: t.deps, steps }),
      t.clock,
    );
    expect(events.at(-1)?.type).toBe('done');
    expect(at(steps.log, 'decide', 'start')).toBe(VIRTUAL_EPOCH_MS + 10 + 20 + 300);
    for (const s of ['preGuard', 'route', 'buildContext']) {
      expect(at(steps.log, s, 'start')).toBe(VIRTUAL_EPOCH_MS + 30);
    }
    expect(result.trace?.steps.every((s) => s.outcome === 'ok')).toBe(true);
  });

  it('barrier: each of the three waits for the other two to start, and all finish ok', async () => {
    const t = testDeps();
    const started = new Set<string>();
    const waiters: (() => void)[] = [];
    const barrier = async (name: string): Promise<void> => {
      started.add(name);
      if (started.size === 3) for (const w of waiters.splice(0)) w();
      else await new Promise<void>((resolve) => waiters.push(resolve));
    };
    const steps = testSteps({
      preGuard: async () => {
        await barrier('preGuard');
        return { result: 'ok', guards: [], usage: [] };
      },
      route: {
        run: async () => {
          await barrier('route');
          return { intent: 'on_task', attempt: 'none', usage: [] };
        },
      },
      buildContext: async (env, e) => {
        await barrier('buildContext');
        return testSteps().buildContext(env, e);
      },
    });
    const { events, result } = await driveTurn(
      runTurn(demoTurnInput, { deps: t.deps, steps }),
      t.clock,
    );
    expect(events.at(-1)?.type).toBe('done');
    const outcome = (n: string) => result.trace?.steps.find((s) => s.name === n)?.outcome;
    expect([outcome('preGuard'), outcome('route'), outcome('buildContext')]).toEqual([
      'ok',
      'ok',
      'ok',
    ]);
  });

  it('all three see the scrubbed text, and the scrub finished before any started', async () => {
    const t = testDeps();
    const steps = testSteps({
      scrub: async (env) => {
        await env.deps.clock.sleep(40);
        return { text: 'scrubbed text', guards: [] };
      },
    });
    await driveTurn(runTurn(demoTurnInput, { deps: t.deps, steps }), t.clock);
    const scrubEnd = at(steps.log, 'scrub', 'end') ?? Infinity;
    expect(steps.log.find((l) => l.step === 'scrub')?.text).toBe(demoTurnInput.text);
    for (const s of ['preGuard', 'route', 'buildContext', 'generate']) {
      const start = steps.log.find((l) => l.step === s && l.phase === 'start');
      expect(start?.text).toBe('scrubbed text');
      expect(start?.at ?? -Infinity).toBeGreaterThanOrEqual(scrubEnd);
    }
  });
});
