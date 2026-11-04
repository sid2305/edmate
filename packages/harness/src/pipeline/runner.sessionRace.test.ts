// Task 4.7b Phase D: two turns for the same session must never both read `groundingAsks` before
// either saves it (the accept line's own example: at `groundingAsks` 2, two concurrent ungrounded
// turns open at most one question). `runTurn`'s per-session queue (`runner.ts`) is what's tested
// here; the cap itself (one question per session) is already 4.7's `runner.grounding.test.ts`.
import type { ModelChunk, PedagogyDecision, TurnEvent } from '@edmate/contracts';
import {
  demoChunkScored,
  demoPedagogyDecision,
  demoTurnInput,
  learnerProfileNew,
  usageMain,
} from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { copyHelp, INITIAL_HELP_STATE, parseSessionHelp } from '../pedagogy/helpState.js';
import {
  memorySessionStateStore,
  memoryTeacherQuestionStore,
  memoryTranscriptStore,
} from '../testing/memoryPorts.js';
import type { StreamStep } from '../testing/scriptedGateway.js';
import { testDecideResult, testDeps, testSteps } from '../testing/testSteps.js';
import { FIXTURE_PROMPT_PACK_VERSION } from '../testing/promptPackFixtures.js';
import { VIRTUAL_EPOCH_MS } from '../testing/virtualClock.js';
import { cancelSource, type Cancel } from './clock.js';
import { createSessionTurnQueue, runTurn, sessionQueueSizeForTest } from './runner.js';
import { GROUNDING_ASKS_PER_SESSION } from './spec.js';
import { defaultSteps } from './steps/index.js';
import type { Steps } from './types.js';

const say = (text: string) => ({ type: 'text', text }) satisfies ModelChunk;
const used = { type: 'usage', usage: usageMain } satisfies ModelChunk;
const fail = { type: 'error', code: 'provider_error' } satisfies StreamStep;
const explain: PedagogyDecision = { ...demoPedagogyDecision, move: 'explain', mustNotReveal: [] };

