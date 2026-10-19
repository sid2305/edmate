// Task 4.6 through the runner: the real generate (answer gate, then the locked stream check) and
// the real postGuard (lockedLeak, then answerLeak), with the in-memory index over synthetic
// material (retrievalWorld: mod_test_04 is locked for the subscription entitlement). The student
// never sees a locked span, the model never receives one from a tool, and history keeps only the
// locked reply.
import type { ModelChunk, PedagogyDecision, TurnEvent } from '@edmate/contracts';
import { demoPedagogyDecision, demoTurnInput, usageMain } from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { LockedLeakDetected, lockedReplyText } from '../guardrails/lockedLeak.js';
import { driveTurn } from '../testing/driveTurn.js';
import { memoryRetrieval, retrievalWorld } from '../testing/memoryRetrieval.js';
import { memoryToolRegistry, testTool } from '../testing/memoryToolRegistry.js';
import { FIXTURE_PROMPT_PACK_VERSION } from '../testing/promptPackFixtures.js';
import type { ScriptedStreamCall } from '../testing/scriptedGateway.js';
import { TEST_SAFE_REPLY, testDecideResult, testDeps, testSteps } from '../testing/testSteps.js';
import { runTurn } from './runner.js';
import { defaultSteps } from './steps/index.js';
import type { PipelineDeps, Steps } from './types.js';

const LOCKED = 'Integration by parts: choose u and dv, then integrate.';
// The subscription package is "Full course" with lockedReply generic: no name.
const REPLY = lockedReplyText();
const decision: PedagogyDecision = {
  ...demoPedagogyDecision,
  move: 'ask',
  mustNotReveal: [],
  tools: ['notes'],
};
const say = (text: string) => ({ type: 'text', text }) satisfies ModelChunk;
const used = { type: 'usage', usage: usageMain } satisfies ModelChunk;
const callNotes = { type: 'tool_call', id: 'c1', name: 'notes', args: {} } satisfies ModelChunk;
const main = (...steps: ScriptedStreamCall['steps']): ScriptedStreamCall => ({
  match: (r) => r.tier === 'main',
  steps,
});

const fixtureEntitle: Steps['entitle'] = async (env) => {
  const e = await testSteps().entitle(env);
  return { ...e, agent: { ...e.agent, promptPackVersion: FIXTURE_PROMPT_PACK_VERSION } };
};

function notesTool(output: unknown) {
  return testTool({
    name: 'notes',
    skill: 'coach',
    run: () => Promise.resolve(output),
    present: (o) => ({ skill: 'coach', payload: o }),
  });
}

async function turn(
  stream: ScriptedStreamCall[],
  overrides: Partial<PipelineDeps> = {},
  stepOverrides: Partial<Parameters<typeof testSteps>[0]> = {},
) {
  const retrieval = memoryRetrieval({ chunks: retrievalWorld() });
  const t = testDeps({ script: { stream }, overrides: { retrieval, ...overrides } });
  const steps = testSteps({
    entitle: fixtureEntitle,
    decide: { run: () => Promise.resolve(testDecideResult(decision)) },
    generate: defaultSteps.generate,
    postGuard: defaultSteps.postGuard,
    ...stepOverrides,
  });
  const { events, result } = await driveTurn(
    runTurn(demoTurnInput, { deps: t.deps, steps }),
    t.clock,
  );
  return { events, result, steps, t, retrieval };
}

const shownBeforeReplace = (events: TurnEvent[]): string => {
  const at = events.findIndex((e) => e.type === 'replace');
  return events
    .slice(0, at < 0 ? undefined : at)
    .map((e) => (e.type === 'token' ? e.text : ''))
    .join('');
};

