// The pipeline-backed `EvalAgent` (task 7.6 Phase A): adapts the real turn pipeline
// (`buildChatDeps`/`runTurn`, task 3.9) to `packages/evals`' `EvalAgent` interface, so
// `edmate eval --record` runs real suites against the real agent instead of the stub
// `unwiredAgent`. No real model call in tests (rule 4): every test injects a scripted
// `ModelGateway` via `LiveEvalAgentOptions.gateway`, exactly as `chat/deps.ts` already does.
// Task 5.8d: one `ChatSetup` per case (cached by `caseId`), so a persona's role-play state (the
// question count, the stored persona id, in the session's help state) carries across a case's
// `reply()` calls instead of resetting every turn; turn 0 of a persona case is sent as a
// `skill_action` start carrying only the bare persona id.
import { randomUUID } from 'node:crypto';
import type { Message, ModelGateway, ModelPolicy, SourceRef, TurnEvent } from '@edmate/contracts';
import type { MeterSink } from '@edmate/gateway';
import {
  defaultSteps,
  isBlockReply,
  PersonaStartPayloadSchema,
  runTurn,
  type Clock,
} from '@edmate/harness';
import type { MemoryUsageMeter } from '@edmate/harness/testing';
import type { EvalAgent, EvalAgentReply, EvalTurnInput, PriorTurn } from '@edmate/evals';
import { buildChatDeps, type ChatDepsOptions, type ChatSetup } from '../chat/deps.js';
import type { Env } from '../chat/gateway.js';
import type { ChatPackageId } from '../chat/world.js';

export interface LiveEvalAgentOptions {
  env: Env;
  /** Test injection only (rule 4): replaces the real Anthropic gateway. Never a real model call. */
  gateway?: ModelGateway;
  contentDir?: string;
  /** Overrides `DEFAULT_MODEL_POLICY` for the run (task 7.6 Phase B: one candidate model). */
  modelPolicy?: ModelPolicy;
  market?: string;
  packageId?: ChatPackageId;
  /**
   * Shares one usage meter across every `reply()` call this agent makes (task 7.6 Phase B: the
   * sweep passes one meter per (model, suite) run so its rows cover the whole suite, not just
   * one case). Defaults to a fresh meter per call, matching Phase A's "one fresh session" design.
   */
  usage?: MemoryUsageMeter;
  /** Forwarded to `buildChatDeps` (task 7.6 Phase B: the sweep counts unpriced calls). */
  onUnmetered?: (usage: Parameters<MeterSink['recordUnmetered']>[0]) => void;
  /** Test injection only: `slackClock` widens every step budget so a cold run on a loaded CI
   * runner doesn't overrun preGuard's timeout (same need as `chat/deps.test.ts`'s own tests). */
  clock?: Clock;
  /** An `openai-compatible` candidate's base URL (task 7.6a), forwarded to `buildChatDeps`. */
  baseURL?: string;
}

/** One `Message` row for the transcript store, built from a plain string. */
function message(role: Message['role'], text: string): Message {
  return { id: `msg_${randomUUID()}`, role, text, createdAt: new Date().toISOString() };
}

/** Seeds `input.priorTurns` directly into the session's transcript history (no live replay,
 * task 7.6's planner decision): teacher (if any), then student, then the agent's reply, in
 * order, per prior turn. */
async function seedPriorTurns(
  sessionId: string,
  priorTurns: readonly PriorTurn[],
  transcripts: { append(sessionId: string, m: Message): Promise<void> },
): Promise<void> {
  for (const turn of priorTurns) {
    if (turn.teacher !== undefined) {
      await transcripts.append(sessionId, message('teacher', turn.teacher));
    }
    await transcripts.append(sessionId, message('student', turn.student));
    await transcripts.append(sessionId, message('agent', turn.reply));
  }
}

/** Builds one reply from a finished turn's event stream (`chat.ts`'s `renderEvent` handles the
 * same event shapes for display; this collects them into one `EvalAgentReply` instead).
 *
 * `blocked` (task 7.6): `defaultSteps`' real guard chain never emits an `error: guard_blocked`
 * event for an ordinary moderationIn/jailbreak block — every such block replies with one of
 * `BLOCK_REPLIES`' fixed strings followed by `done` (`preGuard.ts`). So `blocked` is set from the
 * *final reply text* via `isBlockReply`, not from the event stream: `true` when the finished
 * text is exactly one of those fixed replies, `false` otherwise. The `error: guard_blocked`
 * event is still honoured first (a block with no code, the runner's generic fallback) in case it
 * ever fires; it is never overridden by the text check below.
 *
 * A `guard_blocked` event itself splits two ways (pipeline/policies.ts, same fix as the gate's
 * `collectReply`, apps/worker/src/gate/agent.ts, 8.7b fix round): a guard that decided to block
 * (`PRE_GUARD_BLOCKED`, `retryable: false`) is a real block, but a pre-guard chain that failed
 * (`PRE_GUARD_FAILED`, `retryable: true`: classifier outage, timeout, bad output) never got a
 * verdict, so the case fails instead of scoring it blocked. Every other `error` event (8.7g: for
 * example `model_error`) also fails the case, the same way the gate's `collectReply` does — today
 * it was silently scored as an empty or partial reply instead. */