async function drain(events: AsyncIterable<TurnEvent>): Promise<TurnEvent[]> {
  const out: TurnEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

/**
 * A fresh `PipelineDeps` object literal per `run()` call (mirroring the real caller,
 * `apps/web/src/turn/routes.ts`'s per-turn `turnDepsFor`), all sharing one `turnQueue` (fix round
 * 1: the queue serialising same-session turns lives on this field now, not on `deps` identity),
 * and a shared help-state store whose current `groundingAsks` `buildContext` reads fresh on
 * every call (a test double standing in for `entitle`'s real `turnConfig.load` +
 * `buildContext`'s own decode, out of this phase's scope: only the dynamic *read* matters for
 * proving the race, and `runner.ts` itself computes the saved value from it). `streams`: one
 * `StreamStep[]` per turn this test will run, consumed in call order (`ScriptedGateway` matches
 * FIFO).
 */
function sessionDeps(initialAsks: number, streams: StreamStep[][]) {
  const store = memoryTeacherQuestionStore();
  const sessionState = memorySessionStateStore();
  const t = testDeps({
    script: { stream: streams.map((steps) => ({ match: (r) => r.tier === 'main', steps })) },
    judge: 'ungrounded',
    overrides: { teacherQuestions: store, sessionState, transcripts: memoryTranscriptStore() },
  });
  const currentAsks = (): number => {
    const last = sessionState.saved.at(-1);
    return last === undefined
      ? initialAsks
      : (parseSessionHelp(last.helpState).help.groundingAsks ?? 0);
  };
  const steps: Steps = testSteps({
    entitle: async (env) => {
      const e = await testSteps().entitle(env);
      return { ...e, agent: { ...e.agent, promptPackVersion: FIXTURE_PROMPT_PACK_VERSION } };
    },
    buildContext: () =>
      Promise.resolve({
        profile: learnerProfileNew,
        history: [],
        retrieved: [{ ...demoChunkScored, text: 'Floor division rounds down.', score: 0.8 }],
        lockedHit: false,
        helpRung: 0,
        helpState: { ...copyHelp(INITIAL_HELP_STATE), groundingAsks: currentAsks() },
      }),
    decide: {
      run: () => Promise.resolve(testDecideResult(explain, { sources: [demoChunkScored.source] })),
    },
    generate: defaultSteps.generate,
    postGuard: defaultSteps.postGuard,
    commit: defaultSteps.commit,
  });
  const run = (sessionId: string, text: string, cancel?: Cancel) =>
    runTurn(
      { ...demoTurnInput, sessionId, text },
      // A fresh `PipelineDeps` object literal every call (not `t.deps` itself), same as the real
      // caller builds one per turn; only `turnQueue` (and every other field) is shared by value.
      { deps: { ...t.deps }, steps, ...(cancel === undefined ? {} : { cancel }) },
    );
  /** Like `run`, but the given `deps` replaces `t.deps.turnQueue` (the boundary test). */
  const runWith = (
    sessionId: string,
    text: string,
    turnQueue: ReturnType<typeof createSessionTurnQueue>,
  ) => runTurn({ ...demoTurnInput, sessionId, text }, { deps: { ...t.deps, turnQueue }, steps });
  return { t, store, sessionState, run, runWith };
}

describe('runner: per-session turn queue (4.7b Phase D)', () => {
  it('two concurrent ungrounded turns at the cap - 1 open at most one question', async () => {
    const { t, store, sessionState, run } = sessionDeps(GROUNDING_ASKS_PER_SESSION - 1, [
      [say('Python 4 makes // exact.'), used],
      [say('Python 4 makes // exact.'), used],
    ]);
    const a = run('session_race', 'first');
    const b = run('session_race', 'second');
    await t.clock.drive(Promise.all([drain(a.events), a.finished, drain(b.events), b.finished]));
    expect(store.opened).toHaveLength(1);
    expect(sessionState.saved).toHaveLength(2);
    const asks = sessionState.saved.map((s) => parseSessionHelp(s.helpState).help.groundingAsks);
    expect(asks.sort()).toEqual([GROUNDING_ASKS_PER_SESSION, GROUNDING_ASKS_PER_SESSION]);
    expect(sessionQueueSizeForTest(t.deps.turnQueue)).toBe(0);
  });

  it('documents the boundary: two turns with separate queues are not serialised', async () => {
    // Same shape as the first test (two concurrent ungrounded turns at the cap), but each turn
    // gets its own, independent `createSessionTurnQueue()` instead of sharing one — the boundary
    // this fix does not and cannot cover (e.g. two different worker processes). Both turns race
    // `groundingAsks` exactly as before this fix: both read "still under the cap" and both save
    // past it, so two `TeacherQuestion`s open, not one.
    const { t, store, sessionState, runWith } = sessionDeps(GROUNDING_ASKS_PER_SESSION - 1, [
      [say('Python 4 makes // exact.'), used],
      [say('Python 4 makes // exact.'), used],
    ]);
    const a = runWith('session_unshared', 'first', createSessionTurnQueue());
    const b = runWith('session_unshared', 'second', createSessionTurnQueue());
    await t.clock.drive(Promise.all([drain(a.events), a.finished, drain(b.events), b.finished]));
    expect(store.opened).toHaveLength(2);
    expect(sessionState.saved).toHaveLength(2);
  });

  it('a later turn (not concurrent) behaves as before: at the cap, the reply only', async () => {
    const { t, store, run } = sessionDeps(GROUNDING_ASKS_PER_SESSION, [
      [say('Python 4 makes // exact.'), used],
      [say('Python 4 makes // exact.'), used],
    ]);
    const a = run('session_seq', 'first');
    await t.clock.drive(Promise.all([drain(a.events), a.finished]));
    expect(store.opened).toHaveLength(0);
    const b = run('session_seq', 'second');
    await t.clock.drive(Promise.all([drain(b.events), b.finished]));
    expect(store.opened).toHaveLength(0);
  });

  it('two different sessions, run concurrently, do not wait on one another', async () => {
    const { t, run } = sessionDeps(0, [
      [say('Floor division rounds down [1].'), used],
      [{ type: 'delay', ms: 5_000 }, say('Floor division rounds down [1].'), used],
    ]);
    // Session two's stream is delayed. If the queue wrongly serialised across sessions, session
    // one (no delay) would still be waiting on it; instead it finishes well before the delay
    // elapses, proving the two chains run independently.
    const a = run('session_one', 'first');
    const b = run('session_two', 'second');
    const [eventsA] = await t.clock.drive(Promise.all([drain(a.events), a.finished]));
    expect(eventsA.at(-1)?.type).toBe('done');
    // Session one finished well before session two's 5s delay could have fired: the two
    // sessions' chains ran independently, not one serialised behind the other.
    expect(t.clock.now() - VIRTUAL_EPOCH_MS).toBeLessThan(5_000);
    await t.clock.drive(Promise.all([drain(b.events), b.finished]));
    expect(sessionQueueSizeForTest(t.deps.turnQueue)).toBe(0);
  });

  it('many sessions, one turn each: the queue ends empty (no leaked entries)', async () => {
    const stream = [say('Floor division rounds down [1].'), used] satisfies StreamStep[];
    const { t, run } = sessionDeps(
      0,
      Array.from({ length: 5 }, () => stream),
    );
    const runs = Array.from({ length: 5 }, (_, i) =>
      run(`session_${String(i)}`, `msg${String(i)}`),
    );
    await t.clock.drive(Promise.all(runs.flatMap((r) => [drain(r.events), r.finished])));
    expect(sessionQueueSizeForTest(t.deps.turnQueue)).toBe(0);
  });

  it('a turn that throws (both generate attempts fail) still releases the next same-session turn', async () => {
    const { t, run } = sessionDeps(0, [
      [fail],
      [fail],
      [say('Floor division rounds down [1].'), used],
    ]);
    const bad = run('session_err', 'bad');
    const r1 = await t.clock.drive(Promise.all([drain(bad.events), bad.finished]));
    expect(r1[0].at(-1)?.type).toBe('error');
    const ok = run('session_err', 'ok');
    const r2 = await t.clock.drive(Promise.all([drain(ok.events), ok.finished]));
    expect(r2[0].at(-1)?.type).toBe('done');
    expect(sessionQueueSizeForTest(t.deps.turnQueue)).toBe(0);
  });

  it('a turn cancelled by its caller (RunTurnOptions.cancel) still releases the next same-session turn', async () => {
    const { t, run } = sessionDeps(0, [
      [say('Python '), { type: 'delay', ms: 100 }, say('4 makes // exact.'), used],
      [say('Floor division rounds down [1].'), used],
    ]);
    const abandon = cancelSource();
    const a = run('session_cancel', 'first', abandon.token);
    abandon.cancel(); // the caller detaches before the turn starts streaming.
    await t.clock.drive(Promise.all([drain(a.events), a.finished]));
    const b = run('session_cancel', 'second');
    const r = await t.clock.drive(Promise.all([drain(b.events), b.finished]));
    expect(r[0].at(-1)?.type).toBe('done');
    expect(sessionQueueSizeForTest(t.deps.turnQueue)).toBe(0);
  });
});