describe('runner + lockedLeak', () => {
  it("a streamed locked span: clean sentences, then replace '' and the locked reply", async () => {
    const { events, steps, result } = await turn([
      main(say('Good question. '), say(`Here it is: ${LOCKED} `), say('Hope that helps.'), used),
    ]);
    // 4.6b: "Good question. " is under 8 tokens, so the locked stream holds it back rather than
    // showing it at once; the next batch trips, so it is never released. `clearAll` still sends
    // `replace ''` unconditionally before the locked reply.
    expect(events).toEqual([
      { type: 'replace', text: '' },
      { type: 'replace', text: REPLY },
      { type: 'done', messageId: 'message_1', usage: [usageMain] },
    ]);
    expect(shownBeforeReplace(events)).not.toContain('Integration');
    expect(steps.commits[0]?.replyText).toBe(REPLY);
    expect(result.trace?.guards).toContainEqual({
      name: 'lockedLeak',
      ok: false,
      action: 'rewrite',
    });
    expect(result.background.map((b) => String(b.error))).toContain(
      'LockedLeakDetected: locked material withheld (stream)',
    );
    expect(JSON.stringify(result.trace)).not.toContain('Integration');
    expect(JSON.stringify(result.background.map((b) => String(b.error)))).not.toContain(
      'Integration',
    );
  }, 10_000);

  it('a locked span in a tool output never reaches the model or the screen', async () => {
    const { events, t, result } = await turn(
      [main(callNotes, used), main(say('Let us look at what you know.'), used)],
      { tools: memoryToolRegistry([notesTool({ text: LOCKED })]) },
    );
    expect(JSON.stringify(t.gateway.requests)).not.toContain('Integration');
    expect(events.some((e) => e.type === 'skill')).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: 'done' });
    expect(result.background.map((b) => String(b.error))).toContain(
      'ToolFailed: tool "notes" failed: locked',
    );
  }, 10_000);

  it('a clean tool output still shows its skill event; a clean reply is untouched', async () => {
    const { events, steps, retrieval } = await turn(
      [main(callNotes, used), main(say('Think about equal parts. '), say('What is a half?'), used)],
      { tools: memoryToolRegistry([notesTool({ text: 'Halves are equal parts.' })]) },
    );
    expect(events.map((e) => e.type)).toEqual(['skill', 'token', 'token', 'done']);
    expect(steps.commits[0]?.replyText).toBe('Think about equal parts. What is a half?');
    // Each scope is the entitlement's own: teacher and allowed modules, never the client's.
    for (const c of retrieval.leakChecks) {
      expect(c.scope).toEqual({
        teacherId: 'tch_test_01',
        allowedModuleIds: ['mod_test_01', 'mod_test_02', 'mod_test_03'],
      });
    }
  }, 10_000);

  it('an index that is down fails closed: nothing shown, the safe reply', async () => {
    const down = memoryRetrieval({ chunks: [], leakCheck: new Error('index down') });
    const { events, steps } = await turn(
      [main(say('This is a perfectly clean reply with enough words. '), used)],
      { retrieval: down },
    );
    expect(shownBeforeReplace(events)).toBe('');
    expect(events.at(-2)).toEqual({ type: 'replace', text: TEST_SAFE_REPLY });
    expect(steps.commits[0]?.replyText).toBe(TEST_SAFE_REPLY);
  }, 10_000);

  it('mutation sanity: with the check stubbed to "no hit", the span would reach the student', async () => {
    const retrieval = memoryRetrieval({ chunks: retrievalWorld(), leakCheck: false });
    const { events } = await turn([main(say(`Here it is: ${LOCKED}`), used)], { retrieval });
    expect(events.map((e) => (e.type === 'token' ? e.text : '')).join('')).toContain(LOCKED);
  }, 10_000);

  it('a locked hit sets lockedStopped on the saved help state, for the rest of the session', async () => {
    const { steps } = await turn([
      main(say('Good question. '), say(`Here it is: ${LOCKED} `), say('Hope that helps.'), used),
    ]);
    expect(steps.commits[0]?.next?.help.lockedStopped).toBe(true);
  }, 10_000);

  it('ADR-0007 §8 (4.6b): once the session stopped, a later clean reply streams only at the end', async () => {
    const { events } = await turn(
      [main(say('This is a perfectly clean reply, with enough words. '), used)],
      {},
      {
        buildContext: () =>
          Promise.resolve({
            profile: { studentId: 'stu_test_01', teacherId: 'tch_test_01', lang: 'en', mastery: {}, mistakes: [] },
            history: [],
            retrieved: [],
            lockedHit: false,
            helpRung: 0,
            helpState: {
              stuckTurns: 0,
              attemptLogged: false,
              pendingCheck: false,
              answerKey: [],
              lockedStopped: true,
            },
          }),
      },
    );
    // One token event only: the whole reply, released at the clean end, never piecemeal.
    expect(events.filter((e) => e.type === 'token')).toEqual([
      { type: 'token', text: 'This is a perfectly clean reply, with enough words. ' },
    ]);
  }, 10_000);

  it('reports name the site only', () => {
    expect(String(new LockedLeakDetected('tool'))).toBe(
      'LockedLeakDetected: locked material withheld (tool)',
    );
  }, 5_000);
});
