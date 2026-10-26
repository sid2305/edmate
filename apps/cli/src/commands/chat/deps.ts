// `edmate chat`'s composition root (task 3.9 Phase A): assembles the full `PipelineDeps` the
// harness's `runTurn`/`defaultSteps` need, over the real demo-teacher content and a real model
// gateway, with no database (lead answer Q2/Q3; see world.ts and retrieval.ts).
import { randomUUID } from 'node:crypto';
import type { DemoTeacherContent } from '@edmate/content';
import type {
  EvidenceEvent,
  LearnerProfile,
  Lang,
  LocalePack,
  ModelGateway,
  ProfileStore,
} from '@edmate/contracts';
import {
  computeCostMicroUsd,
  loadBundledPrices,
  type MeterSink,
  type ProviderAdapterFactories,
} from '@edmate/gateway';
import {
  createTurnLimits,
  hasDistressKeyword,
  type Clock,
  type FallbackReplies,
  type IdKind,
  type IdSource,
  type PipelineDeps,
} from '@edmate/harness';
import type {
  AccessWorld,
  MemorySessionStateStore,
  MemoryUsageMeter,
} from '@edmate/harness/testing';
import {
  memoryAlertSink,
  memorySafetyEventSink,
  memoryTeacherQuestionStore,
  memoryTraceSink,
  memoryTranscriptStore,
  memoryTurnLog,
  memoryTurnConfigStore,
  memoryEntitlementStore,
  memoryUsageMeter,
} from '@edmate/harness/testing';
import { createChatGateway, gatewayFor, type Env } from './gateway.js';
import { buildChatRetrieval } from './retrieval.js';
import {
  buildChatWorld,
  loadChatContent,
  loadChatPersonas,
  loadChatPromptPacks,
  type ChatWorldOptions,
} from './world.js';

/** A real clock: `Date.now()`/`setTimeout`, cancellable only by letting the sleep elapse. */
export function systemClock(): Clock {
  return {
    now: () => Date.now(),
    sleep: (ms, cancel) =>
      new Promise((resolve) => {
        const t = setTimeout(resolve, ms);
        cancel?.onCancel(() => {
          clearTimeout(t);
          resolve();
        });
      }),
  };
}

/**
 * A real clock that runs `factor` times slower: `sleep(ms)` waits `ms * factor` real ms and
 * `now()` advances by 1 ms per `factor` real ms (from the moment it was made). Both must slow
 * together: the harness races step timeouts on `sleep` and also subtracts `now()` deltas from
 * budgets (preGuard gets `400 - scrub ms`), so scaling only `sleep` still fails under load. For
 * tests only (task 3.9b): on a loaded CI runner a cold first turn overran preGuard's 400 ms budget
 * on the real clock and ended in an `error` event; production keeps `systemClock()`.
 */
export function slackClock(factor: number): Clock {
  const real = systemClock();
  const origin = real.now();
  return {
    now: () => origin + Math.floor((real.now() - origin) / factor),
    sleep: (ms, cancel) => real.sleep(ms * factor, cancel),
  };
}

/** Real ids: `crypto.randomUUID()`, prefixed by kind (contracts ids allow `_`). */
export function systemIds(): IdSource {
  return { next: (kind: IdKind) => `${kind}_${randomUUID()}` };
}

/**
 * The loud line for an unpriced/unknown-model usage row (task 3.9a follow-up): routed through an
 * injected `log` (`ChatDepsOptions.log`), never a raw `console.error`, so a caller can capture or
 * silence it instead of this module writing to the real console directly. Exported for
 * `deps.test.ts`'s direct test (no real model call needed to reach it).
 */
export function logUnmetered(
  u: Parameters<MeterSink['recordUnmetered']>[0],
  log?: (text: string) => void,
): void {
  log?.(
    `edmate chat: unmetered usage (${u.reason}) model=${u.model} tier=${u.tier} turn=${u.turnId}`,
  );
}

