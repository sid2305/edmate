// Task 13.2: load test 50 concurrent students through the real turn pipeline (`defaultSteps`,
// same set production uses) over in-memory ports and the scripted gateway, with a real clock for
// genuine wall-clock concurrency. Never run by tests or CI (lessons.md: wall-clock bounds fail on
// shared CI runners) — invoked directly, after a build:
//
//   corepack pnpm turbo run build --filter=@edmate/contracts...
//   corepack pnpm turbo run build --filter=@edmate/harness
//   node packages/harness/scripts/loadTest50.ts
//
// Imports its own `dist/` by relative path, not the `@edmate/harness` package name: the harness
// purity rule (build plan rule 3) allows a relative import that stays inside packages/harness,
// but not a self-import of its own package specifier. Built `dist/` is also plain JS, with
// `runner.ts`'s `Turn` class's constructor parameter properties already compiled away — Node's
// native TS type-stripping cannot erase those from source (no pure erasure is possible: it would
// have to inject the field assignments), so importing the *source* `.ts` files here, as a
// strip-only script otherwise could, is not an option for this one file.
//
// Each turn's one scripted model call carries a known `{ type: 'delay', ms: 150 }` step standing
// in for the model's own latency; `overheadMs = wallMs - 150` isolates the harness's own cost.
// Exits 1 when p95 harness overhead is at or over 500 ms.
import type {
  EntitlementStore,
  RetrievalIndex,
  TurnConfigStore,
  TurnInput,
} from '@edmate/contracts';
import {
  demoAgentConfig,
  demoChunkScored,
  demoEntitlementSubscription,
  demoLocalePack,
  demoPackagePaid,
  demoStyleCard,
  demoTurnInput,
  learnerProfileNew,
} from '@edmate/contracts/fixtures';
import type { Cancel, PipelineDeps } from '../dist/pipeline/types.js';
import { defaultSteps } from '../dist/pipeline/steps/index.js';
import { runTurn } from '../dist/pipeline/runner.js';
import { driveTurn } from '../dist/testing/driveTurn.js';
import { FIXTURE_PROMPT_PACK_VERSION } from '../dist/testing/promptPackFixtures.js';
import { memorySessionStateStore, memoryTranscriptStore } from '../dist/testing/memoryPorts.js';
import { percentile } from '../dist/testing/percentiles.js';
import { scriptedStreamText } from '../dist/testing/gatewayFixtures.js';
import { testDeps } from '../dist/testing/testSteps.js';
import type { VirtualClock } from '../dist/testing/virtualClock.js';

const STUDENTS = 50;
const MODEL_DELAY_MS = 150;
const P95_BUDGET_MS = 500;

/** A clock backed by real timers, for genuine wall-clock concurrency (not the deterministic
 * virtual one): `drive` just awaits the promise, since the script's only wait is the gateway's
 * own scripted delay, which already resolves on a real timer. */
function wallClock(): VirtualClock {
  return {
    now: () => Date.now(),
    sleep(ms: number, cancel?: Cancel): Promise<void> {
      return new Promise((resolve) => {
        const t = setTimeout(resolve, ms);
        cancel?.onCancel(() => {
          clearTimeout(t);
          resolve();
        });
      });
    },
    pending: 0,
    advance: () => Promise.resolve(),
    drive: <T>(promise: Promise<T>) => promise,
  };
}

/** One independent world (own stores, own gateway) for `studentId`. */
function world(studentId: string) {
  const clock = wallClock();
  const entitlements: EntitlementStore = {
    resolve: (x) =>
      Promise.resolve(
        x.studentId === studentId && x.source === 'subscription'
          ? { ...demoEntitlementSubscription, studentId }
          : null,
      ),
  };
  const turnConfig: TurnConfigStore = {
    load: () =>
      Promise.resolve({
        agent: {
          ...demoAgentConfig,
          languages: ['en'],
          promptPackVersion: FIXTURE_PROMPT_PACK_VERSION,
        },
        pkg: demoPackagePaid,
        styleCard: demoStyleCard,
        locale: demoLocalePack,
      }),
  };
  const retrieval: RetrievalIndex = {
    search: () => Promise.resolve([{ ...demoChunkScored }]),
    probe: () => Promise.resolve({ hit: false, score: 0 }),
    leakCheck: () => Promise.resolve({ hit: false }),
  };
  const overrides: Partial<PipelineDeps> = {
    entitlements,
    turnConfig,
    retrieval,
    profiles: {
      // buildContext (the real step) throws when the profile's studentId doesn't match the
      // turn's, so each world's profile must carry its own student id.
      get: () => Promise.resolve({ ...learnerProfileNew, studentId }),
      applyEvidence: () => Promise.resolve(),
    },
    transcripts: memoryTranscriptStore(),
    sessionState: memorySessionStateStore(),
  };
  const t = testDeps({
    clock,
    judge: 'grounded',
    script: {
      // The real preGuard chain (distressDetect, moderationIn, jailbreak) classifies the student's
      // text with one `generateObject` call each, in that order (preGuard.test.ts's `ALL_CLEAR`);
      // all three say clear, so the turn proceeds to `generate`'s one scripted stream.
      generateObject: [
        { value: { distress: false } },
        { value: { category: 'none' } },
        { value: { category: 'none' } },
      ],
      stream: [
        { steps: [{ type: 'delay', ms: MODEL_DELAY_MS }, ...scriptedStreamText.steps] },
      ],
    },
    overrides,
  });
  const input: TurnInput = {
    ...demoTurnInput,
    studentId,
    sessionId: `load-test-session-${studentId}`,
  };
  return { deps: t.deps, clock, input };
}

/** Runs one student's turn to completion; returns the harness's own overhead (wall time minus the
 * known scripted model delay). */
async function runOne(studentId: string): Promise<number> {
  const w = world(studentId);
  const start = Date.now();
  const r = await driveTurn(runTurn(w.input, { deps: w.deps, steps: defaultSteps }), w.clock);
  const wallMs = Date.now() - start;
  // A fast failure (a guard block, a scripted-gateway mismatch) is cheap, not fast: never let it
  // pass as a low overhead sample.
  const ok = r.events.some((e) => e.type === 'done') && !r.events.some((e) => e.type === 'error');
  if (!ok) {
    throw new Error(`${studentId}: turn did not complete cleanly: ${JSON.stringify(r.events)}`);
  }
  return wallMs - MODEL_DELAY_MS;
}

async function main(): Promise<number> {
  const ids = Array.from({ length: STUDENTS }, (_, i) => `load-test-student-${i}`);
  const overheads = (await Promise.all(ids.map(runOne))).sort((a, b) => a - b);
  const p50 = percentile(overheads, 50);
  const p95 = percentile(overheads, 95);
  const p99 = percentile(overheads, 99);
  process.stdout.write(
    `50 concurrent students, harness overhead (ms): p50=${p50} p95=${p95} p99=${p99}\n`,
  );
  return p95 >= P95_BUDGET_MS ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`loadTest50 failed: ${String(error)}\n`);
    process.exitCode = 1;
  },
);