async function collectReply(events: AsyncIterable<TurnEvent>): Promise<EvalAgentReply> {
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
        if (event.code === 'guard_blocked' && !event.retryable) blocked = true;
        else if (event.code === 'guard_blocked') {
          failed = 'guard_blocked (pre-guard failed, retryable)';
        } else failed = event.code;
        break;
      default:
        break;
    }
  }
  if (failed !== undefined) throw new Error(`live eval turn failed: ${failed}`);
  return {
    text,
    ...(sources === undefined ? {} : { sources }),
    blocked: blocked ?? isBlockReply(text),
    ...(escalated === undefined ? {} : { escalated }),
  };
}

/** Takes the bare persona id (the part of `personaRef` before `@`, or the whole string if there
 * is no `@`) and validates it against `PersonaStartPayloadSchema` (task 5.8d): a start turn's
 * `skillPayload` must be a bare id, no version, matching `chatTurnInput`'s `/roleplay <id>`
 * convention. Throws a clear error naming the bad ref on a malformed case instead of silently
 * sending a plain message (lesson: "a silent no-op is easy to miss"). */
function startPayloadFor(personaRef: string): { persona: string } {
  const bareId = personaRef.split('@')[0] ?? personaRef;
  const parsed = PersonaStartPayloadSchema.safeParse({ persona: bareId });
  if (!parsed.success) {
    throw new Error(`live eval: malformed persona ref "${personaRef}" (bare id "${bareId}" invalid)`);
  }
  return parsed.data;
}

/**
 * The pipeline-backed `EvalAgent`: one `ChatSetup` per `caseId` (task 5.8d), cached in a
 * `Map<string, ChatSetup>` closed over this agent instance (matching the existing "fresh agent
 * per `--models` sweep pairing" design). The first `reply()` call for a `caseId` builds a fresh
 * session and seeds `input.priorTurns`; every later call for the same `caseId` reuses that
 * session (and ignores `priorTurns` — the session already holds that history for real, more
 * accurate than re-seeding synthetic text), so role-play state (the question count, the stored
 * persona id) carries across turns the way it does in production. Turn 0 of a persona case is
 * sent as a `skill_action` start carrying only the bare persona id
 * (`startPayloadFor`/`PersonaStartPayloadSchema`); every other turn is a plain message, tagged
 * with `input.skill` when present.
 */
export function buildLiveEvalAgent(opts: LiveEvalAgentOptions): EvalAgent {
  const sessions = new Map<string, ChatSetup>();

  async function setupFor(caseId: string, priorTurns: readonly PriorTurn[]): Promise<ChatSetup> {
    const cached = sessions.get(caseId);
    if (cached !== undefined) return cached;

    const depsOpts: ChatDepsOptions = {
      env: opts.env,
      market: opts.market ?? 'global',
      packageId: opts.packageId ?? 'paid',
      source: 'eval',
      evalStudentId: `eval-${caseId}`,
      ...(opts.gateway === undefined ? {} : { gateway: opts.gateway }),
      ...(opts.contentDir === undefined ? {} : { contentDir: opts.contentDir }),
      ...(opts.modelPolicy === undefined ? {} : { modelPolicy: opts.modelPolicy }),
      ...(opts.clock === undefined ? {} : { clock: opts.clock }),
      ...(opts.usage === undefined ? {} : { usage: opts.usage }),
      ...(opts.onUnmetered === undefined ? {} : { onUnmetered: opts.onUnmetered }),
      ...(opts.baseURL === undefined ? {} : { baseURL: opts.baseURL }),
    };
    const setup = await buildChatDeps(depsOpts);
    await seedPriorTurns(setup.sessionId, priorTurns, setup.deps.transcripts);
    sessions.set(caseId, setup);
    return setup;
  }

  return {
    async reply(input: EvalTurnInput): Promise<EvalAgentReply> {
      const setup = await setupFor(input.caseId, input.priorTurns);

      if (input.teacher !== undefined) {
        await setup.deps.transcripts.append(setup.sessionId, message('teacher', input.teacher));
      }

      const base = {
        agentId: setup.agentId,
        sessionId: setup.sessionId,
        studentId: setup.studentId,
        lang: 'en' as const,
        clientTs: new Date().toISOString(),
      };
      const turnInput =
        input.turnIndex === 0 && input.persona !== undefined
          ? {
              ...base,
              kind: 'skill_action' as const,
              skill: 'mock_interview' as const,
              skillPayload: startPayloadFor(input.persona),
            }
          : {
              ...base,
              kind: 'message' as const,
              text: input.student,
              ...(input.skill === undefined ? {} : { skill: input.skill }),
            };

      const run = runTurn(turnInput, { deps: setup.deps, steps: defaultSteps });
      const reply = await collectReply(run.events);
      await run.finished;
      return reply;
    },
  };
}
