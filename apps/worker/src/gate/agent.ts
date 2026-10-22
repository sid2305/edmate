// The gate agent (task 8.7 Phase B): packages/evals' `EvalAgent` over the real turn pipeline
// (`runTurn` with `defaultSteps`), pinned to the candidate agent version and one candidate package
// version. Pattern: apps/cli's `liveAgent.ts`; the composition mirrors apps/web's `turnDepsFor`
// with read-only database ports (retrieval, the `eval` entitlement, the gate's TurnConfigStore)
// and in-memory or no-op write ports (ports.ts). A shared web/worker composition module is an M13
// follow-up (plan scope 10).
import { randomUUID } from 'node:crypto';
import type {
  LocalePack,
  Message,
  PackageConfig,
  RetrievalIndex,
  SourceRef,
  TurnEvent,
} from '@edmate/contracts';
import { entitlementStoreFor, type Repositories } from '@edmate/db';
import type { EvalAgent, EvalAgentReply, EvalTurnInput } from '@edmate/evals';
import {
  createTurnLimits,
  defaultSteps,
  hasDistressKeyword,
  isBlockReply,
  runTurn,
  type Clock,
  type FallbackReplies,
  type IdSource,
  type PersonaLibrary,
  type PipelineDeps,
  type PriceUsage,
  type PromptPackLibrary,
} from '@edmate/harness';
import { gateTurnConfigStore } from './configStore.js';
import type { GateBasis } from './input.js';
import {
  gateCasePorts,
  systemClock,
  systemIds,
  type GateSideEffects,
  type GateUsageMeter,
} from './ports.js';

export interface GateAgentDeps {
  /** Read only: agents, agentVersions, packageVersions, styleCards and modules. */
  repos: Repositories;
  retrieval: RetrievalIndex;
  locales(market: string): LocalePack | null;
  /** The market gate turns run in (the worker's `EDMATE_MARKET`, default `global`). */
  market: string;
  packMarket(market: string): string;
  promptPacks: PromptPackLibrary;
  personas?: PersonaLibrary;
  /** From models.ts `gateGatewayFor` (tests: a scripted gateway, never a real model call). */
  gatewayFor: PipelineDeps['gatewayFor'];
  priceUsage: PriceUsage;
  usage: GateUsageMeter;
  effects: GateSideEffects;
  clock?: Clock;
  ids?: IdSource;
}

const SAFE_REPLY = "Sorry, I can't answer that right now. Please try again.";

/** English fallback replies, as apps/web's `webFallbackReplies` and the CLI's. */
export function gateFallbackReplies(): FallbackReplies {
  return {
    safeReply: () => SAFE_REPLY,
    distress: (_lang, locale) => {
      const lines = locale.helplines.map((h) => `${h.name}: ${h.number}`).join('; ');
      return `I'm really glad you told me. You're not alone, and it's worth talking to someone right away: ${lines}`;
    },
  };
}

function message(role: Message['role'], text: string): Message {
  return { id: `msg_${randomUUID()}`, role, text, createdAt: new Date().toISOString() };
}

/**
 * One reply from a finished turn's events (apps/cli `collectReply`). `blocked` is the
 * `guard_blocked` event, else whether the final text is a fixed block reply. Any other `error`
 * event throws, so the case fails with the code named instead of scoring an empty reply.
 */
export async function collectReply(events: AsyncIterable<TurnEvent>): Promise<EvalAgentReply> {
  let text = '';
  let sources: SourceRef[] | undefined;
  let blocked: boolean | undefined;
  let escalated: boolean | undefined;
  let failed: string | undefined;
  for await (const event of events) {
    switch (event.type) {
      case 'token':
        text += event.text;
        break;
      case 'replace':
        text = event.text;
        break;
      case 'sources':
        sources = event.items;
        break;
      case 'safety':
        if (event.level === 'alert') escalated = true;
        break;
      case 'error':
        if (event.code === 'guard_blocked') blocked = true;
        else failed = event.code;
        break;
      default:
        break;
    }
  }
  if (failed !== undefined) throw new Error(`gate turn failed: ${failed}`);
  return {
    text,
    ...(sources === undefined ? {} : { sources }),
    blocked: blocked ?? isBlockReply(text),
    ...(escalated === undefined ? {} : { escalated }),
  };
}

