// generate's model calls and tool rounds (task 3.7). A round is one streamed call; when it asked
// for tools, they run one after another and the next call carries the JSON envelopes. At most
// MAX_TOOL_ROUNDS tool rounds; after that the final call offers no tools, and a tool call on a
// call that offered none fails the attempt (the runner's retry policy applies).
//
// Every call is checked before anything runs: the tool must have been offered (so it is in the
// registry and entitled), its args must be JSON-safe and pass `tool.input`, and its output must
// pass `tool.output` and fit TOOL_RESULT_MAX_JSON_LENGTH. The model only ever sees a fixed error
// code for a failed call, never an error message.
//
// Locked material (4.6): every piece the answer gate releases goes through the stream's locked
// check (lockedStream.ts) before it is shown, and every tool output is checked (each string leaf
// and the leaves joined) before the model sees it. A hit or a failed check fails the tool call
// (`locked`); in the stream it withholds the rest of the attempt and the result says so.
import {
  LIMITS,
  type ModelChunk,
  type ModelGateway,
  type ModelRequest,
  type TurnContext,
} from '@edmate/contracts';
import { type CancelToken, type Clock, linkCancel } from '../clock.js';
import { errorName, HarnessError, TurnCancelled } from '../errors.js';
import { runWithTimeout } from '../timeout.js';
import { type IssuedItem, type RegisteredTool, toolSpec } from '../tools.js';
import type { UsageRecorder } from '../types.js';
import type { LockedCheck } from '../../guardrails/answerLeak.js';
import { stringLeaves } from '../../guardrails/lockedMatch.js';
import { revealsAnswerKey } from './answerKey.js';
import { lockedStream } from './lockedStream.js';
import type { StreamGate } from './streamGate.js';
import { raceCancel, StreamReader } from './streamReader.js';
import {
  jsonSafe,
  type ToolCallRecord,
  type ToolErrorCode,
  toolCallsMessage,
  type ToolResultRecord,
  toolResultsMessage,
} from './toolMessages.js';

/** Tool rounds per attempt (provisional; revisit at 5.5). */
export const MAX_TOOL_ROUNDS = 3;
/** Tool calls run per round; the rest get `too_many_calls` (provisional; revisit at 5.5). */
export const MAX_TOOL_CALLS_PER_ROUND = 4;
/** One tool run, on the injected clock, inside the attempt's 15 s (provisional). */
export const TOOL_TIMEOUT_MS = 3_000;
/** A tool result's JSON, in UTF-16 units; a longer one is `failed` (provisional). */
export const TOOL_RESULT_MAX_JSON_LENGTH = 4_000;

/** The model asked for a tool on a call that offered none. Names no tool (model-chosen text). */
export class ToolCallNotOfferedError extends HarnessError {
  override readonly name = 'ToolCallNotOfferedError';

  constructor() {
    super('the model called a tool on a call that offered no tools');
  }
}

/** Why a tool call failed, as reported (the model sees only `failed` or `timed_out`). */
export type ToolFailReason =
  | 'failed'
  | 'timed_out'
  | 'invalid_output'
  | 'not_json'
  | 'too_large'
  | 'answer_key'
  | 'locked'
  | 'no_answer_key';

/** A tool call failed. Names the tool, a fixed reason and the thrown error's name, never a message. */
export class ToolFailed extends HarnessError {
  override readonly name = 'ToolFailed';

  constructor(
    readonly tool: string,
    readonly reason: ToolFailReason,
    readonly causeName?: string,
  ) {
    super(`tool "${tool}" failed: ${reason}` + (causeName === undefined ? '' : ` (${causeName})`));
  }
}

