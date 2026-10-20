import type {
  Chunk,
  LearnerProfile,
  Message,
  ProfileStore,
  RetrievalIndex,
  TranscriptStore,
  TurnInput,
} from '@edmate/contracts';
import {
  demoAgentConfig,
  demoChunk,
  demoEntitlementSubscription,
  demoLearnerProfile,
  demoLocalePack,
  demoPackagePaid,
  demoStyleCard,
  demoTurnInput,
  learnerProfileNew,
} from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { coverageGate, DEFAULT_COVERAGE_THRESHOLD } from '../../pedagogy/coverage.js';
import { INITIAL_HELP_STATE } from '../../pedagogy/helpState.js';
import {
  memoryRetrieval,
  OUT_OF_SCOPE_TEXT,
  retrievalWorld,
} from '../../testing/memoryRetrieval.js';
import { stepEnvExtras, testDeps } from '../../testing/testSteps.js';
import { cancelSource } from '../clock.js';
import { BuiltContextSchema } from '../results.js';
import type { Entitled, PipelineDeps, StepEnv } from '../types.js';
import {
  buildContext,
  contextAnswerKeys,
  dropAnswerKeyChunks,
  HISTORY_FETCH_LIMIT,
  HISTORY_MAX_CHARS,
  MAX_CONTEXT_CHARS,
  RETRIEVAL_K,
  RetrievalScopeError,
} from './buildContext.js';
import { WITHHELD_MESSAGE, withheldMessage } from '../policies.js';
import { historyChars } from './historyTrim.js';
import { compileAnswerKeys } from '../generate/answerKey.js';

const ENTITLED: Entitled = {
  entitlement: demoEntitlementSubscription,
  agent: demoAgentConfig,
  pkg: demoPackagePaid,
  locale: demoLocalePack,
  styleCard: demoStyleCard,
};

const msg = (i: number, role: Message['role'], text: string): Message => ({
  id: `msg_${String(i).padStart(3, '0')}`,
  role,
  text,
  createdAt: '2026-10-18T10:00:00Z',
});

interface World {
  profileCalls: [string, string][];
  historyCalls: [string, number][];
  retrieval: RetrievalIndex & { searches?: unknown[]; probes?: unknown[] };
  deps: PipelineDeps;
}

function world(
  o: {
    profile?: LearnerProfile;
    history?: Message[];
    retrieval?: RetrievalIndex;
  } = {},
): World {
  const profileCalls: [string, string][] = [];
  const historyCalls: [string, number][] = [];
  const profiles: ProfileStore = {
    get(studentId, teacherId) {
      profileCalls.push([studentId, teacherId]);
      return Promise.resolve(o.profile ?? demoLearnerProfile);
    },
    applyEvidence: () => Promise.reject(new Error('not in buildContext')),
  };
  const transcripts: TranscriptStore = {
    history(sessionId, limit) {
      historyCalls.push([sessionId, limit]);
      return Promise.resolve(o.history ?? []);
    },
    append: () => Promise.reject(new Error('not in buildContext')),
  };
  const retrieval = o.retrieval ?? memoryRetrieval({ chunks: retrievalWorld() });
  const t = testDeps({ overrides: { profiles, transcripts, retrieval } });
  return { profileCalls, historyCalls, retrieval, deps: t.deps };
}

function env(deps: PipelineDeps, input: TurnInput = demoTurnInput): StepEnv {
  return { input, deps, cancel: cancelSource().token, turnId: 'turn_1', ...stepEnvExtras() };
}

const run = (w: World, s: Entitled = ENTITLED, input?: TurnInput) =>
  buildContext(env(w.deps, input), s);

describe('buildContext: profile and last summary', () => {
  it('loads the profile for this student and the entitled teacher; lastSummary is exactly it', async () => {
    const w = world();
    const b = await run(w);
    expect(w.profileCalls).toEqual([['stu_test_01', 'tch_test_01']]);
    expect(b.profile).toEqual(demoLearnerProfile);
    expect(b.profile.lastSummary).toBe(demoLearnerProfile.lastSummary);
  });

  it('no lastSummary when the profile has none', async () => {
    const b = await run(world({ profile: learnerProfileNew }));
    expect('lastSummary' in b.profile).toBe(false);
  });

  it("refuses another student's or teacher's profile (fail closed to the runner's fallback)", async () => {
    await expect(
      run(world({ profile: { ...learnerProfileNew, studentId: 'stu_x' } })),
    ).rejects.toThrow(/profile/);
    await expect(
      run(world({ profile: { ...learnerProfileNew, teacherId: 'tch_x' } })),
    ).rejects.toThrow(/profile/);
  });
});

