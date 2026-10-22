// A memory TurnBackend for the chat route tests (task 9.4): the harness's two-teacher access world,
// memory ports, the real `defaultSteps`, a real clock and the scripted gateway (rule 4: no real
// model call). preGuard's classifiers are scripted by their fixed system prompts; postGuard's
// grounding and advice judges are answered by the harness's own judge wrappers (as in the CLI's
// chat deps test), so a script only needs the reply streams.
import type { Chunk, LearnerProfile, ModelGateway, ProfileStore } from '@edmate/contracts';
import { createTurnLimits, defaultSteps, type Clock, type PipelineDeps } from '@edmate/harness';
import {
  adviceJudgeGateway,
  CLEAN_ADVICE_VERDICT,
  GROUNDED_VERDICT,
  judgeGateway,
  memoryAlertSink,
  memoryEntitlementStore,
  memoryRetrieval,
  memorySafetyEventSink,
  memorySessionStateStore,
  memoryTeacherQuestionStore,
  memoryTraceSink,
  memoryTranscriptStore,
  memoryTurnConfigStore,
  memoryTurnLog,
  memoryUsageMeter,
  ScriptedGateway,
  twoTeacherWorld,
  type AccessWorld,
  type ScriptedObjectCall,
  type ScriptedStreamCall,
} from '@edmate/harness/testing';
import { readPromptPackLibrary } from '@edmate/content';
import type { StudentScope } from '@edmate/db';
import { fileURLToPath } from 'node:url';
import { systemClock, systemIds } from '../src/turn/deps';
import { webFallbackReplies } from '../src/turn/fallbackReplies';
import type { TurnBackend } from '../src/turn/routes';

/**
 * Wraps a real clock so a step or classifier *deadline* (task 0.21) never races real wall-clock
 * time against the in-memory scripted gateway: `runWithTimeout` always calls `sleep(ms, cancel)`
 * with a cancel token, so that branch only resolves once the real work settles and cancels it,
 * never on its own. A content-pacing delay (a scripted stream's `delay` step, or a background
 * retry backoff) calls `sleep(ms)` with no cancel token, so it still waits in real time. Under
 * CPU pressure (several heavy processes at once), a real 250-400 ms guard deadline could otherwise
 * fire before the scripted gateway's already-resolved promise is scheduled, failing turns closed
 * with no tokens even though nothing was actually slow in-process (`now()` stays real, for
 * realistic timestamps).
 *
 * `now()` itself needs the same guard (task 9.0d): some budgets are *subtracted*, not raced, e.g.
 * `runner.ts`'s `budget - sc.ms` (preGuard's remaining slice after the regex scrub) and
 * `postGuard.ts`'s `POST_GUARD_BUDGET_MS - (clock.now() - started)`. Those read `clock.now()`
 * twice and use the real elapsed time between the calls directly, with no race and no cancel
 * token to protect them; on a cold, CPU-starved CI worker, scheduling delay alone between two
 * `now()` calls (no in-process work was actually slow) can push the subtraction to zero or
 * negative, which `runWithTimeout` then times out immediately, before it ever runs the guard —
 * failing the turn closed with no tokens. Capping how far a single `now()` call may jump past the
 * last one keeps timestamps real (and still monotonic) while never letting one scheduling stall
 * read as hundreds of ms of in-process work.
 */
const MAX_CLOCK_JUMP_MS = 20;

function deadlineSafeClock(real: Clock): Clock {
  let virtual = real.now();
  return {
    now: () => {
      const wall = real.now();
      virtual += Math.min(Math.max(wall - virtual, 0), MAX_CLOCK_JUMP_MS);
      return virtual;
    },
    sleep: (ms, cancel) =>
      cancel === undefined ? real.sleep(ms) : new Promise((resolve) => cancel.onCancel(resolve)),
  };
}

/** preGuard's three classifiers, all clear. */
export function clearClassifiers(): ScriptedObjectCall[] {
  return [
    { match: (r) => r.system.includes('thoughts of suicide or self-harm'), value: { distress: false } },
    { match: (r) => r.system.includes('self_harm (wants to hurt themselves)'), value: { category: 'none' } },
    { match: (r) => r.system.includes('jailbreak_override'), value: { category: 'none' } },
  ];
}

/** A stream that says `parts` in order, then reports usage. */
export function says(...parts: string[]): ScriptedStreamCall {
  return {
    steps: [
      ...parts.map((text) => ({ type: 'text' as const, text })),
      {
        type: 'usage' as const,
        usage: { model: 'claude-haiku-4-5', tier: 'main' as const, inputTokens: 10, outputTokens: 10, costMicroUsd: 1 },
      },
    ],
  };
}

/** Wraps a gateway to see each stream and whether its consumer stopped before it ended. */
export function observedGateway(inner: ModelGateway) {
  const seen = { streams: 0, closedEarly: 0 };
  const gateway: ModelGateway = {
    stream(req) {
      seen.streams += 1;
      return (async function* observe() {
        let ended = false;
        try {
          for await (const chunk of inner.stream(req)) yield chunk;
          ended = true;
        } catch (error) {
          ended = true;
          throw error;
        } finally {
          if (!ended) seen.closedEarly += 1;
        }
      })();
    },
    generateObject: (req, schema) => inner.generateObject(req, schema),
    embed: (texts) => inner.embed(texts),
  };
  return { gateway, seen };
}