export interface ToolLoopInput {
  gateway: ModelGateway;
  /** The first call's request, without `tools`. */
  request: ModelRequest;
  /** Already filtered to the registry's entitled tools that the decision named. */
  offered: readonly RegisteredTool[];
  ctx: TurnContext;
  clock: Clock;
  cancel: CancelToken;
  usage: UsageRecorder;
  gate: StreamGate;
  /** Shows a piece of text to the student (a `token` event). */
  show(text: string): void;
  /**
   * A tool ran and its output passed every check (awaited before the next call). `issued` is the
   * item it issued, with its server-side key (5.6), for a tool with `issuedItem`.
   */
  onToolOutput(entry: RegisteredTool, output: unknown, issued?: IssuedItem): void | Promise<void>;
  report(error: unknown): void;
  /**
   * The do-not-say list: a tool output holding one is `failed`. Read at each call, so keys the
   * caller adds mid-attempt (a practice item's, 5.6) count for later calls in the same attempt.
   */
  mustNotReveal: readonly string[];
  /**
   * The locked check (4.6, required): run on each sentence before it is shown and on each tool
   * output before the model sees it. A hit or a rejection withholds or fails (fail closed).
   */
  lockedCheck: LockedCheck;
  /**
   * Session-wide stop (ADR-0007 §8, 4.6b): after a locked hit or failed check earlier in the
   * session, hold the whole reply and show it only once the attempt ends cleanly. Default false.
   */
  holdAll?: boolean;
  /**
   * Told at once of every locked hit or failed locked check (the stream tripping, or a tool
   * output failed as `locked`), so the runner can save the session's stop flag even when the
   * attempt then fails (4.6b fix round 1).
   */
  onLocked?: () => void;
  /** Background work (a stream close) the runner waits for before `finished`. */
  track(settled: Promise<unknown>): void;
}

type ToolCallChunk = Extract<ModelChunk, { type: 'tool_call' }>;

export interface ToolLoopResult {
  draft: string;
  raw: string;
  toolRounds: number;
  /** Set when the stream's locked check withheld text: a hit, or a check that failed. */
  locked?: 'hit' | 'failed';
}

export async function runToolLoop(i: ToolLoopInput): Promise<ToolLoopResult> {
  const specs = i.offered.map(toolSpec);
  const byName = new Map(i.offered.map((r) => [r.tool.name, r]));
  const extra: ModelRequest['messages'] = [];
  let draft = '';
  /** Everything the model wrote, shown or not (postGuard checks all of it). */
  let raw = '';
  let rounds = 0;
  const locked = lockedStream(i.lockedCheck, i.report, i.cancel, {
    holdAll: i.holdAll === true,
    onTrip: () => i.onLocked?.(),
  });
  /** Shows sentences once the locked check passed them. */
  const show = async (sentences: readonly string[]) => {
    for (const p of await locked.check(sentences)) {
      draft += p;
      i.show(p);
    }
  };

  for (;;) {
    const withTools = specs.length > 0 && rounds < MAX_TOOL_ROUNDS;
    i.usage.checkBeforeCall();
    const req: ModelRequest = {
      ...i.request,
      messages: [...i.request.messages, ...extra],
      ...(withTools ? { tools: specs } : {}),
    };
    const reader = new StreamReader(i.gateway.stream(req), i.cancel, i.report, i.track);
    const calls: ToolCallChunk[] = [];
    let roundText = '';
    try {
      for (let c = await reader.next(); c !== undefined; c = await reader.next()) {
        if (c.type === 'text') {
          roundText += c.text;
          // Kept up to a reply's maximum; past it the gate has tripped and the reply is the hint.
          if (raw.length < LIMITS.modelTextMaxLength) {
            raw += c.text.slice(0, LIMITS.modelTextMaxLength - raw.length);
          }
          // Most pieces end no sentence: nothing to check, nothing to wait for.
          const sentences = locked.split(i.gate.push(c.text));
          if (sentences.length > 0) await show(sentences);
        } else if (c.type === 'usage') {
          i.usage.record(c.usage);
        } else {
          if (!withTools) throw new ToolCallNotOfferedError();
          calls.push(c);
        }
      }
    } finally {
      reader.close();
    }
    // The gate is flushed once, when the attempt ends: never between tool rounds, so a key split
    // across rounds is still judged whole.
    if (calls.length === 0) {
      const last = [...locked.split(i.gate.flush()), ...locked.rest()];
      if (last.length > 0) await show(last);
      // The attempt ended cleanly (or was already tripped, where this is empty): anything the
      // locked check passed but held back (the carryover, or the whole reply under `holdAll`) is
      // safe to show now, nothing more can come to join it into a longer span.
      for (const p of await locked.release()) {
        draft += p;
        i.show(p);
      }
      const tripped = locked.tripped;
      return {
        draft,
        raw,
        toolRounds: rounds,
        ...(tripped === undefined ? {} : { locked: tripped }),
      };
    }

    rounds++;
    const records: ToolCallRecord[] = [];
    const results: ToolResultRecord[] = [];
    for (const [n, c] of calls.entries()) {
      const args = jsonSafe(c.args);
      records.push({ id: c.id, name: c.name, args: args.ok ? args.value : null });
      const fail = (error: ToolErrorCode): ToolResultRecord => ({
        id: c.id,
        name: c.name,
        ok: false,
        error,
      });
      const entry = byName.get(c.name);
      if (entry === undefined) {
        results.push(fail('not_available'));
        continue;
      }
      if (n >= MAX_TOOL_CALLS_PER_ROUND) {
        results.push(fail('too_many_calls'));
        continue;
      }
      const parsed = args.ok ? entry.tool.input.safeParse(args.value) : undefined;
      if (parsed === undefined || !parsed.success) {
        results.push(fail('invalid_arguments'));
        continue;
      }
      const out = await runTool(entry, parsed.data, i);
      if (typeof out === 'string') {
        results.push(fail(out));
        continue;
      }
      // An item tool (5.6, ADR-0010): its key is looked up on the server by item id before the
      // model sees the item. No key: the call fails closed, as the item could not be protected.
      let issued: IssuedItem | undefined;
      if (entry.issuedItem !== undefined) {
        let causeName: string | undefined;
        try {
          issued = entry.issuedItem(out.value, i.ctx);
        } catch (error) {
          causeName = errorName(error);
        }
        if (issued === undefined) {
          i.report(new ToolFailed(entry.tool.name, 'no_answer_key', causeName));
          results.push(fail('failed'));
          continue;
        }
      }
      results.push({ id: c.id, name: c.name, ok: true, output: out.value });
      await i.onToolOutput(entry, out.value, issued);
    }
    extra.push(toolCallsMessage(roundText, records), toolResultsMessage(results));
  }
}

