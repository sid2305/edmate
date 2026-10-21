import { TurnTraceSchema } from '@edmate/contracts';
import { demoSafetyAlert, demoTurnInput, usageMain } from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { driveTurn } from '../testing/driveTurn.js';
import { type StepOverrides, testDeps, testSteps } from '../testing/testSteps.js';
import { runTurn } from './runner.js';
import { STEP_NAMES } from './spec.js';
import { TraceBuilder } from './trace.js';
import type { StepEnv } from './types.js';

const sleepThen =
  <R>(ms: number, r: R) =>
  async (env: StepEnv): Promise<R> => {
    await env.deps.clock.sleep(ms);
    return r;
  };

async function traceOf(overrides: StepOverrides) {
  const t = testDeps();
  const steps = testSteps(overrides);
  const { result } = await driveTurn(runTurn(demoTurnInput, { deps: t.deps, steps }), t.clock);
  expect(t.traces.records).toHaveLength(1);
  const trace = t.traces.records[0];
  if (trace === undefined) throw new Error('no trace');
  expect(TurnTraceSchema.parse(trace)).toEqual(trace);
  expect(result.trace).toEqual(trace);
  return trace;
}

describe('trace capture', () => {
  it('lists steps in spec order, not completion order, with virtual ms', async () => {
    const trace = await traceOf({
      preGuard: sleepThen(250, { result: 'ok' as const, guards: [], usage: [] }),
      route: {
        run: sleepThen(200, { intent: 'on_task' as const, attempt: 'none' as const, usage: [] }),
      },
      buildContext: async (env, e) => {
        await env.deps.clock.sleep(10);
        return testSteps().buildContext(env, e);
      },
    });
    expect(trace.steps.map((s) => s.name)).toEqual([
      ...STEP_NAMES.filter((n) => n !== 'escalate'),
      'firstToken',
    ]);
    const ms = Object.fromEntries(trace.steps.map((s) => [s.name, s.ms]));
    expect(ms).toMatchObject({ preGuard: 250, route: 200, buildContext: 10, admit: 0 });
  });

  it('records firstToken only once a token streams, and omits it on a turn that never shows one', async () => {
    const streamed = await traceOf({});
    expect(streamed.steps.find((s) => s.name === 'firstToken')).toMatchObject({ outcome: 'ok' });
    expect(streamed.steps.find((s) => s.name === 'firstToken')?.ms).toBeGreaterThanOrEqual(0);

    const escalated = await traceOf({
      preGuard: () =>
        Promise.resolve({ result: 'escalate', alert: demoSafetyAlert, guards: [], usage: [] }),
    });
    expect(escalated.steps.find((s) => s.name === 'firstToken')).toBeUndefined();
  });

  it("preGuard's ms is the scrub plus the checks", async () => {
    const trace = await traceOf({
      scrub: async (env) => {
        await env.deps.clock.sleep(70);
        return { text: 'x', guards: [] };
      },
      preGuard: sleepThen(30, { result: 'ok' as const, guards: [], usage: [] }),
    });
    expect(trace.steps.find((s) => s.name === 'preGuard')?.ms).toBe(100);
  });

  it('an escalated turn has intent distress, move redirect and no 6-9 entries', async () => {
    const trace = await traceOf({
      preGuard: () =>
        Promise.resolve({ result: 'escalate', alert: demoSafetyAlert, guards: [], usage: [] }),
    });
    expect(trace).toMatchObject({ intent: 'distress', move: 'redirect' });
    expect(trace.steps.map((s) => s.name)).toEqual([
      'admit',
      'entitle',
      'preGuard',
      'route',
      'escalate',
      'buildContext',
      'commit',
    ]);
  });

  it("a blocked turn keeps route's intent and has move redirect", async () => {
    const trace = await traceOf({
      preGuard: () => Promise.resolve({ result: 'block', guards: [], usage: [] }),
      route: {
        run: () => Promise.resolve({ intent: 'misuse', attempt: 'none', usage: [] }),
      },
    });
    expect(trace).toMatchObject({ intent: 'misuse', move: 'redirect' });
  });

  it('carries no text: neither the input, the reply nor the agent fields', async () => {
    const trace = await traceOf({
      postGuard: () =>
        Promise.resolve({
          result: 'replace',
          text: 'rewritten reply',
          guards: [{ name: 'answerLeak', ok: false, action: 'rewrite' }],
          usage: [],
        }),
    });
    const json = JSON.stringify(trace);
    for (const text of [demoTurnInput.text, 'What do you notice', 'rewritten reply']) {
      expect(json).not.toContain(text);
    }
    expect(trace.usage).toEqual([usageMain]);
  });
});

describe('TraceBuilder', () => {
  it('adds ms for a repeated step, keeps the last outcome, and strips guard extras', () => {
    const b = new TraceBuilder();
    b.step('generate', 10, 'failed');
    b.step('generate', 5, 'fallback');
    b.step('admit', -3, 'ok');
    b.outcome('decide', 'fallback');
    b.addGuards([{ name: 'g', ok: true, extra: 'x' } as never]);
    const t = b.build({
      turnId: 't',
      sessionId: 's',
      agentVersion: 1,
      packageVersion: 1,
      intent: 'on_task',
      move: 'ask',
    });
    expect(t.steps).toEqual([
      { name: 'admit', ms: 0, outcome: 'ok' },
      { name: 'decide', ms: 0, outcome: 'fallback' },
      { name: 'generate', ms: 15, outcome: 'fallback' },
    ]);
    expect(t.guards).toEqual([{ name: 'g', ok: true }]);
  });

  it('markElapsed is idempotent: the first call wins and appears after the spec steps', () => {
    const b = new TraceBuilder();
    b.step('admit', 0, 'ok');
    b.markElapsed('firstToken', 120);
    b.markElapsed('firstToken', 9999);
    const t = b.build({
      turnId: 't',
      sessionId: 's',
      agentVersion: 1,
      packageVersion: 1,
      intent: 'on_task',
      move: 'ask',
    });
    expect(t.steps).toEqual([
      { name: 'admit', ms: 0, outcome: 'ok' },
      { name: 'firstToken', ms: 120, outcome: 'ok' },
    ]);
  });

  it('omits firstToken entirely when markElapsed was never called', () => {
    const b = new TraceBuilder();
    b.step('admit', 0, 'ok');
    const t = b.build({
      turnId: 't',
      sessionId: 's',
      agentVersion: 1,
      packageVersion: 1,
      intent: 'on_task',
      move: 'ask',
    });
    expect(t.steps.find((s) => s.name === 'firstToken')).toBeUndefined();
  });
});