/** A background report that records a guard withholding text, not a failed record. */
export function isGuardDetection(error: unknown): boolean {
  return error instanceof Error && error.name === 'LockedLeakDetected';
}

/** The gate agent for one pinned candidate package. */
export function createGateAgent(deps: GateAgentDeps, basis: GateBasis, pkg: PackageConfig): EvalAgent {
  const pinned = basis.packageVersions.find((p) => p.packageId === pkg.id);
  if (pinned === undefined || pinned.version !== pkg.version || pkg.agentId !== basis.agentId) {
    throw new Error(`gate: package ${pkg.id}@${pkg.version} is not pinned by this run`);
  }
  const clock = deps.clock ?? systemClock();
  const ids = deps.ids ?? systemIds();
  const entitlements = entitlementStoreFor(deps.repos, {
    market: deps.market,
    packMarket: deps.packMarket,
    // Only a `subscription` resolve asks; the gate never makes one. False fails closed.
    learnerClear: () => Promise.resolve(false),
    eval: { teacherId: basis.teacherId, packageId: pkg.id, version: pkg.version, market: deps.market },
  });
  return {
    async reply(input: EvalTurnInput): Promise<EvalAgentReply> {
      // One case turn = one fresh session in memory; nothing is kept after the reply.
      const ports = gateCasePorts(deps.effects);
      const sessionId = `gate_${randomUUID()}`;
      const studentId = `gate_${randomUUID()}`;
      for (const turn of input.priorTurns) {
        if (turn.teacher !== undefined) {
          await ports.transcripts.append(sessionId, message('teacher', turn.teacher));
        }
        await ports.transcripts.append(sessionId, message('student', turn.student));
        await ports.transcripts.append(sessionId, message('agent', turn.reply));
      }
      if (input.teacher !== undefined) {
        await ports.transcripts.append(sessionId, message('teacher', input.teacher));
      }
      const pipeline: PipelineDeps = {
        clock,
        ids,
        gatewayFor: deps.gatewayFor,
        priceUsage: deps.priceUsage,
        log: ports.log,
        entitlements,
        turnConfig: gateTurnConfigStore({
          repos: deps.repos,
          basis,
          locales: deps.locales,
          helpState: ports.helpState,
        }),
        entitlementSource: 'eval',
        limits: createTurnLimits(clock),
        profiles: ports.profiles,
        transcripts: ports.transcripts,
        sessionState: ports.sessionState,
        retrieval: deps.retrieval,
        teacherQuestions: ports.teacherQuestions,
        usage: deps.usage,
        traces: ports.traces,
        alerts: ports.alerts,
        safetyEvents: ports.safetyEvents,
        fallbackReplies: gateFallbackReplies(),
        promptPacks: deps.promptPacks,
        ...(deps.personas === undefined ? {} : { personas: deps.personas }),
        distressCheck: (text, lang) => hasDistressKeyword(text, lang),
      };
      const run = runTurn(
        {
          agentId: basis.agentId,
          sessionId,
          studentId,
          kind: 'message',
          text: input.student,
          lang: 'en',
          clientTs: new Date().toISOString(),
        },
        { deps: pipeline, steps: defaultSteps },
      );
      const reply = await collectReply(run.events);
      const finished = await run.finished;
      // A background failure (meter, trace, alert delivery, a runner bug) fails the case: its
      // usage or its record may be missing, so the case cannot count as passed. (The runner's
      // `log.backgroundFailure` already counted each one in `effects`.)
      // One exception: `LockedLeakDetected` is the locked-stream guard doing its job (the locked
      // text was withheld and the reply replaced); the reply itself is what the case scores.
      const failures = finished.background.filter((b) => !isGuardDetection(b.error));
      if (failures.length > 0) {
        const tasks = [...new Set(failures.map((b) => b.task))].join(',');
        const first = failures[0]?.error;
        const why = first instanceof Error ? first.name : 'unknown';
        throw new Error(`gate turn background failure: ${tasks} (${why}: ${String(first)})`);
      }
      return reply;
    },
  };
}

/** `BuildGateInputOptions.agentFor`: one gate agent per candidate package, built on first use. */
export function gateAgentFactory(
  deps: GateAgentDeps,
  basis: GateBasis,
): (pkg: PackageConfig) => EvalAgent {
  return (pkg) => createGateAgent(deps, basis, pkg);
}
