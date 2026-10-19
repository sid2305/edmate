// generate's model calls and tool rounds (task 3.7). A round is one streamed call; when it asked
// for tools, they run one after another and the next call carries the JSON envelopes. At most
// MAX_TOOL_ROUNDS tool rounds; after that the final call offers no tools, and a tool call on a
// call that offered none fails the attempt (the runner's retry policy applies).
//
// Every call is checked before anything runs: the tool must have been offered (so it is in the
// registry and entitled), its args must be JSON-safe and pass `tool.input`, and its output must
// pass `tool.output` and fit TOOL_RESULT_MAX_JSON_LENGTH. The model only ever sees a fixed error
// code for a failed call, never an error message.
import type { ModelChunk, ModelGateway, ModelRequest, TurnContext } from '@edmate/contracts';
import { type CancelToken, type Clock, linkCancel } from '../clock.js';
import { errorName, HarnessError } from '../errors.js';
import { runWithTimeout } from '../timeout.js';
import { type RegisteredTool, toolSpec } from '../tools.js';
import type { UsageRecorder } from '../types.js';
import { revealsAnswerKey } from './answerKey.js';
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
  'failed' | 'timed_out' | 'invalid_output' | 'not_json' | 'too_large' | 'answer_key';

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
  /** A tool ran and its output passed every check. */
  onToolOutput(entry: RegisteredTool, output: unknown): void;
  report(error: unknown): void;
  /** The decision's do-not-say list: a tool output holding one is `failed`. */
  mustNotReveal: readonly string[];
  /** Background work (a stream close) the runner waits for before `finished`. */
  track(settled: Promise<unknown>): void;
}

type ToolCallChunk = Extract<ModelChunk, { type: 'tool_call' }>;

export async function runToolLoop(
  i: ToolLoopInput,
): Promise<{ draft: string; toolRounds: number }> {
  const specs = i.offered.map(toolSpec);
  const byName = new Map(i.offered.map((r) => [r.tool.name, r]));
  const extra: ModelRequest['messages'] = [];
  let draft = '';
  let rounds = 0;
  const show = (pieces: readonly string[]) => {
    for (const p of pieces) {
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
          show(i.gate.push(c.text));
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
    show(i.gate.flush());
    if (calls.length === 0) return { draft, toolRounds: rounds };

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
      results.push({ id: c.id, name: c.name, ok: true, output: out.value });
      i.onToolOutput(entry, out.value);
    }
    extra.push(toolCallsMessage(roundText, records), toolResultsMessage(results));
  }
}

/**
 * Runs one checked call; a fixed code on any failure, reported first (ToolFailed, error name
 * only). An output holding a do-not-say string is `failed`: it would hand the model the answer.
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
  return { value: json.value };
}
