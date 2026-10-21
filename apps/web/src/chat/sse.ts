// Task 9.4: reads the turn route's SSE response into stream items for the turn reducer.
// - Tolerant of chunk boundaries anywhere, including inside a UTF-8 character (streaming
//   TextDecoder) and between CR and LF.
// - Each event's `data` is JSON-parsed and checked with the contracts' TurnEventSchema. An event
//   that fails either check is never yielded: the reader yields one retryable `provider_error`
//   and stops (the reducer then drops the turn).
// - The end of the body (or a read failure) yields `ended`; a half-received event is dropped.
// - A non-2xx response yields one `error` event: the code from the JSON body when it is a known
//   code, else from the HTTP status. The server's message is never used.
import { type ErrorCode, ErrorCodeSchema, type TurnEvent, TurnEventSchema } from '@edmate/contracts';
import type { StreamItem } from './turnState';

/** The most characters one event (or one pending line) may hold before the stream is refused. */
export const MAX_EVENT_CHARS = 1_000_000;

const STREAM_ERROR: StreamItem = errorItem('provider_error', true);

function errorItem(code: ErrorCode, retryable: boolean): StreamItem {
  return { kind: 'event', event: { type: 'error', code, retryable } };
}

function statusError(status: number): { code: ErrorCode; retryable: boolean } {
  switch (status) {
    case 400:
      return { code: 'validation', retryable: false };
    case 401:
      return { code: 'unauthorized', retryable: false };
    case 403:
      return { code: 'forbidden', retryable: false };
    case 404:
      return { code: 'not_found', retryable: false };
    case 429:
      return { code: 'rate_limited', retryable: true };
    default:
      return { code: 'provider_error', retryable: true };
  }
}

/** The `{ error: { code, retryable } }` of a non-2xx response, with status fallbacks. */
export async function responseError(res: Response): Promise<{ code: ErrorCode; retryable: boolean }> {
  const fallback = statusError(res.status);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return fallback;
  }
  const err = (body as { error?: { code?: unknown; retryable?: unknown } } | null)?.error;
  const code = ErrorCodeSchema.safeParse(err?.code);
  if (!code.success) return fallback;
  const retryable = typeof err?.retryable === 'boolean' ? err.retryable : fallback.retryable;
  return { code: code.data, retryable };
}

function parseEvent(data: string): TurnEvent | null {
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return null;
  }
  const parsed = TurnEventSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/** Splits decoded text into SSE events; returns the `data` of each finished event. */
class SseParser {
  private buffer = '';
  private data: string[] = [];
  private dataChars = 0;
  overflow = false;

  push(text: string): string[] {
    this.buffer += text;
    const out: string[] = [];
    for (;;) {
      const nl = this.buffer.search(/[\r\n]/);
      if (nl < 0) break;
      // A lone CR at the very end may be the first half of a CRLF: wait for the next chunk.
      if (this.buffer[nl] === '\r' && nl === this.buffer.length - 1) break;
      const line = this.buffer.slice(0, nl);
      const skip = this.buffer[nl] === '\r' && this.buffer[nl + 1] === '\n' ? 2 : 1;
      this.buffer = this.buffer.slice(nl + skip);
      const done = this.line(line);
      if (done !== null) out.push(done);
    }
    if (this.buffer.length + this.dataChars > MAX_EVENT_CHARS) this.overflow = true;
    return out;
  }

  private line(line: string): string | null {
    if (line === '') {
      if (this.data.length === 0) return null;
      const data = this.data.join('\n');
      this.data = [];
      this.dataChars = 0;
      return data;
    }
    if (line.startsWith('data:')) {
      const value = line.slice(5);
      const v = value.startsWith(' ') ? value.slice(1) : value;
      this.data.push(v);
      this.dataChars += v.length;
    }
    // `event:`, `id:`, `retry:` and `:` comments are ignored: the JSON's `type` is the event type.
    return null;
  }
}

/** Stream items from a turn response: validated events, then `ended` (or one error and stop). */
export async function* readTurnStream(res: Response): AsyncGenerator<StreamItem> {
  if (!res.ok) {
    const { code, retryable } = await responseError(res);
    yield errorItem(code, retryable);
    return;
  }
  if (res.body === null) {
    yield { kind: 'ended' };
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  const parser = new SseParser();
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch {
        break; // a dropped connection ends the turn like a truncated stream
      }
      const text = chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      for (const data of parser.push(text)) {
        const event = parseEvent(data);
        if (event === null) {
          yield STREAM_ERROR;
          return;
        }
        yield { kind: 'event', event };
      }
      if (parser.overflow) {
        yield STREAM_ERROR;
        return;
      }
      if (chunk.done) break;
    }
    yield { kind: 'ended' };
  } finally {
    reader.cancel().catch(() => {});
  }
}
