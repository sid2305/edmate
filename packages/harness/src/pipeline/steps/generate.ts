// Step 8, generate (task 3.7): streams the reply through the turn gateway, runs the tool rounds,
// and sends the turn's events in this order:
//   hint_rung? → (token | skill)* in stream order → sources? → locked?
// (teacher_question, replace and done are the runner's). The runner picks the model for each
// attempt through `env.gateway`, times the attempt, retries once, and clears shown text.
//
// The request is 3.6's `buildModelRequest` plus the tools: those the decision named whose skill
// is in the entitlement, checked again here (access rule 5). Usage goes through `env.usage` as it
// streams, which enforces the per-turn cost ceiling.
//
// Answer leaks (4.5): the default stream gate is the sentence gate (generate/streamGate.ts), so a
// sentence holding the answer key is never shown. The result carries everything the model wrote
// (`raw`) and whether the gate withheld anything (`withheld`); postGuard forces the hint on either.
// A source whose title or locator holds the key is dropped (and reported).
//
// Locked material (4.6): one locked check per attempt (steps/locked.ts), scoped to the
// entitlement's teacher and allowed modules. Each sentence is checked before it is shown, each
// tool output before the model sees it, each skill payload before it is sent; the result says
// when the stream withheld text (`locked`), and postGuard then replaces the whole reply.
//
// Practice items (5.6, ADR-0010): an item tool's copy is bound to the session's practice state
// for this attempt. The moment it issues an item, the tool loop has looked its key up on the
// server; generate adds it, on the same turn, to the stream gate, to the list later tool outputs,
// skill payloads and sources are checked against, and to `practiceAnswerKey`. The runner unions
// `practiceAnswerKey` with the items it collected through `onPracticeItem` into postGuard's keys.
// The key is never put in the model's prompt on this turn. A gate that cannot take new keys
// (no `addKeys`) shows nothing more once an item is issued, and the attempt counts as withheld,
// so postGuard puts the safe hint in its place (fail closed).
//
// Answer context (5.6b): the gate is built with the active items the runner passes (the item the
// loaded help state holds, and those earlier attempts issued) and the turn's practice keys; each
// item issued here goes to the gate with its key (`addKeys(fresh, [item])`, even when `fresh` is
// empty), so the model may restate an item's prompt and exact option listing, never its answer.
import type { AgentConfig, PedagogyDecision, TurnContext, TurnEvent } from '@edmate/contracts';
import { decisionRequest, regulatedTopic } from '../../guardrails/adviceGuard.js';
import type { LockedCheck } from '../../guardrails/answerLeak.js';
import { buildModelRequest } from '../../pedagogy/modelRequest.js';
import { resolvePromptPackSet } from '../../pedagogy/promptPacks.js';
import { citedSources } from '../generate/citations.js';
import { SkillEventDropped, skillEvent } from '../generate/skillEvent.js';
import { revealsAnswerKey } from '../generate/answerKey.js';
import { itemContextOf } from '../generate/itemContext.js';
import { answerLeakStreamGate } from '../generate/streamGate.js';
import { DEFAULT_COVERAGE_THRESHOLD } from '../../pedagogy/coverage.js';
import { HarnessError } from '../errors.js';
import { runToolLoop } from '../generate/toolLoop.js';
import { noTools, offeredTools } from '../tools.js';
import type { StepEnv, Steps } from '../types.js';
import { lockedCheckFor } from './locked.js';

/** The ladder moves whose rung the student's screen shows (9.4). */
const HINT_MOVES: ReadonlySet<PedagogyDecision['move']> = new Set([
  'hint',
  'worked_example',
  'solution',
]);

/** Names only the student's own package, and only when the teacher chose that (3.6). */
function lockedEvent(pkg: TurnContext['pkg']): Extract<TurnEvent, { type: 'locked' }> {
  return pkg.lockedReply === 'name_package'
    ? { type: 'locked', packageName: pkg.name }
    : { type: 'locked' };
}

