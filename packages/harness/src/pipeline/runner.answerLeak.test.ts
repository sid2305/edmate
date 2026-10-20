// Task 4.5 through the runner: the real generate (sentence gate) and the real postGuard. The
// student sees only the hint (or the checked rewrite), `replace ''` comes first, and history keeps
// the replacement. A post guard's escalate ends the turn with the caring template. Keys synthetic.
import type { ModelChunk, PedagogyDecision, TurnEvent } from '@edmate/contracts';
import {
  demoPedagogyDecision,
  demoSafetyAlert,
  demoTurnInput,
  usageMain,
  usageSmall,
} from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { ANSWER_LEAK_SAFE_HINT } from '../guardrails/answerLeak.js';
import { driveTurn } from '../testing/driveTurn.js';
import { FIXTURE_PROMPT_PACK_VERSION } from '../testing/promptPackFixtures.js';
import type { ScriptedStreamCall } from '../testing/scriptedGateway.js';
import { TEST_CARING_REPLY, testDecideResult, testDeps, testSteps } from '../testing/testSteps.js';
import { passThroughGate } from './generate/streamGate.js';
import { runTurn } from './runner.js';
import { defaultSteps } from './steps/index.js';
import type { PipelineDeps, Steps } from './types.js';

const decision: PedagogyDecision = { ...demoPedagogyDecision, move: 'ask', mustNotReveal: ['16'] };
const say = (text: string) => ({ type: 'text', text }) satisfies ModelChunk;
const main = (...steps: ScriptedStreamCall['steps']): ScriptedStreamCall => ({
  match: (r) => r.tier === 'main',
  steps,
});
const small = (...steps: ScriptedStreamCall['steps']): ScriptedStreamCall => ({
  match: (r) => r.tier === 'small',
  steps,
});

const fixtureEntitle: Steps['entitle'] = async (env) => {
  const e = await testSteps().entitle(env);
  return { ...e, agent: { ...e.agent, promptPackVersion: FIXTURE_PROMPT_PACK_VERSION } };
};

async function turn(stream: ScriptedStreamCall[], overrides: Partial<PipelineDeps> = {}) {
  const t = testDeps({ script: { stream }, overrides, judge: 'grounded' });
  const steps = testSteps({
    entitle: fixtureEntitle,
    decide: { run: () => Promise.resolve(testDecideResult(decision)) },
    generate: defaultSteps.generate,
    postGuard: defaultSteps.postGuard,
  });
  const { events, result } = await driveTurn(
    runTurn(demoTurnInput, { deps: t.deps, steps }),
    t.clock,
  );
  return { events, result, steps, t };
}

/** Every token the student saw before the first replace. */
const shownBeforeReplace = (events: TurnEvent[]): string => {
  const at = events.findIndex((e) => e.type === 'replace');
  return events
    .slice(0, at < 0 ? undefined : at)
    .map((e) => (e.type === 'token' ? e.text : ''))
    .join('');
};

describe('runner + answerLeak', () => {
  it("a withheld leak: the student sees the clean sentence, then replace '' and the hint", async () => {
    const { events, steps, result } = await turn([
      main(say('Good question. '), say('The answer is 16. '), say('Keep going.'), {
        type: 'usage',
        usage: usageMain,
      }),
    ]);
    expect(events).toEqual([
      { type: 'token', text: 'Good question. ' },
      { type: 'replace', text: '' },
      { type: 'replace', text: ANSWER_LEAK_SAFE_HINT },
      { type: 'done', messageId: 'message_1', usage: [usageMain] },
    ]);
    expect(shownBeforeReplace(events)).not.toContain('16');
    expect(steps.commits[0]?.replyText).toBe(ANSWER_LEAK_SAFE_HINT);
    expect(result.trace?.guards).toContainEqual({
      name: 'answerLeak',
      ok: false,
      action: 'rewrite',
    });
  });

  it('a leak the gate let through (pass-through gate) is rewritten once; history keeps the rewrite', async () => {
    const { events, steps } = await turn(
      [
        main(say('x is 16.'), { type: 'usage', usage: usageMain }),
        small(say('Try the last line again.'), { type: 'usage', usage: usageSmall }),
      ],
      { streamGate: passThroughGate },
    );
    expect(events).toEqual([
      { type: 'token', text: 'x is 16.' },
      { type: 'replace', text: '' },
      { type: 'replace', text: 'Try the last line again.' },
      // The rewrite's usage, then grounding's judge's (4.7).
      { type: 'done', messageId: 'message_1', usage: [usageMain, usageSmall, usageSmall] },
    ]);
    expect(steps.commits[0]?.replyText).toBe('Try the last line again.');
  });

  it('a clean reply is untouched: no replace', async () => {
    const { events, steps } = await turn([
      main(say('Trace each line. '), say('What is x after line two?'), {
        type: 'usage',
        usage: usageMain,
      }),
    ]);
    expect(events.map((e) => e.type)).toEqual(['token', 'token', 'done']);
    expect(steps.commits[0]?.replyText).toBe('Trace each line. What is x after line two?');
  });

  it("a post guard escalate: replace '', then the caring template and the alert", async () => {
    const t = testDeps({ script: { stream: [main(say('Hello.'))] } });
    const steps = testSteps({
      entitle: fixtureEntitle,
      generate: defaultSteps.generate,
      postGuard: () =>
        Promise.resolve({
          result: 'escalate',
          alert: demoSafetyAlert,
          text: 'never shown',
          guards: [{ name: 'tone', ok: false, action: 'escalate' }],
          usage: [],
        }),
    });
    const { events } = await driveTurn(runTurn(demoTurnInput, { deps: t.deps, steps }), t.clock);
    expect(events.slice(-5)).toEqual([
      { type: 'token', text: 'Hello.' },
      { type: 'replace', text: '' },
      { type: 'safety', level: 'alert' },
      { type: 'token', text: TEST_CARING_REPLY },
      { type: 'done', messageId: 'message_1', usage: [] },
    ]);
    expect(JSON.stringify(events)).not.toContain('never shown');
    expect(steps.commits[0]).toMatchObject({
      outcome: 'escalated',
      replyText: TEST_CARING_REPLY,
      escalatedText: 'never shown',
    });
    expect(t.alerts.raised).toEqual([demoSafetyAlert]);
  });

  it('a postGuard step that throws is reported by kind and error name, then the safe reply', async () => {
    const t = testDeps({ script: { stream: [main(say('Hello.'))] } });
    const steps = testSteps({
      entitle: fixtureEntitle,
      generate: defaultSteps.generate,
      postGuard: () => Promise.reject(new TypeError('quotes the reply: Hello.')),
    });
    const { result } = await driveTurn(runTurn(demoTurnInput, { deps: t.deps, steps }), t.clock);
    expect(result.background.map((b) => String(b.error))).toEqual([
      'PostGuardStepFailed: postGuard failed: error (TypeError)',
    ]);
    expect(steps.commits[0]).not.toHaveProperty('escalatedText');
  });
});