describe('buildContext: history', () => {
  it(`fetches ${String(HISTORY_FETCH_LIMIT)} messages of this session and trims them`, async () => {
    const history = [msg(1, 'agent', 'What is 1/2 + 1/3?'), msg(2, 'student', 'not sure')];
    const w = world({ history });
    const b = await run(w);
    expect(w.historyCalls).toEqual([['ses_test_01', HISTORY_FETCH_LIMIT]]);
    expect(b.history).toEqual(history);
  });

  it('a withheld (blocked) student message is dropped from the history and the query (4.4 fix round)', async () => {
    const history = [
      msg(0, 'student', withheldMessage('jailbreak_override')),
      msg(1, 'student', WITHHELD_MESSAGE),
      msg(2, 'agent', 'My rules stay the same.'),
      msg(3, 'student', 'what is a list'),
    ];
    const b = await run(world({ history }));
    expect(b.history.map((m) => m.text)).toEqual(['My rules stay the same.', 'what is a list']);
  });

  it('a long history is trimmed oldest first and keeps the latest message', async () => {
    const history = Array.from({ length: 40 }, (_, i) =>
      msg(i, i % 2 === 0 ? 'agent' : 'student', `${String(i)} ${'z'.repeat(2000)}`),
    );
    const b = await run(world({ history }));
    expect(historyChars(b.history)).toBeLessThanOrEqual(HISTORY_MAX_CHARS);
    expect(b.history.at(-1)).toEqual(history.at(-1));
    expect(b.history.length).toBeLessThan(history.length);
  });
});

