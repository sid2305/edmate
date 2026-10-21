// Property (task 5.4), a whole turn: real admit, entitle, buildContext, decide and generate over
// the scripted gateway and a spy, with a random entitlement, tool registry and (honest or hostile)
// index. No model request (system, messages, tools) holds the text of a chunk outside the allowed
// modules; every offered tool's skill is entitled; a tool the model names but was not offered
// never runs. Seeded PRNG, no fast-check (1.2 decision).
import type {
  Chunk,
  Entitlement,
  EntitlementStore,
  ModelChunk,
  RetrievalIndex,
  Skill,
  TurnConfigStore,
} from '@edmate/contracts';
import {
  demoAgentConfig,
  demoEntitlementSubscription,
  demoLocalePack,
  demoPackagePaid,
  demoStyleCard,
  demoTurnInput,
  learnerProfileNew,
  usageMain,
} from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { runTurn } from '../pipeline/runner.js';
import { admit } from '../pipeline/steps/admit.js';
import { buildContext } from '../pipeline/steps/buildContext.js';
import { decide } from '../pipeline/steps/decide.js';
import { entitle } from '../pipeline/steps/entitle.js';
import { generate } from '../pipeline/steps/generate.js';
import { driveTurn } from '../testing/driveTurn.js';
import {
  junkProbeRetrieval,
  MARKED_MODULES,
  MARKED_VOCAB,
  markedWorld,
  markOf,
  textLeakingRetrieval,
  wideningRetrieval,
} from '../testing/hostileRetrieval.js';
import { memoryTranscriptStore } from '../testing/memoryPorts.js';
import { memoryRetrieval } from '../testing/memoryRetrieval.js';
import { memoryToolRegistry, testTool } from '../testing/memoryToolRegistry.js';
import { type Prng, prng } from '../testing/prng.js';
import { FIXTURE_PROMPT_PACK_VERSION } from '../testing/promptPackFixtures.js';
import type { StreamStep } from '../testing/scriptedGateway.js';
import { testDeps, testSteps } from '../testing/testSteps.js';

const SEED = 20261020;
const ITERATIONS = 200;
const TEST_TIMEOUT_MS = 120_000;
const log = (s: string): void =>
  (globalThis as { console?: { log(s: string): void } }).console?.log(s);

const TEACHERS = ['tch_test_01', 'tch_test_02', 'tch_test_03'];
const SKILLS: Skill[] = ['explain', 'coach', 'practice', 'feedback', 'revision', 'study_plan'];
const TOOL_NAMES = ['calculator', 'flashcards', 'quiz', 'planner'];
const KINDS = ['honest', 'widen', 'leakText', 'junkProbe'] as const;
type Kind = (typeof KINDS)[number];

const subset = <T>(r: Prng, xs: readonly T[], p: number): T[] => xs.filter(() => r.chance(p));

function randomEntitlement(r: Prng): Entitlement {
  const pool = [...MARKED_MODULES];
  const allowed = subset(r, pool, 0.5);
  const locked = pool.filter((m) => !allowed.includes(m));
  const skills = subset(r, SKILLS, 0.5);
  return {
    ...demoEntitlementSubscription,
    allowedModuleIds: allowed,
    lockedModuleIds: locked,
    skills: skills.length > 0 ? skills : ['coach'],
  };
}

function indexFor(kind: Kind, r: Prng, chunks: readonly Chunk[]): RetrievalIndex {
  switch (kind) {
    case 'honest':
      return memoryRetrieval({ chunks });
    case 'widen':
      return wideningRetrieval(chunks);
    case 'leakText':
      return textLeakingRetrieval(chunks);
    case 'junkProbe':
      return junkProbeRetrieval(chunks, {
        hit: r.chance(0.5),
        score: 0.5,
        text: r.pick(chunks).text,
      });
  }
}

const say = (text: string) => ({ type: 'text', text }) satisfies ModelChunk;
const used = { type: 'usage', usage: usageMain } satisfies ModelChunk;

interface Turn {
  e: Entitlement;
  chunks: Chunk[];
  kind: Kind;
  text: string;
  tools: { name: string; skill: Skill }[];
  call: string | undefined;
  pkgVersion: number;
}

function randomTurn(r: Prng): Turn {
  const chunks = markedWorld(r, TEACHERS);
  const names = subset(r, TOOL_NAMES, 0.5);
  return {
    e: randomEntitlement(r),
    chunks,
    kind: r.pick(KINDS),
    text: Array.from({ length: 1 + r.int(3) }, () => r.pick(MARKED_VOCAB)).join(' '),
    tools: names.map((name) => ({ name, skill: r.pick(SKILLS) })),
    call: r.chance(0.6) ? r.pick([...TOOL_NAMES, 'not_a_tool']) : undefined,
    pkgVersion: demoPackagePaid.version,
  };
}