/**
 * The simplest in-memory `ProfileStore` (contracts port): starts every student x teacher pair at
 * empty defaults and never moves mastery (no BKT here, same scope as the harness's own
 * `memoryProfileStore` test double, which the harness package does not publish from its `testing`
 * barrel — see the handoff's Decisions). `applyEvidence` is a deliberate no-op for mastery: it
 * only echoes the first event's student/teacher back as their still-empty profile, so a CLI run
 * never grows mastery and nothing here is lost or inconsistent across runs -- there is simply no
 * persistence to begin with, by design (the CLI has no database, task 3.9 Phase A).
 */
export function memoryProfileStore(): ProfileStore {
  const profiles = new Map<string, LearnerProfile>();
  const key = (studentId: string, teacherId: string) => `${studentId}\u0000${teacherId}`;
  const of = (studentId: string, teacherId: string): LearnerProfile =>
    profiles.get(key(studentId, teacherId)) ?? {
      studentId,
      teacherId,
      lang: 'en',
      mastery: {},
      mistakes: [],
    };
  return {
    get: (studentId, teacherId) => Promise.resolve(of(studentId, teacherId)),
    applyEvidence: (events: EvidenceEvent[]) => {
      const [first] = events;
      return Promise.resolve(of(first?.studentId ?? '', first?.teacherId ?? ''));
    },
  };
}

/**
 * The session-state port over the CLI's in-memory world (task 5.8a): a saved help state is written
 * onto the world's session row, which `memoryTurnConfigStore` hands to the next turn, as the
 * database does in production; `saved` keeps every write, in order, like `memorySessionStateStore`.
 * Without it each turn started from an empty help state, so a
 * role-play never got past question 1 (and the help ladder never climbed).
 */
export function worldSessionStateStore(world: AccessWorld): MemorySessionStateStore {
  const saved: MemorySessionStateStore['saved'] = [];
  return {
    saved,
    saveHelpState(sessionId, helpState) {
      const session = world.sessions.find((s) => s.id === sessionId);
      if (session === undefined) return Promise.reject(new Error(`no session ${sessionId}`));
      session.helpState = helpState;
      saved.push({ sessionId, helpState });
      return Promise.resolve();
    },
  };
}

const SAFE_REPLY = "Sorry, I can't answer that right now. Please try again.";
function distressReply(_lang: Lang, locale: LocalePack): string {
  const lines = locale.helplines.map((h) => `${h.name}: ${h.number}`).join('; ');
  return `I'm really glad you told me. You're not alone, and it's worth talking to someone right away: ${lines}`;
}

export function chatFallbackReplies(): FallbackReplies {
  return {
    safeReply: () => SAFE_REPLY,
    distress: (lang, locale) => distressReply(lang, locale),
  };
}

export interface ChatDepsOptions extends ChatWorldOptions {
  env: Env;
  contentDir?: string;
  /**
   * Replaces the real Anthropic gateway with a given one (the scripted gateway in tests, never a
   * real model call). `createChatGateway`/`ANTHROPIC_API_KEY` are skipped entirely.
   */
  gateway?: ModelGateway;
  /** Replaces the real clock (tests pass `slackClock`, task 3.9b). Defaults to `systemClock()`. */
  clock?: Clock;
  /**
   * Shares one usage meter across several `buildChatDeps` calls instead of starting a fresh one
   * each time (task 7.6 Phase B: the live model sweep builds a fresh `ChatSetup` per case but
   * needs every case's usage rows in one place to compute cost per turn for a (model, suite)
   * run). Defaults to a fresh `memoryUsageMeter()`, as before — purely additive.
   */
  usage?: MemoryUsageMeter;
  /**
   * Called (in addition to the usual loud log line) for every unpriced/unknown-model call — real
   * tokens with no `costMicroUsd` row (task 7.6 Phase B: the sweep counts these so a model
   * missing from `prices.yaml` is never silently reported as free). Ignored when `opts.gateway`
   * is given (test injection never meters).
   */
  onUnmetered?: (usage: Parameters<MeterSink['recordUnmetered']>[0]) => void;
  /**
   * An `openai-compatible` candidate's base URL (task 7.6a: the live sweep's own
   * `evals/live-models.yaml` entry), forwarded to `createChatGateway`. Absent: only the
   * Anthropic factory is built, as before. Ignored when `opts.gateway` is given (test injection
   * never calls `createChatGateway`).
   */
  baseURL?: string;
  /**
   * Receives the unmetered-usage loud line in place of a raw `console.error` (task 3.9a
   * follow-up; see `logUnmetered`). Absent: the line is simply not written anywhere (no
   * `console.error` fallback) -- same as `apps/cli/src/commands/eval/liveAgent.ts`'s existing
   * calls, which keep relying on their own `onUnmetered` counter instead. Ignored when
   * `opts.gateway` is given (test injection never meters).
   */
  log?: (text: string) => void;
}