describe('buildContext: access-filtered retrieval (ADR-0003)', () => {
  it('with no agent history, one search carries the entitlement teacher and allowed modules, k = RETRIEVAL_K', async () => {
    const r = memoryRetrieval({ chunks: retrievalWorld() });
    await run(world({ retrieval: r }));
    expect(r.searches).toEqual([
      {
        q: demoTurnInput.text,
        scope: {
          teacherId: demoEntitlementSubscription.teacherId,
          allowedModuleIds: demoEntitlementSubscription.allowedModuleIds,
        },
        k: RETRIEVAL_K,
      },
    ]);
  });

  it('the query adds the latest agent question, so a bare "42" still retrieves (now via the context search, 3.4c)', async () => {
    const r = memoryRetrieval({ chunks: retrievalWorld() });
    const history = [msg(1, 'agent', 'Add fractions with a common denominator: 1/2 + 1/3?')];
    const b = await run(world({ retrieval: r, history }), ENTITLED, {
      ...demoTurnInput,
      text: '42',
    });
    expect(r.searches.map((s) => s.q)).toEqual([
      '42',
      '42\nAdd fractions with a common denominator: 1/2 + 1/3?',
    ]);
    expect(b.retrieved.length).toBeGreaterThan(0);
  });

  it('only allowed chunks come back; locked and other-teacher text never appears', async () => {
    const b = await run(world(), ENTITLED, {
      ...demoTurnInput,
      text: 'fractions common denominator integration by parts',
    });
    expect(b.retrieved.length).toBeGreaterThan(0);
    const allowed = new Set(demoEntitlementSubscription.allowedModuleIds);
    for (const c of b.retrieved) {
      expect(allowed.has(c.moduleId)).toBe(true);
      expect(c.teacherId).toBe('tch_test_01');
    }
    expect(b.lockedHit).toBe(true);
    expect(JSON.stringify(b)).not.toContain(OUT_OF_SCOPE_TEXT);
  });

  it.each([
    ['a locked module', { ...demoChunk, id: 'chk_leak', moduleId: 'mod_test_04' }],
    ['another teacher', { ...demoChunk, id: 'chk_leak', teacherId: 'tch_test_02' }],
  ])('an index that widens the scope (%s) is refused, never passed on', async (_l, leak) => {
    const leaky: RetrievalIndex = {
      search: () => Promise.resolve([demoChunk, { ...leak, text: OUT_OF_SCOPE_TEXT }]),
      probe: () => Promise.resolve({ hit: false, score: 0 }),
      leakCheck: () => Promise.resolve({ hit: false }),
    };
    await expect(run(world({ retrieval: leaky }))).rejects.toBeInstanceOf(RetrievalScopeError);
    await expect(run(world({ retrieval: leaky }))).rejects.not.toThrow(OUT_OF_SCOPE_TEXT);
  });

  it(`keeps at most RETRIEVAL_K chunks even if the index returns more`, async () => {
    const many: Chunk[] = Array.from({ length: 12 }, (_, i) => ({
      ...demoChunk,
      id: `chk_many_${String(i)}`,
    }));
    const r: RetrievalIndex = {
      search: () => Promise.resolve(many),
      probe: () => Promise.resolve({ hit: false, score: 0 }),
      leakCheck: () => Promise.resolve({ hit: false }),
    };
    const b = await run(world({ retrieval: r }));
    expect(b.retrieved.map((c) => c.id)).toEqual(many.slice(0, RETRIEVAL_K).map((c) => c.id));
  });

  it('no search and no probe when there is nothing to search for', async () => {
    const r = memoryRetrieval({ chunks: retrievalWorld() });
    const noText: TurnInput = { ...demoTurnInput };
    delete noText.text;
    const b = await run(world({ retrieval: r }), ENTITLED, { ...noText, kind: 'hint_request' });
    expect(r.searches).toEqual([]);
    expect(r.probes).toEqual([]);
    expect(b.retrieved).toEqual([]);
    expect(b.lockedHit).toBe(false);
  });

  it('a search failure rejects (the runner falls back to the ask_teacher context)', async () => {
    const r: RetrievalIndex = {
      search: () => Promise.reject(new Error('index down')),
      probe: () => Promise.resolve({ hit: false, score: 0 }),
      leakCheck: () => Promise.resolve({ hit: false }),
    };
    await expect(run(world({ retrieval: r }))).rejects.toThrow('index down');
  });

  it('dilution fixed (3.4c): the agent reply in history no longer drags a covered chunk below threshold', async () => {
    // The student's own words alone fully cover chk_world_02; a long, unrelated agent reply would
    // dilute the combined query's overlap on main, but the student-only search keeps the score.
    const r = memoryRetrieval({ chunks: retrievalWorld() });
    const history = [
      msg(1, 'agent', `Let's talk about something totally different for a long while: ${'z'.repeat(200)}`),
    ];
    const b = await run(world({ retrieval: r, history }), ENTITLED, {
      ...demoTurnInput,
      text: 'fractions name equal parts of a whole',
    });
    const own = b.retrieved.find((c) => c.id === 'chk_world_02');
    expect(own?.score).toBeGreaterThanOrEqual(0.5);
    expect(coverageGate(b, DEFAULT_COVERAGE_THRESHOLD)).toBeNull();
  });

  it('locked precedence (3.4c): a real locked request still ends locked even though the agent context alone would cover', async () => {
    // The student's own words hit the locked module; the agent's last question is on allowed
    // material. The context search would cover, but locked precedence means it never gets to.
    const r = memoryRetrieval({ chunks: retrievalWorld() });
    const history = [
      msg(1, 'agent', 'Fractions name equal parts of a whole; a common denominator is shared.'),
    ];
    const b = await run(world({ retrieval: r, history }), ENTITLED, {
      ...demoTurnInput,
      text: 'integration by parts: choose u and dv',
    });
    expect(b.lockedHit).toBe(true);
    expect(coverageGate(b, DEFAULT_COVERAGE_THRESHOLD)).toBe('locked');
    // found comes from the student-only search: no chunk from the agent-widened query leaks in.
    for (const c of b.retrieved) expect(c.moduleId).not.toBe('mod_test_02');
  });

  it('merges own and context searches by score, deduping by id, unscored last, capped at K', async () => {
    const shared: Chunk = { ...demoChunk, id: 'chk_shared', score: 0.4 };
    const ownOnly: Chunk = { ...demoChunk, id: 'chk_own', score: 0.9 };
    const ctxOnly: Chunk = { ...demoChunk, id: 'chk_ctx', score: 0.6 };
    const sharedBetter: Chunk = { ...shared, score: 0.7 };
    let call = 0;
    const r: RetrievalIndex = {
      search: () => {
        call += 1;
        return Promise.resolve(call === 1 ? [ownOnly, shared] : [ctxOnly, sharedBetter]);
      },
      probe: () => Promise.resolve({ hit: false, score: 0 }),
      leakCheck: () => Promise.resolve({ hit: false }),
    };
    const history = [msg(1, 'agent', 'a different question entirely')];
    const b = await run(world({ retrieval: r, history }));
    expect(b.retrieved.map((c) => c.id)).toEqual(['chk_own', 'chk_shared', 'chk_ctx']);
    expect(b.retrieved.find((c) => c.id === 'chk_shared')?.score).toBe(0.7);
  });

  it('a hint request with agent history: the context search runs (student text is blank, no probe)', async () => {
    const r = memoryRetrieval({ chunks: retrievalWorld() });
    const history = [msg(1, 'agent', 'A common denominator is a shared multiple.')];
    const noText: TurnInput = { ...demoTurnInput };
    delete noText.text;
    const b = await run(world({ retrieval: r, history }), ENTITLED, {
      ...noText,
      kind: 'hint_request',
    });
    expect(r.searches.map((s) => s.q)).toEqual(['A common denominator is a shared multiple.']);
    expect(r.probes).toEqual([]);
    expect(b.lockedHit).toBe(false);
    expect(b.retrieved.length).toBeGreaterThan(0);
  });

  it('stops before retrieval when the step was cancelled', async () => {
    const r = memoryRetrieval({ chunks: retrievalWorld() });
    const w = world({ retrieval: r });
    const c = cancelSource();
    c.cancel();
    await expect(buildContext({ ...env(w.deps), cancel: c.token }, ENTITLED)).rejects.toThrow(
      /cancelled/,
    );
    expect(r.searches).toEqual([]);
  });
});