async function run(turn: Turn) {
  const e = { ...turn.e, packageVersion: turn.pkgVersion };
  const first: StreamStep[] = [
    say('Look at the denominators first, then compare them. '),
    ...(turn.call === undefined
      ? []
      : [{ type: 'tool_call', id: 'call_1', name: turn.call, args: {} } satisfies ModelChunk]),
    used,
  ];
  const second: StreamStep[] = [say('What do you notice about the two numbers?'), used];
  const t = testDeps({
    script: { stream: [{ steps: first }, { steps: second }, { steps: second }] },
  });
  const entitlements: EntitlementStore = {
    resolve: (x) =>
      Promise.resolve(x.studentId === e.studentId && x.agentId === e.agentId ? { ...e } : null),
  };
  const turnConfig: TurnConfigStore = {
    load: () =>
      Promise.resolve({
        agent: {
          ...demoAgentConfig,
          languages: ['en'],
          promptPackVersion: FIXTURE_PROMPT_PACK_VERSION,
        },
        pkg: {
          ...demoPackagePaid,
          version: turn.pkgVersion,
          moduleIds: [...MARKED_MODULES],
          skills: [...SKILLS],
        },
        styleCard: demoStyleCard,
        locale: demoLocalePack,
        helpState: null,
      }),
  };
  const tools = memoryToolRegistry(
    turn.tools.map((x) =>
      testTool({ name: x.name, skill: x.skill, run: () => Promise.resolve({ value: 'six' }) }),
    ),
  );
  const deps = {
    ...t.deps,
    entitlements,
    turnConfig,
    retrieval: indexFor(turn.kind, prng(turn.chunks.length), turn.chunks),
    tools,
    profiles: {
      get: (studentId: string, teacherId: string) =>
        Promise.resolve({ ...learnerProfileNew, studentId, teacherId }),
      applyEvidence: () => Promise.reject(new Error('unused')),
    },
    transcripts: memoryTranscriptStore(),
  };
  const steps = testSteps({ admit, entitle, buildContext, decide, generate });
  const input = { ...demoTurnInput, text: turn.text };
  const { events, result } = await driveTurn(runTurn(input, { deps, steps }), t.clock);
  return { e, events, result, requests: t.gateway.requests, tools };
}

describe('access property: whole turn (task 5.4)', () => {
  it(
    `${String(ITERATIONS)} random turns never send an out-of-scope chunk or unentitled tool`,
    async () => {
      const r = prng(SEED);
      const tally: Record<string, number> = {};
      const count = (k: string) => (tally[k] = (tally[k] ?? 0) + 1);
      for (let i = 0; i < ITERATIONS; i++) {
        const at = `seed ${String(SEED)} iteration ${String(i)}`;
        const turn = randomTurn(r);
        const { e, events, requests, tools } = await run(turn);
        const allowed = new Set(e.allowedModuleIds);
        const marks = turn.chunks
          .filter((c) => c.teacherId !== e.teacherId || !allowed.has(c.moduleId))
          .map((c) => markOf(c.id));
        const sent = JSON.stringify([requests, events]);
        for (const m of marks) expect(sent.includes(m), `${at}: leaked ${m}`).toBe(false);

        const skillOf = new Map(turn.tools.map((x) => [x.name, x.skill]));
        for (const req of requests) {
          for (const offered of req.tools ?? []) {
            const skill = skillOf.get(offered.name);
            expect(skill, `${at}: offered ${offered.name}`).toBeDefined();
            expect(e.skills, `${at}: offered ${offered.name}`).toContain(skill);
            count('offered');
          }
        }
        for (const ran of tools.runs) {
          expect(e.skills, `${at}: ran ${ran.name}`).toContain(skillOf.get(ran.name));
          const offeredNames = (requests[0]?.tools ?? []).map((x) => x.name);
          expect(offeredNames, `${at}: ran ${ran.name} unoffered`).toContain(ran.name);
          count('ran');
        }
        if (turn.call !== undefined && tools.runs.length === 0) count('call_not_run');
        const last = events.at(-1);
        count(`${turn.kind}:${last?.type === 'error' ? last.code : (last?.type ?? 'none')}`);
        if (sent.includes('MARK_')) count('in_scope_text_sent');
      }
      log(`access turn property: seed ${String(SEED)}, ${JSON.stringify(tally)}`);
      expect(tally.in_scope_text_sent ?? 0).toBeGreaterThan(0);
      expect(tally.offered ?? 0).toBeGreaterThan(0);
      expect(tally.ran ?? 0).toBeGreaterThan(0);
      expect(tally.call_not_run ?? 0).toBeGreaterThan(0);
    },
    TEST_TIMEOUT_MS,
  );

  it('a package version change alone changes the prompt cache key', async () => {
    const turn = randomTurn(prng(SEED));
    const keys: (string | undefined)[] = [];
    for (const v of [2, 3]) {
      const { requests } = await run({ ...turn, kind: 'honest', call: undefined, pkgVersion: v });
      expect(requests.length).toBeGreaterThan(0);
      keys.push(requests[0]?.cacheKey);
    }
    expect(keys[0]).toBeDefined();
    expect(keys[1]).toBeDefined();
    expect(keys[0]).not.toBe(keys[1]);
  });
});