/**
 * Runs one checked call; a fixed code on any failure, reported first (ToolFailed, error name
 * only. An output holding a do-not-say string or locked material is `failed`: it would hand the
 * model the answer or the locked text; so is one the locked check can't vouch for (fail closed).
 * Throws only TurnCancelled.
 */
async function runTool(
  entry: RegisteredTool,
  input: unknown,
  i: ToolLoopInput,
): Promise<{ value: unknown } | 'failed' | 'timed_out'> {
  const name = entry.tool.name;
  const failed = (reason: ToolFailReason, causeName?: string): 'failed' | 'timed_out' => {
    i.report(new ToolFailed(name, reason, causeName));
    return reason === 'timed_out' ? 'timed_out' : 'failed';
  };
  const r = await raceCancel(
    runWithTimeout(
      (cancel) =>
        raceCancel(
          Promise.resolve().then(() => entry.tool.run(input, i.ctx)),
          linkCancel(cancel, i.cancel),
        ),
      TOOL_TIMEOUT_MS,
      i.clock,
    ),
    i.cancel,
  );
  if (r.status === 'timeout') return failed('timed_out');
  if (r.status === 'error') return failed('failed', errorName(r.error));
  const checked = entry.tool.output.safeParse(r.value);
  if (!checked.success) return failed('invalid_output');
  const json = jsonSafe(checked.data);
  if (!json.ok) return failed('not_json');
  if (json.json.length > TOOL_RESULT_MAX_JSON_LENGTH) return failed('too_large');
  if (revealsAnswerKey(json.value, i.mustNotReveal)) return failed('answer_key');
  try {
    if (await raceCancel(i.lockedCheck(stringLeaves(json.value)), i.cancel)) {
      i.onLocked?.();
      return failed('locked');
    }
  } catch (error) {
    if (error instanceof TurnCancelled) throw error;
    i.onLocked?.();
    return failed('locked', errorName(error));
  }
  return { value: json.value };
}