describe('buildContext: locked probe (code-only, no text)', () => {
  it('probes the locked modules with the same query; lockedHit is the probe hit', async () => {
    const r = memoryRetrieval({ chunks: [], probe: { hit: true, score: 0.8 } });
    const b = await run(world({ retrieval: r }));
    expect(r.probes).toEqual([
      {
        q: demoTurnInput.text,
        scope: {
          teacherId: 'tch_test_01',
          moduleIds: demoEntitlementSubscription.lockedModuleIds,
        },
      },
    ]);
    expect(b.lockedHit).toBe(true);
  });

  it('a miss gives lockedHit false', async () => {
    const r = memoryRetrieval({ chunks: [], probe: { hit: false, score: 0.1 } });
    expect((await run(world({ retrieval: r }))).lockedHit).toBe(false);
  });

  it('skips the probe when nothing is locked', async () => {
    const r = memoryRetrieval({ chunks: retrievalWorld(), probe: { hit: true, score: 1 } });
    const all: Entitled = {
      ...ENTITLED,
      entitlement: { ...demoEntitlementSubscription, lockedModuleIds: [] },
    };
    const b = await run(world({ retrieval: r }), all);
    expect(r.probes).toEqual([]);
    expect(b.lockedHit).toBe(false);
  });

  it('a rogue probe that returns text: only `hit` is read, the text goes nowhere', async () => {
    const r = {
      search: () => Promise.resolve([]),
      probe: () => Promise.resolve({ hit: 'yes', score: 1, text: OUT_OF_SCOPE_TEXT }),
    } as unknown as RetrievalIndex;
    const b = await run(world({ retrieval: r }));
    expect(b.lockedHit).toBe(false); // only a real `true` counts
    expect(JSON.stringify(b)).not.toContain(OUT_OF_SCOPE_TEXT);
  });
});

