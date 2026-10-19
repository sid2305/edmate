// Tool calls and results over the frozen ModelRequest (task 3.7, lead answer Q4). The request has
// only user and assistant messages, so a tool round adds one assistant message (the round's text,
// then a `{"tool_calls":[...]}` JSON envelope) and one user message (a `{"tool_results":[...]}`
// envelope). Both envelopes are built in code from checked data, with no prose, so no prompt-pack
// change is needed. An ADR for native tool messages comes before 5.5's real tools meet a real model.
import type { ModelRequest } from '@edmate/contracts';

type RequestMessage = ModelRequest['messages'][number];

/** Fixed codes the model sees for a failed call; never an error message or internals. */
export type ToolErrorCode =
  'not_available' | 'invalid_arguments' | 'failed' | 'timed_out' | 'too_many_calls';

/** One call as the model made it; `args` is the JSON-safe copy, or `null` when it had none. */
export interface ToolCallRecord {
  id: string;
  name: string;
  args: unknown;
}

export type ToolResultRecord =
  | { id: string; name: string; ok: true; output: unknown }
  | { id: string; name: string; ok: false; error: ToolErrorCode };

/** A JSON round trip of `value`, or not ok when it can't be serialised (cycles, BigInt, ...). */
export function jsonSafe(
  value: unknown,
): { ok: true; value: unknown; json: string } | { ok: false } {
  try {
    const json = JSON.stringify(value) as string | undefined;
    if (json === undefined) return { ok: false };
    return { ok: true, value: JSON.parse(json) as unknown, json };
  } catch {
    return { ok: false };
  }
}

export function toolCallsMessage(
  roundText: string,
  calls: readonly ToolCallRecord[],
): RequestMessage {
  const envelope = JSON.stringify({
    tool_calls: calls.map((c) => ({ id: c.id, name: c.name, args: c.args })),
  });
  return { role: 'assistant', content: roundText === '' ? envelope : `${roundText}\n${envelope}` };
}

export function toolResultsMessage(results: readonly ToolResultRecord[]): RequestMessage {
  return {
    role: 'user',
    content: JSON.stringify({
      tool_results: results.map((r) =>
        r.ok
          ? { id: r.id, name: r.name, ok: true, output: r.output }
          : { id: r.id, name: r.name, ok: false, error: r.error },
      ),
    }),
  };
}
