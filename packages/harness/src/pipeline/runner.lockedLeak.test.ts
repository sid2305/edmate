// Task 4.6 through the runner: the real generate (answer gate, then the locked stream check) and
// the real postGuard (lockedLeak, then answerLeak), with the in-memory index over synthetic
// material (retrievalWorld: mod_test_04 is locked for the subscription entitlement). The student
// never sees a locked span, the model never receives one from a tool, and history keeps only the
// locked reply.
import type { ModelChunk, PedagogyDecision, TurnEvent } from '@edmate/contracts';
import {
  demoPedagogyDecision,
  demoSafetyAlert,
  demoTurnInput,
  usageMain,
} from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { LockedLeakDetected, lockedReplyText } from '../guardrails/lockedLeak.js';
import { driveTurn } from '../testing/driveTurn.js';
import { memoryRetrieval, retrievalWorld } from '../testing/memoryRetrieval.js';
import { memoryToolRegistry, testTool } from '../testing/memoryToolRegistry.js';
import { FIXTURE_PROMPT_PACK_VERSION } from '../testing/promptPackFixtures.js';
import type { ScriptedStreamCall } from '../testing/scriptedGateway.js';
import { TEST_SAFE_REPLY, testDecideResult, testDeps, testSteps } from '../testing/testSteps.js';
import type { HelpState } from '../pedagogy/helpState.js';
import { type CancelToken, cancelSource } from './clock.js';
import { runTurn } from './runner.js';
import { defaultSteps } from './steps/index.js';
import type { BuiltContext, PipelineDeps, PostGuardResult, Steps } from './types.js';

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
  cancel?: CancelToken,
) {
  const retrieval = memoryRetrieval({ chunks: retrievalWorld() });
  const t = testDeps({
    script: { stream },
    overrides: { retrieval, ...overrides },
    judge: 'grounded',
  });
  const steps = testSteps({
    entitle: fixtureEntitle,
    decide: { run: () => Promise.resolve(testDecideResult(decision)) },
    generate: defaultSteps.generate,
    postGuard: defaultSteps.postGuard,
    ...stepOverrides,
  });
  const { events, result } = await driveTurn(
    runTurn(demoTurnInput, { deps: t.deps, steps, ...(cancel === undefined ? {} : { cancel }) }),
    t.clock,
  );
  return { events, result, steps, t, retrieval };
}

/** A built context for the test student, with the given stored help state (rung 2). */
function builtWith(help: Partial<HelpState>, extra: Partial<BuiltContext> = {}): BuiltContext {
  return {
    profile: {
      studentId: 'stu_test_01',
      teacherId: 'tch_test_01',
      lang: 'en',
      mastery: {},
      mistakes: [],
    },
    history: [],
    retrieved: [],
    lockedHit: false,
    helpRung: 2,
    helpState: { stuckTurns: 0, attemptLogged: false, pendingCheck: false, answerKey: [], ...help },
    ...extra,
  };
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

  it('a session that already stopped keeps the flag when decide saves a reset help state', async () => {
    // testDecideResult's `next` is INITIAL_HELP_STATE (lockedStopped false), like a correct
    // practice answer (skills.ts practiceCheck) or decide's fallback: the runner forces it back.
    const { steps } = await turn(
      [main(say('This is a perfectly clean reply, with enough words. '), used)],
      {},
      { buildContext: () => Promise.resolve(builtWith({ lockedStopped: true })) },
    );
    expect(steps.commits[0]?.outcome).toBe('replied');
    expect(steps.commits[0]?.next?.help.lockedStopped).toBe(true);
  }, 10_000);

  it('reports name the site only', () => {
    expect(String(new LockedLeakDetected('tool'))).toBe(
      'LockedLeakDetected: locked material withheld (tool)',
    );
  }, 5_000);
});