/** How close to the coverage threshold a turn's best chunk must be for its reply to be held. */
export const HOLD_MARGIN = 0.1;
/** Moves that teach (grounding judges them). */
const TEACHING_MOVES: ReadonlySet<PedagogyDecision['move']> = new Set([
  'ask',
  'hint',
  'worked_example',
  'explain',
  'solution',
  'check',
]);

/**
 * Whether the reply is held, not streamed, until postGuard passes it (task 4.7, lead answer 13):
 * an ask_teacher turn, or a teaching turn whose best scored chunk is under the coverage threshold
 * plus HOLD_MARGIN, where grounding is most likely to replace the reply. Fix round 1: also a
 * teaching turn with nothing retrieved, or one decide.fallback chose (`fromFallback`), since that
 * path never ran the coverage gate. A teaching turn whose chunks are all unscored still streams.
 *
 * Task 4.8 (lead decisions, risk: high): every move of a regulated-subject agent (investing,
 * health, law) is held, and so is any turn whose (scrubbed) student message asks for a decision
 * (adviceGuard's pre-filter), so advice is never on screen before adviceGuard has judged it.
 * Fix round 1: every `redirect` move is held too, on every agent, and so is any turn whose student
 * message names a regulated topic (money, health, law).
 */
export function holdsReply(
  ctx: Pick<TurnContext, 'retrieved'> & { agent?: Pick<AgentConfig, 'regulatedSubject'> },
  move: PedagogyDecision['move'],
  threshold: number = DEFAULT_COVERAGE_THRESHOLD,
  fromFallback = false,
  studentText?: string,
): boolean {
  if (ctx.agent?.regulatedSubject !== undefined) return true;
  if (studentText !== undefined && (decisionRequest(studentText) || regulatedTopic(studentText))) {
    return true;
  }
  // A redirect may answer the off-topic question anyway (4.8 fix round 1): adviceGuard judges it.
  if (move === 'ask_teacher' || move === 'redirect') return true;
  if (!TEACHING_MOVES.has(move)) return false;
  if (fromFallback || ctx.retrieved.length === 0) return true;
  const scores = ctx.retrieved.flatMap((c) => (c.score === undefined ? [] : [c.score]));
  return scores.length > 0 && Math.max(...scores) < threshold + HOLD_MARGIN;
}

/** A cited source's title or locator held the answer key, so it was not sent. Fixed text only. */
export class SourceDropped extends HarnessError {
  override readonly name = 'SourceDropped';

  constructor() {
    super('a cited source label held the answer key and was dropped');
  }
}

export interface GenerateOptions {
  /** Builds the turn's locked check; default `lockedCheckFor`. Tests only (mutation runs). */
  lockedCheck?: (env: StepEnv, ctx: TurnContext) => LockedCheck;
}