describe('buildContext: style card and persona', () => {
  it('loads no style card (it is on Entitled, ADR-0004) and returns no styleCard field', async () => {
    const w = world();
    const b = await run(w);
    expect('styleCard' in b).toBe(false);
    expect(Object.keys(b).sort()).toEqual(
      ['helpRung', 'helpState', 'history', 'lockedHit', 'profile', 'retrieved'].sort(),
    );
  });

  it('persona is undefined, also for a mock_interview skill action (3.5 falls back to coach)', async () => {
    const b = await run(world(), ENTITLED, {
      ...demoTurnInput,
      kind: 'skill_action',
      skill: 'mock_interview',
    });
    expect(b.persona).toBeUndefined();
  });
});

describe('buildContext: session help state (ADR-0005)', () => {
  const stored = {
    v: 1,
    rung: 2,
    stuckTurns: 1,
    attemptLogged: true,
    pendingCheck: false,
    answerKey: ['5/6'],
    lockedStopped: false,
  };

  it('parses the raw help state from Entitled into helpRung and helpState', async () => {
    const b = await run(world(), { ...ENTITLED, helpState: stored });
    expect(b.helpRung).toBe(2);
    expect(b.helpState).toEqual({
      stuckTurns: 1,
      attemptLogged: true,
      pendingCheck: false,
      answerKey: ['5/6'],
      lockedStopped: false,
    });
  });

  it.each([
    ['missing', undefined],
    ['empty', {}],
    ['malformed', { ...stored, rung: 7 }],
    ['not an object', 'rung 4'],
  ])('%s → rung 0 and INITIAL_HELP_STATE', async (_l, raw) => {
    const b = await run(world(), { ...ENTITLED, helpState: raw });
    expect(b.helpRung).toBe(0);
    expect(b.helpState).toEqual(INITIAL_HELP_STATE);
  });

  it.each([
    ['malformed', { ...stored, rung: 7 }, true],
    ['not an object', 'rung 4', true],
    ['missing', undefined, false],
    ['empty (the column default)', {}, false],
    ['valid', stored, false],
  ])('%s → helpStateUnreadable %s (4.6b fix round 1)', async (_l, raw, unreadable) => {
    const b = await run(world(), { ...ENTITLED, helpState: raw });
    expect(b.helpStateUnreadable === true).toBe(unreadable);
    expect('helpStateUnreadable' in b).toBe(unreadable);
  });
});

describe('buildContext: never exceeds the model context', () => {
  it('many long messages and many large chunks still fit MAX_CONTEXT_CHARS', async () => {
    const history = Array.from({ length: HISTORY_FETCH_LIMIT }, (_, i) =>
      msg(i, i % 2 === 0 ? 'agent' : 'student', 'h'.repeat(5000)),
    );
    const big: Chunk[] = Array.from({ length: RETRIEVAL_K }, (_, i) => ({
      ...demoChunk,
      id: `chk_big_${String(i)}`,
      text: 'c'.repeat(9000 - i * 1000),
    }));
    const r: RetrievalIndex = {
      search: () => Promise.resolve(big),
      probe: () => Promise.resolve({ hit: false, score: 0 }),
      leakCheck: () => Promise.resolve({ hit: false }),
    };
    const b = await run(world({ history, retrieval: r }));
    const total = historyChars(b.history) + b.retrieved.reduce((n, c) => n + c.text.length, 0);
    expect(total).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
    expect(b.history.at(-1)?.id).toBe(history.at(-1)?.id);
    // Skips a chunk that doesn't fit but keeps a smaller later one (rank order otherwise).
    expect(b.retrieved.length).toBeGreaterThan(0);
    expect(BuiltContextSchema.safeParse(b).success).toBe(true);
  });

  it('a single huge latest message is cut, not dropped, and still fits', async () => {
    const history = [msg(1, 'agent', 'q'.repeat(MAX_CONTEXT_CHARS * 2))];
    const b = await run(world({ history }));
    expect(b.history).toHaveLength(1);
    expect(historyChars(b.history)).toBe(HISTORY_MAX_CHARS);
  });
});