export interface ChatSetup {
  deps: PipelineDeps;
  teacherId: string;
  agentId: string;
  studentId: string;
  sessionId: string;
  content: DemoTeacherContent;
  /** Where `deps.personas` came from: the real signed library, or none (role-play off). */
  personasSource: 'real' | 'none';
  /** Why the personas didn't load, naming the bad file(s); only set when `personasSource === 'none'`. */
  personasReason?: string;
  /** Where `deps.promptPacks` came from: the real signed set, or the harness's fixture fallback. */
  promptPackSource: 'real' | 'fixture';
}

/** Builds one run's full `PipelineDeps`, ready for `runTurn(input, { deps, steps: defaultSteps })`. */
export async function buildChatDeps(opts: ChatDepsOptions): Promise<ChatSetup> {
  const content = loadChatContent(opts.contentDir);
  const { world, accessOptions, teacherId, agentId, studentId, sessionId } = buildChatWorld(
    content,
    opts,
  );
  const { library: promptPacks, source: promptPackSource } = loadChatPromptPacks();
  const { personas, source: personasSource, reason: personasReason } = loadChatPersonas();

  const clock = opts.clock ?? systemClock();
  const usage = opts.usage ?? memoryUsageMeter();
  const prices = loadBundledPrices();

  let gatewayForDeps: PipelineDeps['gatewayFor'];
  if (opts.gateway !== undefined) {
    // Test injection (rule 4): never calls createChatGateway, so no key is ever loaded.
    const injected = opts.gateway;
    gatewayForDeps = () => ({ gateway: injected, metered: false });
  } else {
    const factories: ProviderAdapterFactories = await createChatGateway(
      opts.env,
      opts.baseURL === undefined ? undefined : { baseURL: opts.baseURL },
    );
    const sink: MeterSink = {
      record: (u, ctx) => usage.record(u, ctx),
      recordUnmetered: (u) => {
        // Ids, model and reason only, never request content (ADR-0006-style discipline).
        logUnmetered(u, opts.log);
        opts.onUnmetered?.(u);
        return Promise.resolve();
      },
    };
    gatewayForDeps = gatewayFor({ factories, sink, prices });
  }

  const deps: PipelineDeps = {
    clock,
    ids: systemIds(),
    gatewayFor: gatewayForDeps,
    priceUsage: (u) => computeCostMicroUsd(prices, u.model, u.inputTokens, u.outputTokens),
    log: memoryTurnLog(),
    entitlements: memoryEntitlementStore(world, accessOptions),
    turnConfig: memoryTurnConfigStore(world),
    entitlementSource: opts.source,
    limits: createTurnLimits(clock),
    profiles: memoryProfileStore(),
    transcripts: memoryTranscriptStore(),
    sessionState: worldSessionStateStore(world),
    retrieval: buildChatRetrieval(content, teacherId),
    teacherQuestions: memoryTeacherQuestionStore(),
    usage,
    traces: memoryTraceSink(),
    alerts: memoryAlertSink(),
    safetyEvents: memorySafetyEventSink(),
    fallbackReplies: chatFallbackReplies(),
    promptPacks,
    distressCheck: (text, lang) => hasDistressKeyword(text, lang),
    ...(personas === undefined ? {} : { personas }),
  };

  return {
    deps,
    teacherId,
    agentId,
    studentId,
    sessionId,
    content,
    personasSource,
    promptPackSource,
    ...(personasReason === undefined ? {} : { personasReason }),
  };
}
