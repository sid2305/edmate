// Property (task 5.4): for a random world, a random valid entitlement and an honest, widening,
// text-leaking or junk-probe index, `scopedRetrieval(...).search` and `buildContext` return only
// chunks of the entitlement's teacher in its allowed modules, or fail closed with
// RetrievalScopeError; `probeLocked` returns `{ hit, score }` and nothing else. Seeded PRNG, no
// fast-check (1.2 decision).
import type { Chunk, Entitlement, RetrievalIndex, Skill } from '@edmate/contracts';
import {
  demoEntitlementSubscription,
  demoTurnInput,
  learnerProfileNew,
} from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { cancelSource } from '../pipeline/clock.js';
import { buildContext } from '../pipeline/steps/buildContext.js';
import type { Entitled } from '../pipeline/types.js';
import {
  junkProbeRetrieval,
  MARKED_MODULES,
  MARKED_TEACHERS,
  MARKED_VOCAB,
  markedWorld,
  markOf,
  textLeakingRetrieval,
  wideningRetrieval,
} from '../testing/hostileRetrieval.js';
import { memoryTranscriptStore } from '../testing/memoryPorts.js';
import { memoryRetrieval } from '../testing/memoryRetrieval.js';
import { type Prng, prng } from '../testing/prng.js';
import { stepEnvExtras, testDeps } from '../testing/testSteps.js';
import { RetrievalScopeError, scopedRetrieval } from './scopedRetrieval.js';

/** Change the seed to explore; a failure prints it so the run can be replayed. */
const SEED = 20261020;
const ITERATIONS = 2_000;
const TEST_TIMEOUT_MS = 60_000;
/** The harness lib has no DOM or Node types; vitest prints console output. */
const log = (s: string): void =>
  (globalThis as { console?: { log(s: string): void } }).console?.log(s);

const SKILLS: Skill[] = ['explain', 'coach', 'practice', 'feedback', 'revision', 'study_plan'];
const KINDS = ['honest', 'widen', 'leakText', 'junkProbe'] as const;
type Kind = (typeof KINDS)[number];

const subset = <T>(r: Prng, xs: readonly T[], p: number): T[] => xs.filter(() => r.chance(p));

/** A valid entitlement: allowed and locked are disjoint; allowed may name ids with no chunks. */
function randomEntitlement(r: Prng, teacherId: string): Entitlement {
  const pool = [...MARKED_MODULES, 'mod_p_foreign'];
  const allowed = subset(r, pool, 0.45);
  const locked = subset(
    r,
    pool.filter((m) => !allowed.includes(m)),
    0.6,
  );
  // Sometimes a duplicate id, which the filter must dedupe.
  if (allowed.length > 0 && r.chance(0.1)) allowed.push(allowed[0]!);
  return {
    ...demoEntitlementSubscription,
    teacherId,
    allowedModuleIds: allowed,
    lockedModuleIds: locked,
    skills: subset(r, SKILLS, 0.5),
  };
}

function junk(r: Prng, chunks: readonly Chunk[]): unknown {
  const text = r.pick(chunks).text;
  return r.pick<unknown>([
    { hit: true, score: 0.4, text },
    { hit: 'yes', score: Number.NaN, marker: text },
    { hit: true, score: Number.POSITIVE_INFINITY, chunks },
    { hit: 1, score: -2 },
    { score: 5 },
    null,
    text,
    [text],
  ]);
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
      return junkProbeRetrieval(chunks, junk(r, chunks));
  }
}

function query(r: Prng): string {
  const n = r.int(4); // 0..3 words; 0 is the empty query
  const words: string[] = Array.from({ length: n }, () => r.pick(MARKED_VOCAB));
  if (n > 0 && r.chance(0.2)) words.push(r.pick(['ünïcødé', '分数', '🙂', "o'brien", '%_\\']));
  return words.join(' ');
}

const inScope = (c: Chunk, e: Entitlement) =>
  c.teacherId === e.teacherId &&
  e.allowedModuleIds.includes(c.moduleId) &&
  !e.lockedModuleIds.includes(c.moduleId);

/** Markers of every chunk this entitlement may not see. */
const forbidden = (chunks: readonly Chunk[], e: Entitlement) =>
  chunks.filter((c) => !inScope(c, e)).map((c) => markOf(c.id));

function expectNoForbidden(x: unknown, marks: readonly string[], seed: string): void {
  const json = JSON.stringify(x);
  for (const m of marks) expect(json.includes(m), `${seed}: leaked ${m}`).toBe(false);
}

