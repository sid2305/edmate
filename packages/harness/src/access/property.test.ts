// Property: whatever the stores return, entitle either refuses (`no_access` / `limit_reached`) or
// returns config that all belongs to the entitlement's teacher, matches its ids and versions, and
// never allows a module or skill beyond the package. Seeded PRNG, no fast-check (1.2 decision).
import type { Entitlement, EntitlementStore, TurnConfigStore, TurnInput } from '@edmate/contracts';
import { demoTurnInput, localePackMinimal } from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { cancelSource } from '../pipeline/clock.js';
import { TurnRejection } from '../pipeline/errors.js';
import { entitle } from '../pipeline/steps/entitle.js';
import type { Entitled } from '../pipeline/types.js';
import {
  type AccessOptions,
  memoryEntitlementStore,
  memoryTurnConfigStore,
  twoTeacherWorld,
} from '../testing/memoryAccess.js';
import { type Prng, prng } from '../testing/prng.js';
import { testDeps } from '../testing/testSteps.js';

/** Change the seed to explore; a failure prints it so the run can be replayed. */
const SEED = 20261018;
const ITERATIONS = 2_000;
/** 2,000 hostile-store turns took 5.1-5.8s on CI runners (well under 1s locally); give headroom. */
const TEST_TIMEOUT_MS = 30_000;
/** The harness lib has no DOM or Node types; vitest prints console output. */
const log = (s: string): void =>
  (globalThis as { console?: { log(s: string): void } }).console?.log(s);

const world = twoTeacherWorld();
const B = {
  agent: world.agents.find((a) => a.id === 'agt_b')!.versions[0]!,
  pkg: world.packages.find((p) => p.id === 'pkg_b')!,
  styleCard: world.styleCards.find((c) => c.id === 'sty_b')!,
};

/** Randomly corrupts an entitlement toward teacher B (or another student, or a frozen status). */
function hostileEntitlements(inner: EntitlementStore, r: Prng): EntitlementStore {
  return {
    async resolve(x, at) {
      const e = await inner.resolve(x, at);
      if (e === null || !r.chance(0.5)) return e;
      const swaps: ((e: Entitlement) => Entitlement)[] = [
        (e) => ({ ...e, teacherId: 'tch_b' }),
        (e) => ({ ...e, packageId: 'pkg_b', packageVersion: 1 }),
        (e) => ({ ...e, allowedModuleIds: [...e.allowedModuleIds, 'mod_b1'] }),
        (e) => ({
          ...e,
          allowedModuleIds: [...e.allowedModuleIds, ...e.lockedModuleIds],
          lockedModuleIds: [],
        }),
        (e) => ({ ...e, skills: [...e.skills, 'study_plan'] }),
        (e) => ({ ...e, studentId: 'stu_2' }),
        (e) => ({ ...e, agentId: 'agt_b' }),
        (e) => ({ ...e, status: r.pick(['paused', 'ended'] as const) }),
        (e) => ({ ...e, market: 'global' }),
      ];
      return r.pick(swaps)(e);
    },
  };
}

/** Randomly swaps in teacher B's objects, another market's pack or skips the session check. */
function hostileConfig(inner: TurnConfigStore, r: Prng): TurnConfigStore {
  return {
    async load(e, sessionId) {
      const cfg = await inner.load(e, sessionId);
      if (cfg === null || !r.chance(0.5)) return cfg;
      const swaps: ((c: NonNullable<typeof cfg>) => NonNullable<typeof cfg>)[] = [
        (c) => ({ ...c, agent: B.agent }),
        (c) => ({ ...c, agent: { ...c.agent, teacherId: 'tch_b' } }),
        (c) => ({ ...c, pkg: B.pkg }),
        (c) => ({ ...c, pkg: { ...c.pkg, teacherId: 'tch_b' } }),
        (c) => ({ ...c, pkg: { ...c.pkg, moduleIds: ['mod_b1'] } }),
        (c) => ({ ...c, pkg: { ...c.pkg, version: c.pkg.version + 1 } }),
        (c) => ({ ...c, styleCard: B.styleCard }),
        (c) => ({ ...c, locale: localePackMinimal }),
      ];
      return r.pick(swaps)(cfg);
    },
  };
}

const STUDENTS = ['stu_1', 'stu_2', 'stu_eval', 'tch_a', 'tch_b'];
const AGENTS = ['agt_a', 'agt_a_draft', 'agt_b', 'agt_b_susp', 'agt_nowhere'];
const SESSIONS = [...world.sessions.map((s) => s.id), 'ses_nowhere'];
const SOURCES = ['subscription', 'teacher_preview', 'eval'] as const;