describe('buildContext: answer keys never reach the model context (5.6a)', () => {
  const KEY = 'Mitochondria';
  const helpWith = (answerKey: string[]) => ({
    v: 1,
    rung: 2,
    stuckTurns: 0,
    attemptLogged: false,
    pendingCheck: false,
    answerKey,
  });
  const chunk = (id: string, text: string, score: number, source = demoChunk.source): Chunk => ({
    ...demoChunk,
    id,
    text,
    score,
    source,
  });
  const clean = chunk('chk_clean', 'CLEAN-MARKER cells have parts', 0.5);
  const poisoned = chunk('chk_poison', `POISON-MARKER the powerhouse is the ${KEY}`, 0.9);

  /** Own and context searches return fixed lists (call 1 own, call 2 context). */
  function twoSearches(own: Chunk[], ctx: Chunk[], hit = false) {
    let call = 0;
    const probes: string[] = [];
    const r: RetrievalIndex = {
      search: () => {
        call += 1;
        return Promise.resolve(call === 1 ? own : ctx);
      },
      probe: (q) => {
        probes.push(q);
        return Promise.resolve({ hit, score: hit ? 0.9 : 0 });
      },
      leakCheck: () => Promise.resolve({ hit: false }),
    };
    return { r, probes };
  }
  const agentAsked = [msg(1, 'agent', 'a different question entirely')];
  const withKey = (keys: string[]): Entitled => ({ ...ENTITLED, helpState: helpWith(keys) });

  it('(a) a held text key drops the chunk holding it, keeps the clean one, counts 1', async () => {
    const { r } = twoSearches([poisoned, clean], []);
    const b = await run(world({ retrieval: r }), withKey([KEY]));
    expect(b.retrieved.map((c) => c.id)).toEqual(['chk_clean']);
    expect(b.answerKeyDropped).toBe(1);
    expect(BuiltContextSchema.safeParse(b).success).toBe(true);
    expect(JSON.stringify(b.retrieved)).not.toContain(KEY);
  });

  it('(b) the key only in source.title or source.locator also drops', async () => {
    const t = chunk('chk_t', 'plain text', 0.8, { ...demoChunk.source, title: `${KEY} notes` });
    const l = chunk('chk_l', 'plain text', 0.7, { ...demoChunk.source, locator: `§ ${KEY}` });
    const { r } = twoSearches([t, l, clean], []);
    const b = await run(world({ retrieval: r }), withKey([KEY]));
    expect(b.retrieved.map((c) => c.id)).toEqual(['chk_clean']);
    expect(b.answerKeyDropped).toBe(2);
  });

  it('(c) a zero-width-split or base64 form of the key drops (the shared matcher)', async () => {
    const zw = chunk('chk_zw', 'it is the Mito\u200bchondria', 0.8);
    const b64 = chunk('chk_b64', 'decode dGhlIGFuc3dlciBpcyBNaXRvY2hvbmRyaWE= now', 0.7);
    const { r } = twoSearches([zw, b64, clean], []);
    const b = await run(world({ retrieval: r }), withKey([KEY]));
    expect(b.retrieved.map((c) => c.id)).toEqual(['chk_clean']);
    expect(b.answerKeyDropped).toBe(2);
  });

  it('(d) no held key: output as before, no answerKeyDropped', async () => {
    const { r } = twoSearches([poisoned, clean], []);
    const b = await run(world({ retrieval: r }), withKey([]));
    expect(b.retrieved.map((c) => c.id)).toEqual(['chk_poison', 'chk_clean']);
    expect('answerKeyDropped' in b).toBe(false);
  });

  it('(e) locked hit: lockedHit stays true, a dropped own chunk is not backfilled from ctx, one probe on the student words', async () => {
    const ctxClean = chunk('chk_ctx', 'CTX-MARKER more on cells', 0.6);
    const { r, probes } = twoSearches([poisoned, clean], [ctxClean], true);
    const b = await run(world({ retrieval: r, history: agentAsked }), withKey([KEY]));
    expect(b.lockedHit).toBe(true);
    expect(b.retrieved.map((c) => c.id)).toEqual(['chk_clean']);
    expect(b.answerKeyDropped).toBe(1);
    expect(probes).toEqual([demoTurnInput.text]);
  });

  it('(f) not locked: a ctx chunk fills the slot a dropped own chunk freed', async () => {
    const own = [poisoned, ...[1, 2, 3, 4].map((i) => chunk(`chk_o${String(i)}`, 'cells', 0.8))];
    const ctxClean = chunk('chk_ctx', 'CTX-MARKER more on cells', 0.7);
    const { r } = twoSearches(own, [ctxClean]);
    const b = await run(world({ retrieval: r, history: agentAsked }), withKey([KEY]));
    expect(b.retrieved).toHaveLength(RETRIEVAL_K);
    expect(b.retrieved.map((c) => c.id)).toContain('chk_ctx');
    expect(b.retrieved.map((c) => c.id)).not.toContain('chk_poison');
  });

  it('(g) a chunk found by both searches is dropped once and never comes back', async () => {
    const better = { ...poisoned, score: 0.99 };
    const { r } = twoSearches([poisoned, clean], [better]);
    const b = await run(world({ retrieval: r, history: agentAsked }), withKey([KEY]));
    expect(b.retrieved.map((c) => c.id)).toEqual(['chk_clean']);
    expect(b.answerKeyDropped).toBe(1);
  });

  it('(h) unreadable help state: fail closed, nothing retrieved, every found chunk counted', async () => {
    const { r } = twoSearches([poisoned, clean], [clean]);
    const b = await run(world({ retrieval: r, history: agentAsked }), {
      ...ENTITLED,
      helpState: 'rung 4',
    });
    expect(b.retrieved).toEqual([]);
    expect(b.helpStateUnreadable).toBe(true);
    expect(b.answerKeyDropped).toBe(2);
    expect(BuiltContextSchema.safeParse(b).success).toBe(true);
  });

  it('(h) unreadable help state with nothing found: no answerKeyDropped', async () => {
    const { r } = twoSearches([], []);
    const b = await run(world({ retrieval: r }), { ...ENTITLED, helpState: 'rung 4' });
    expect(b.retrieved).toEqual([]);
    expect('answerKeyDropped' in b).toBe(false);
  });

  it('(i) short numeric keys never drop chunks (lead answer, 20 Oct): "1", "one", "7", "42"', async () => {
    const loop = chunk('chk_loop', 'for i in range(1, 5): total = total + 7 * 42', 0.8);
    const { r } = twoSearches([loop, clean], []);
    const b = await run(world({ retrieval: r }), withKey(['1', 'one', '7', '42']));
    expect(b.retrieved.map((c) => c.id)).toEqual(['chk_loop', 'chk_clean']);
    expect('answerKeyDropped' in b).toBe(false);
  });

  it('(i) a 3-digit or non-integer numeric key still drops', async () => {
    const big = chunk('chk_big', 'the total is 120 marks', 0.8);
    const half = chunk('chk_half', 'half is 0.5 of a whole', 0.7);
    const { r } = twoSearches([big, half, clean], []);
    const b = await run(world({ retrieval: r }), withKey(['120', '0.5']));
    expect(b.retrieved.map((c) => c.id)).toEqual(['chk_clean']);
    expect(b.answerKeyDropped).toBe(2);
  });
});

