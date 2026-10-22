// The pipeline-backed `EvalAgent` (task 7.6 Phase A): adapts the real turn pipeline
// (`buildChatDeps`/`runTurn`, task 3.9) to `packages/evals`' `EvalAgent` interface, so
// `edmate eval --record` runs real suites against the real agent instead of the stub
// `unwiredAgent`. No real model call in tests (rule 4): every test injects a scripted
// `ModelGateway` via `LiveEvalAgentOptions.gateway`, exactly as `chat/deps.ts` already does.
import { randomUUID } from 'node:crypto';
import type { Message, ModelGateway, ModelPolicy, SourceRef, TurnEvent } from '@edmate/contracts';
import { defaultSteps, runTurn, type Clock } from '@edmate/harness';
import type { EvalAgent, EvalAgentReply, EvalTurnInput, PriorTurn } from '@edmate/evals';
import { buildChatDeps, type ChatDepsOptions } from '../chat/deps.js';
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
  /** Test injection only: `slackClock` widens every step budget so a cold run on a loaded CI
   * runner doesn't overrun preGuard's timeout (same need as `chat/deps.test.ts`'s own tests). */
  clock?: Clock;
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
 * same event shapes for display; this collects them into one `EvalAgentReply` instead). */
async function collectReply(events: AsyncIterable<TurnEvent>): Promise<EvalAgentReply> {
  let text = '';
  let sources: SourceRef[] | undefined;
  let blocked: boolean | undefined;
  let escalated: boolean | undefined;
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
        break;
      default:
        break;
    }
  }
  return {
    text,
    ...(sources === undefined ? {} : { sources }),
    ...(blocked === undefined ? {} : { blocked }),
    ...(escalated === undefined ? {} : { escalated }),
  };
}

/**
 * The pipeline-backed `EvalAgent`: one fresh in-memory `ChatSetup` per `reply()` call (one case
 * = one fresh session), seeded with `input.priorTurns`, then one live `runTurn` for
 * `input.student`. `input.skill`/`input.persona` have no `TurnInput` field to carry them onto a
 * plain turn today (lead answer Q2, task 7.6); a case naming either is run as a plain message and
 * flagged as a gap in the handoff, not guessed at here.
 */
export function buildLiveEvalAgent(opts: LiveEvalAgentOptions): EvalAgent {
  return {
    async reply(input: EvalTurnInput): Promise<EvalAgentReply> {
      const depsOpts: ChatDepsOptions = {
        env: opts.env,
        market: opts.market ?? 'global',
        packageId: opts.packageId ?? 'paid',
        source: 'eval',
        evalStudentId: `eval-${input.caseId}`,
        ...(opts.gateway === undefined ? {} : { gateway: opts.gateway }),
        ...(opts.contentDir === undefined ? {} : { contentDir: opts.contentDir }),
        ...(opts.modelPolicy === undefined ? {} : { modelPolicy: opts.modelPolicy }),
        ...(opts.clock === undefined ? {} : { clock: opts.clock }),
      };
      const setup = await buildChatDeps(depsOpts);
      await seedPriorTurns(setup.sessionId, input.priorTurns, setup.deps.transcripts);

      if (input.teacher !== undefined) {
        await setup.deps.transcripts.append(setup.sessionId, message('teacher', input.teacher));
      }

      const run = runTurn(
        {
          agentId: setup.agentId,
          sessionId: setup.sessionId,
          studentId: setup.studentId,
          kind: 'message',
          text: input.student,
          lang: 'en',
          clientTs: new Date().toISOString(),
        },
        { deps: setup.deps, steps: defaultSteps },
      );
      const reply = await collectReply(run.events);
      await run.finished;
      return reply;
    },
  };
}