const COHERENT = [
  { source: 'subscription', studentId: 'stu_1', agentId: 'agt_a', sessionId: 'ses_1a' },
  { source: 'subscription', studentId: 'stu_2', agentId: 'agt_a', sessionId: 'ses_2a' },
  { source: 'subscription', studentId: 'stu_2', agentId: 'agt_b', sessionId: 'ses_2b' },
  { source: 'teacher_preview', studentId: 'tch_a', agentId: 'agt_a', sessionId: 'ses_preview_a' },
  { source: 'eval', studentId: 'stu_eval', agentId: 'agt_a', sessionId: 'ses_eval_a' },
] as const;
const COHERENT_OPTS: AccessOptions = {
  market: 'IN',
  preview: { packageId: 'pkg_a' },
  eval: { teacherId: 'tch_a', packageId: 'pkg_a', version: 2, market: 'IN' },
};

function optionsFor(r: Prng): AccessOptions {
  return {
    market: r.pick(['IN', 'US', 'global']),
    preview: { packageId: r.pick(['pkg_a', 'pkg_a_draft', 'pkg_b']) },
    eval: {
      teacherId: r.pick(['tch_a', 'tch_b']),
      packageId: r.pick(['pkg_a', 'pkg_b']),
      version: r.pick([1, 2]),
      market: r.pick(['IN', 'ZZ']),
    },
  };
}

function checkInvariant(out: Entitled, input: TurnInput) {
  const { entitlement: e, agent, pkg, styleCard, locale } = out;
  expect(e.studentId).toBe(input.studentId);
  expect(e.agentId).toBe(input.agentId);
  expect(['paused', 'ended']).not.toContain(e.status);
  expect([agent.teacherId, pkg.teacherId, styleCard.teacherId]).toEqual([
    e.teacherId,
    e.teacherId,
    e.teacherId,
  ]);
  expect(agent.id).toBe(e.agentId);
  expect([pkg.id, pkg.version, pkg.agentId]).toEqual([e.packageId, e.packageVersion, e.agentId]);
  expect(styleCard.id).toBe(agent.styleCardId);
  expect(locale.market).toBe(e.market);
  for (const m of e.allowedModuleIds) expect(pkg.moduleIds).toContain(m);
  for (const s of e.skills) expect(pkg.skills).toContain(s);
  // Nothing of the other teacher's.
  const other = e.teacherId === 'tch_a' ? 'tch_b' : 'tch_a';
  expect(JSON.stringify(out)).not.toContain(`"${other}"`);
  // The session row: the entitlement's own, open, and the agent at its pinned version.
  const session = world.sessions.find((s) => s.id === input.sessionId);
  expect(session).toMatchObject({
    studentId: e.studentId,
    teacherId: e.teacherId,
    agentId: e.agentId,
    endedAt: null,
    agentVersion: agent.version,
  });
}

describe('entitle property: fail closed or return only what the entitlement owns', () => {
  it(
    `${ITERATIONS} random turns against hostile stores (seed ${SEED})`,
    async () => {
      log(`[access property] seed ${SEED}`);
      const r = prng(SEED);
      const tally: Record<string, number> = {};
      for (let i = 0; i < ITERATIONS; i++) {
        // Half the turns start from a coherent (source, student, agent, session); half are random.
        const coherent = r.chance(0.5) ? r.pick(COHERENT) : null;
        const source = coherent?.source ?? r.pick(SOURCES);
        const opts = coherent && r.chance(0.8) ? COHERENT_OPTS : optionsFor(r);
        const w = twoTeacherWorld();
        const t = testDeps({
          overrides: {
            entitlementSource: source,
            entitlements: hostileEntitlements(memoryEntitlementStore(w, opts), r),
            turnConfig: hostileConfig(memoryTurnConfigStore(w), r),
          },
        });
        const input: TurnInput = {
          ...demoTurnInput,
          studentId: coherent?.studentId ?? r.pick(STUDENTS),
          agentId: coherent?.agentId ?? r.pick(AGENTS),
          sessionId: coherent && r.chance(0.8) ? coherent.sessionId : r.pick(SESSIONS),
        };
        let outcome: string;
        try {
          const out = await entitle({
            input,
            deps: t.deps,
            cancel: cancelSource().token,
            turnId: `turn_${i}`,
          });
          checkInvariant(out, input);
          outcome = `${source}:ok`;
        } catch (err) {
          if (!(err instanceof TurnRejection)) throw err;
          expect(['no_access', 'limit_reached']).toContain(err.code);
          outcome = err.code;
        }
        tally[outcome] = (tally[outcome] ?? 0) + 1;
      }
      log(`[access property] outcomes ${JSON.stringify(tally)}`);
      // The generator reaches acceptance for every source, not only refusals.
      for (const s of SOURCES) expect(tally[`${s}:ok`] ?? 0, s).toBeGreaterThan(0);
    },
    TEST_TIMEOUT_MS,
  );
});