describe('contextAnswerKeys and dropAnswerKeyChunks (5.6a)', () => {
  it.each([
    ['1', false],
    ['7', false],
    ['42', false],
    ['one', false],
    ['forty-two', false],
    [' 7 ', false],
    ['100', true],
    ['-5', true],
    ['0.5', true],
    ['5/6', true],
    ['Warm', true],
    ['ab', true],
    ['x1', true],
  ])('%j kept for context checks: %s', (key, kept) => {
    expect(contextAnswerKeys([key])).toEqual(kept ? [key] : []);
  });

  it('drops leaking chunks, keeps order, and reports the dropped ids', () => {
    const m = compileAnswerKeys(['Warm']);
    const a: Chunk = { ...demoChunk, id: 'chk_a', text: 'it is WARM.' };
    const c: Chunk = { ...demoChunk, id: 'chk_c', text: 'it is warmer' };
    const out = dropAnswerKeyChunks([a, c], m);
    expect(out.kept.map((x) => x.id)).toEqual(['chk_c']);
    expect([...out.dropped]).toEqual(['chk_a']);
  });

  it('an empty matcher keeps everything', () => {
    const out = dropAnswerKeyChunks([demoChunk], compileAnswerKeys([]));
    expect(out.kept).toEqual([demoChunk]);
    expect(out.dropped.size).toBe(0);
  });
});
