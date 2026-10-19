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
  HISTORY_FETCH_LIMIT,
  HISTORY_MAX_CHARS,
  MAX_CONTEXT_CHARS,
  RETRIEVAL_K,
  RetrievalScopeError,
} from './buildContext.js';
import { WITHHELD_MESSAGE } from '../policies.js';
import { historyChars } from './historyTrim.js';

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
  it('every search carries the entitlement teacher and allowed modules, k = RETRIEVAL_K', async () => {
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

  it('the query adds the latest agent question, so a bare "42" still retrieves', async () => {
    const r = memoryRetrieval({ chunks: retrievalWorld() });
    const history = [msg(1, 'agent', 'Add fractions with a common denominator: 1/2 + 1/3?')];
    const b = await run(world({ retrieval: r, history }), ENTITLED, {
      ...demoTurnInput,
      text: '42',
    });
    expect(r.searches.map((s) => s.q)).toEqual([
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
    };
    await expect(run(world({ retrieval: r }))).rejects.toThrow('index down');
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
  };

  it('parses the raw help state from Entitled into helpRung and helpState', async () => {
    const b = await run(world(), { ...ENTITLED, helpState: stored });
    expect(b.helpRung).toBe(2);
    expect(b.helpState).toEqual({
      stuckTurns: 1,
      attemptLogged: true,
      pendingCheck: false,
      answerKey: ['5/6'],
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