function entitled(e: Entitlement): Entitled {
  // buildContext reads only `entitlement` and `helpState`; the rest is unused here.
  return { entitlement: e } as Entitled;
}

describe('access property: scoped retrieval (task 5.4)', () => {
  it(
    `${String(ITERATIONS)} random worlds × entitlements × indexes stay inside the allowed modules`,
    async () => {
      const r = prng(SEED);
      const tally: Record<string, number> = {};
      const count = (k: string) => (tally[k] = (tally[k] ?? 0) + 1);
      for (let i = 0; i < ITERATIONS; i++) {
        const at = `seed ${String(SEED)} iteration ${String(i)}`;
        const chunks = markedWorld(r);
        const e = randomEntitlement(r, r.pick(MARKED_TEACHERS));
        const kind = r.pick(KINDS);
        const index = indexFor(kind, r, chunks);
        const q = query(r);
        const k = 1 + r.int(8);
        const marks = forbidden(chunks, e);
        const scoped = scopedRetrieval(index, e);

        // What the index itself answers: a stray chunk anywhere in it must fail the search.
        const scope = {
          teacherId: e.teacherId,
          allowedModuleIds: [...new Set(e.allowedModuleIds)],
        };
        const raw =
          q === '' || scope.allowedModuleIds.length === 0 ? [] : await index.search(q, scope, k);
        const stray = raw.some((c) => !inScope(c, e));

        let got: Chunk[] | undefined;
        try {
          got = await scoped.search(q, k);
        } catch (err) {
          expect(err, at).toBeInstanceOf(RetrievalScopeError);
          expectNoForbidden((err as Error).message, marks, at);
        }
        if (got === undefined) {
          expect(stray, `${at}: threw without a stray chunk`).toBe(true);
          count(`${kind}:refused`);
        } else {
          expect(stray, `${at}: a stray chunk was not refused`).toBe(false);
          expect(got.length, at).toBeLessThanOrEqual(k);
          for (const c of got) expect(inScope(c, e), `${at}: ${c.id}`).toBe(true);
          expectNoForbidden(got, marks, at);
          // Honest ids: exactly what the honest index gives for the same scope.
          const honest =
            q === '' || scope.allowedModuleIds.length === 0
              ? []
              : await memoryRetrieval({ chunks }).search(q, scope, k);
          expect(
            got.map((c) => c.id),
            at,
          ).toEqual(honest.map((c) => c.id));
          count(`${kind}:${got.length > 0 ? 'results' : 'empty'}`);
        }

        const p = await scoped.probeLocked(q);
        expect(Object.keys(p), at).toEqual(['hit', 'score']);
        expect(typeof p.hit, at).toBe('boolean');
        expect(p.score >= 0 && p.score <= 1, at).toBe(true);
        expect(JSON.stringify(p).includes('MARK_'), at).toBe(false);
        if (p.hit) count('probe:hit');

        // The same through buildContext: the step fails closed, or its context is in scope.
        const t = testDeps({
          overrides: {
            retrieval: index,
            profiles: {
              get: (studentId, teacherId) =>
                Promise.resolve({ ...learnerProfileNew, studentId, teacherId }),
              applyEvidence: () => Promise.reject(new Error('unused')),
            },
            transcripts: memoryTranscriptStore(),
          },
        });
        const input = { ...demoTurnInput, studentId: e.studentId, text: q === '' ? ' ' : q };
        const env = {
          input,
          deps: t.deps,
          cancel: cancelSource().token,
          turnId: 'turn_1',
          ...stepEnvExtras(),
        };
        try {
          const b = await buildContext(env, entitled(e));
          expect(stray, `${at}: buildContext passed a stray chunk`).toBe(false);
          for (const c of b.retrieved) expect(inScope(c, e), `${at}: ${c.id}`).toBe(true);
          expectNoForbidden(b, marks, at);
          expect(b.lockedHit, at).toBe(p.hit);
        } catch (err) {
          expect(err, at).toBeInstanceOf(RetrievalScopeError);
          expect(stray, at).toBe(true);
        }
      }
      log(`access retrieval property: seed ${String(SEED)}, ${JSON.stringify(tally)}`);
      // Each kind of index was exercised, and widening was refused at least once.
      for (const k of KINDS)
        expect(Object.keys(tally).some((x) => x.startsWith(`${k}:`))).toBe(true);
      expect(tally['widen:refused'] ?? 0).toBeGreaterThan(0);
      expect(tally['honest:results'] ?? 0).toBeGreaterThan(0);
      expect(tally['probe:hit'] ?? 0).toBeGreaterThan(0);
    },
    TEST_TIMEOUT_MS,
  );
});