/** The generate step; `opts` exists for tests that swap the locked check. */
export function createGenerate(opts: GenerateOptions = {}): Steps['generate'] {
  const lockedCheckOf = opts.lockedCheck ?? lockedCheckFor;
  return async (
    env,
    {
      ctx,
      decision,
      sources,
      lockedStopped,
      onLockedTrip,
      fromFallback,
      practice,
      issuedKeys,
      onPracticeItem,
      items,
      practiceKeys,
    },
    emit,
  ) => {
    const { deps } = env;
    // Before anything is shown: a turn already at its ceiling makes no call and shows nothing.
    env.usage.checkBeforeCall();
    const set = resolvePromptPackSet(deps.promptPacks, ctx.agent.promptPackVersion);
    const request = buildModelRequest({ ctx, decision, input: env.input, set });
    /** The served ids, live: an item issued this attempt is not served again by a later call. */
    const served = [...(practice?.servedItemIds ?? [])];
    /** Every key guarded this attempt: the decision's, then each practice item's as it comes. */
    const guarded: string[] = [...decision.mustNotReveal];
    /** This turn's issued keys so far (earlier attempts', then this one's), live. */
    const turnIssued: string[] = [...(issuedKeys ?? [])];
    const session =
      practice === undefined
        ? undefined
        : { ...practice, servedItemIds: served, heldKeys: guarded, issuedKeys: turnIssued };
    const offered = offeredTools(deps.tools ?? noTools, decision.tools, ctx.entitlement).map((r) =>
      session !== undefined && r.forSession !== undefined ? r.forSession(session) : r,
    );
    const studentText = env.input.text;
    /** This attempt's issued practice keys (GenerateResult.practiceAnswerKey). */
    const issued: string[] = [];
    const guard = (keys: readonly string[]) => {
      const fresh = keys.filter((k) => !guarded.includes(k));
      guarded.push(...fresh);
      return fresh;
    };
    guard(issuedKeys ?? []);
    const gateDecision = { ...decision, mustNotReveal: [...guarded] };
    // 5.6b: the active items (the loaded one, earlier attempts' issued ones) and every practice
    // key: a re-show of an item is exempt and held back until whole; its keys stay guarded.
    const gate = (deps.streamGate ?? answerLeakStreamGate)({
      ctx,
      decision: gateDecision,
      ...(studentText === undefined ? {} : { studentText }),
      ...(items === undefined ? {} : { items }),
      practiceKeys: [...(practiceKeys ?? []), ...(issuedKeys ?? [])],
    });

    const lockedCheck = lockedCheckOf(env, ctx);
    const held = holdsReply(ctx, decision.move, undefined, fromFallback === true, studentText);
    /** An item was issued but the gate can't take its key: show nothing more (fail closed). */
    let holdRest = false;

    if (HINT_MOVES.has(decision.move)) emit({ type: 'hint_rung', rung: decision.rung });
    const { draft, raw, locked } = await runToolLoop({
      gateway: env.gateway,
      request,
      offered,
      ctx,
      clock: deps.clock,
      cancel: env.cancel,
      usage: env.usage,
      gate,
      // A held reply is still gated and checked as it streams; it is only not shown yet.
      show: (text) => {
        if (!held && !holdRest) emit({ type: 'token', text });
      },
      onToolOutput: async (entry, output, item) => {
        // The item's own payload is checked against the keys guarded before it: its prompt was
        // validated against its own key when the item was made (validateItem).
        const before = [...guarded];
        if (item !== undefined) {
          const fresh = guard(item.answerKey);
          // The item goes to the gate even when its key is already guarded (5.6b): its re-show
          // is then exempt and held back until whole.
          if (gate.addKeys === undefined) holdRest = true;
          else gate.addKeys(fresh, [itemContextOf(item)]);
          for (const k of item.answerKey) {
            if (!issued.includes(k)) issued.push(k);
            if (!turnIssued.includes(k)) turnIssued.push(k);
          }
          served.push(item.itemId);
          onPracticeItem?.(item);
        }
        const e = await skillEvent(entry, output, ctx, before, lockedCheck, item?.shown);
        if (e instanceof SkillEventDropped) env.report(e);
        else if (e !== undefined) emit(e);
      },
      report: env.report,
      mustNotReveal: guarded,
      lockedCheck,
      holdAll: lockedStopped === true,
      ...(onLockedTrip === undefined ? {} : { onLocked: onLockedTrip }),
      track: env.track,
    });

    const cited = citedSources(draft, sources).filter((s) => {
      const leaks = revealsAnswerKey([s.title, s.locator], guarded);
      if (leaks) env.report(new SourceDropped());
      return !leaks;
    });
    if (cited.length > 0) emit({ type: 'sources', items: cited });
    if (decision.move === 'locked') emit(lockedEvent(ctx.pkg));
    return {
      draft,
      raw,
      withheld: gate.tripped === true || holdRest,
      ...(locked === undefined ? {} : { locked }),
      ...(held ? { held } : {}),
      ...(issued.length > 0 ? { practiceAnswerKey: issued } : {}),
    };
  };
}

export const generate: Steps['generate'] = createGenerate();