// 4.6b fix round 1 (safety review findings 1 and 2): the runner owns the session's stop flag. A
// trip anywhere in the turn (any attempt, the stream, a tool output or the post guard) sets it on
// every outcome that saves a help state, and nothing decide or a skill returns clears it.
describe('runner: the session stop flag (ADR-0007 §8, 4.6b fix round 1)', () => {
  const CLEAN = 'A clean answer with plenty of ordinary words in it. ';
  const tripsPostGuard =
    (action: 'rewrite' | 'failed'): Steps['postGuard'] =>
    () =>
      Promise.resolve({
        result: 'replace',
        text: REPLY,
        guards: [{ name: 'lockedLeak', ok: false, action }],
        usage: [],
      } satisfies PostGuardResult);
  const escalatingPostGuard =
    (guard: 'lockedLeak' | 'tone'): Steps['postGuard'] =>
    () =>
      Promise.resolve({
        result: 'escalate',
        alert: demoSafetyAlert,
        text: 'never shown',
        guards: [
          guard === 'lockedLeak'
            ? { name: 'lockedLeak', ok: false, action: 'rewrite' }
            : { name: 'tone', ok: false, action: 'escalate' },
        ],
        usage: [],
      } satisfies PostGuardResult);

  it('a trip then a cancel keeps the flag on the saved (error) help state', async () => {
    const c = cancelSource();
    const { steps } = await turn(
      [main(say(`Here it is: ${LOCKED} `), say('More words follow here. '), used)],
      {},
      {
        generate: (env, x, emit) =>
          defaultSteps.generate(
            env,
            {
              ...x,
              onLockedTrip: () => {
                x.onLockedTrip?.();
                c.cancel();
              },
            },
            emit,
          ),
      },
      c.token,
    );
    expect(steps.commits[0]?.outcome).toBe('error');
    expect(steps.commits[0]?.next?.help.lockedStopped).toBe(true);
  }, 10_000);

  it('a trip on the primary, a provider error, then a clean fallback keeps the flag', async () => {
    const { steps, events } = await turn([
      main(say(`Here it is: ${LOCKED} `), say('More. '), { type: 'error', code: 'provider_error' }),
      main(say(CLEAN), used),
    ]);
    expect(steps.commits[0]?.outcome).toBe('replied');
    expect(steps.commits[0]?.replyText).toBe(CLEAN);
    expect(events.at(-1)).toMatchObject({ type: 'done' });
    expect(steps.commits[0]?.next?.help.lockedStopped).toBe(true);
  }, 10_000);

  it.each(['rewrite', 'failed'] as const)(
    'a locked %s caught only by the post guard sets the flag',
    async (action) => {
      const { steps } = await turn([main(say(CLEAN), used)], {}, {
        postGuard: tripsPostGuard(action),
      });
      expect(steps.commits[0]?.next?.help.lockedStopped).toBe(true);
    },
    10_000,
  );

  it('a post-guard escalate after a locked hit saves the loaded state with the flag set', async () => {
    const { steps } = await turn([main(say(CLEAN), used)], {}, {
      buildContext: () => Promise.resolve(builtWith({ stuckTurns: 1, answerKey: ['k'] })),
      postGuard: escalatingPostGuard('lockedLeak'),
    });
    expect(steps.commits[0]?.outcome).toBe('escalated');
    // The loaded rung and help state, untouched, plus the flag: the ladder does not move.
    expect(steps.commits[0]?.next).toEqual({
      rung: 2,
      help: {
        stuckTurns: 1,
        attemptLogged: false,
        pendingCheck: false,
        answerKey: ['k'],
        lockedStopped: true,
      },
    });
  }, 10_000);

  it('a post-guard step that times out counts as a locked trip (fail closed, 4.6c)', async () => {
    const { steps, result } = await turn([main(say(CLEAN), used)], {}, {
      postGuard: () => new Promise<PostGuardResult>(() => undefined),
    });
    expect(steps.commits[0]?.next?.help.lockedStopped).toBe(true);
    expect(result.background.map((b) => String(b.error))).toContain(
      'PostGuardStepFailed: postGuard failed: timeout',
    );
  }, 10_000);

  it('a post-guard escalate with no locked trip saves no help state (as before)', async () => {
    const { steps } = await turn([main(say(CLEAN), used)], {}, {
      postGuard: escalatingPostGuard('tone'),
    });
    expect(steps.commits[0]?.outcome).toBe('escalated');
    expect(steps.commits[0]?.next).toBeUndefined();
  }, 10_000);

  it('a clean turn in a fresh session saves the flag false', async () => {
    const { steps } = await turn([main(say(CLEAN), used)]);
    expect(steps.commits[0]?.next?.help.lockedStopped).toBe(false);
  }, 10_000);

  const TWO = ['One two three four five six seven eight. ', 'Nine ten eleven twelve. '];

  it('a buildContext timeout runs holdAll and does not write the help state', async () => {
    const { steps, events } = await turn([main(say(TWO[0] ?? ''), say(TWO[1] ?? ''), used)], {}, {
      buildContext: () => new Promise<BuiltContext>(() => undefined),
    });
    expect(steps.commits[0]?.outcome).toBe('replied');
    // One token event: the whole reply at the clean end, never piece by piece.
    expect(events.filter((e) => e.type === 'token')).toEqual([
      { type: 'token', text: TWO.join('') },
    ]);
    expect(steps.commits[0]?.next).toBeUndefined();
  }, 10_000);

  it('an unreadable stored help state runs holdAll and does not write the help state', async () => {
    const { steps, events, result } = await turn(
      [main(say(TWO[0] ?? ''), say(TWO[1] ?? ''), used)],
      {},
      {
        buildContext: () =>
          Promise.resolve(builtWith({}, { helpRung: 0, helpStateUnreadable: true })),
      },
    );
    expect(events.filter((e) => e.type === 'token')).toEqual([
      { type: 'token', text: TWO.join('') },
    ]);
    expect(steps.commits[0]?.next).toBeUndefined();
    // 4.6c: reported once per turn, by kind only, never the stored blob.
    expect(result.background.map((b) => String(b.error))).toEqual([
      'HelpStateUnreadable: session help state could not be read; holding this turn closed',
    ]);
  }, 10_000);

  it('an unreadable help state with a locked trip still writes nothing (never false over true)', async () => {
    const { steps } = await turn([main(say(`Here it is: ${LOCKED} `), used)], {}, {
      buildContext: () => Promise.resolve(builtWith({}, { helpRung: 0, helpStateUnreadable: true })),
    });
    expect(steps.commits[0]?.replyText).toBe(REPLY);
    expect(steps.commits[0]?.next).toBeUndefined();
  }, 10_000);
});