/** The repo's real prompt packs (read-only): the world's agents use set 1.0.0. */
const promptPacks = readPromptPackLibrary(
  fileURLToPath(new URL('../../../content/prompt-packs/', import.meta.url)),
);

function chunk(id: string, teacherId: string, moduleId: string, text: string): Chunk {
  return {
    id,
    teacherId,
    documentId: `doc_${moduleId}`,
    moduleId,
    kind: 'material',
    text,
    source: { title: `Notes ${moduleId}`, locator: 'p1', kind: 'material' },
  };
}

function profiles(): ProfileStore {
  const of = (studentId: string, teacherId: string): LearnerProfile => ({
    studentId,
    teacherId,
    lang: 'en',
    mastery: {},
    mistakes: [],
  });
  return {
    get: (s, t) => Promise.resolve(of(s, t)),
    applyEvidence: (events) =>
      Promise.resolve(of(events[0]?.studentId ?? 'stu_none', events[0]?.teacherId ?? 'tch_none')),
  };
}

export interface MemoryBackendOptions {
  /** Reply streams, in order (classifier calls are scripted already). */
  stream?: ScriptedStreamCall[];
  /** Extra or replacement object calls (default: the three clear classifiers). */
  objects?: ScriptedObjectCall[];
  world?: AccessWorld;
  /**
   * Replaces the scripted gateway and the judge wrappers entirely (9.0): the given gateway answers
   * every stream, classifier and judge call, through the real `defaultSteps`.
   */
  gateway?: ModelGateway;
}

export function memoryBackend(opts: MemoryBackendOptions = {}) {
  const world = opts.world ?? twoTeacherWorld();
  const clock = deadlineSafeClock(systemClock());
  const scripted = new ScriptedGateway(
    { generateObject: opts.objects ?? clearClassifiers(), stream: opts.stream ?? [says('Hello')] },
    clock,
  );
  const observed = observedGateway(
    opts.gateway ??
      adviceJudgeGateway(judgeGateway(scripted, () => GROUNDED_VERDICT), () => CLEAN_ADVICE_VERDICT),
  );
  const entitlements = memoryEntitlementStore(world, { market: 'IN' });
  const transcripts = memoryTranscriptStore();
  const scopes: StudentScope[] = [];
  const logs: { event: string; fields: Readonly<Record<string, string>> }[] = [];
  const retrieval = memoryRetrieval({
    chunks: [
      chunk('chk_a1', 'tch_a', 'mod_a1', 'Fractions have a numerator and a denominator.'),
      chunk('chk_a3', 'tch_a', 'mod_a3', 'Photosynthesis makes sugar from sunlight in chlorophyll.'),
    ],
  });
  let created = 0;

  const depsFor = (scope: StudentScope): PipelineDeps => {
    scopes.push(scope);
    return {
      clock,
      ids: systemIds(),
      gatewayFor: () => ({ gateway: observed.gateway, metered: false }),
      priceUsage: (u) => u.costMicroUsd,
      log: memoryTurnLog(),
      entitlements,
      turnConfig: memoryTurnConfigStore(world),
      entitlementSource: 'subscription',
      limits: createTurnLimits(clock),
      profiles: profiles(),
      transcripts,
      sessionState: memorySessionStateStore(),
      retrieval,
      teacherQuestions: memoryTeacherQuestionStore(),
      usage: memoryUsageMeter(),
      traces: memoryTraceSink(),
      alerts: memoryAlertSink(),
      safetyEvents: memorySafetyEventSink(),
      fallbackReplies: webFallbackReplies(),
      promptPacks,
      distressCheck: () => false,
    };
  };

  const backend: TurnBackend = {
    agents: {
      owner: async ({ agentId }) => {
        const a = world.agents.find((x) => x.id === agentId && x.status === 'live');
        return a ? { teacherId: a.teacherId } : null;
      },
      get: async ({ teacherId }, agentId) => {
        const a = world.agents.find((x) => x.id === agentId && x.teacherId === teacherId);
        if (!a) return null;
        const live = a.status === 'live' ? Math.max(...a.versions.map((v) => v.version)) : null;
        return { status: a.status, liveVersion: live };
      },
    },
    sessions: {
      create: async (scope, input) => {
        created += 1;
        const id = `ses_new_${created}`;
        world.sessions.push({ id, ...scope, ...input, endedAt: null });
        return { id };
      },
      get: async (scope, id) =>
        world.sessions.find(
          (s) => s.id === id && s.studentId === scope.studentId && s.teacherId === scope.teacherId,
        ) ?? null,
    },
    entitlements,
    depsFor,
    steps: defaultSteps,
    now: () => new Date(),
    log: { error: (event, fields = {}) => void logs.push({ event, fields }) },
  };
  return { backend, world, scripted, seen: observed.seen, entitlements, transcripts, scopes, logs };
}
