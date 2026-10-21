// Task 9.4 Phase B: the SSE reader. Tolerant of chunk boundaries anywhere (including inside a
// UTF-8 character); every event is checked with TurnEventSchema and an invalid one ends the turn
// as an error (never shown); a truncated stream ends with `ended` and no done.
import type { TurnEvent } from '@edmate/contracts';
import { formatSseEvent } from '@edmate/harness';
import { describe, expect, it } from 'vitest';
import { readTurnStream, MAX_EVENT_CHARS } from './sse';
import type { StreamItem } from './turnState';

const enc = new TextEncoder();

function bodyOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      for (const chunk of chunks) c.enqueue(chunk);
      c.close();
    },
  });
}

function ok(chunks: Uint8Array[]): Response {
  return new Response(bodyOf(chunks), {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8' },
  });
}

async function collect(res: Response): Promise<StreamItem[]> {
  const out: StreamItem[] = [];
  for await (const item of readTurnStream(res)) out.push(item);
  return out;
}

const EVENTS: TurnEvent[] = [
  { type: 'token', text: 'Café 😀 नमस्ते\nline two' },
  { type: 'sources', items: [{ title: 'Notes', locator: 'p. 1', kind: 'material' }] },
  { type: 'replace', text: '' },
  { type: 'token', text: '<b>x</b> $x^2$' },
  { type: 'done', messageId: 'msg-1', usage: [] },
];
const FIXTURE = enc.encode(EVENTS.map(formatSseEvent).join(''));
const EXPECTED: StreamItem[] = [...EVENTS.map((event) => ({ kind: 'event' as const, event })), { kind: 'ended' }];

const errorItem = (code: string, retryable: boolean): StreamItem => ({
  kind: 'event',
  event: { type: 'error', code, retryable } as TurnEvent,
});

describe('readTurnStream', () => {
  it('reads a whole stream in one chunk, then ends', async () => {
    expect(await collect(ok([FIXTURE]))).toEqual(EXPECTED);
  });

  it('gives the same events for a split at every byte offset (including mid-UTF-8)', async () => {
    for (let i = 1; i < FIXTURE.length; i++) {
      const items = await collect(ok([FIXTURE.slice(0, i), FIXTURE.slice(i)]));
      expect(items, `split at byte ${i}`).toEqual(EXPECTED);
    }
  });

  it('gives the same events one byte at a time', async () => {
    const bytes = Array.from(FIXTURE, (b) => Uint8Array.of(b));
    expect(await collect(ok(bytes))).toEqual(EXPECTED);
  });

  it('accepts CRLF line endings, comments and a missing space after "data:"', async () => {
    const raw = ': keep-alive\r\nevent: token\r\ndata:{"type":"token","text":"a"}\r\n\r\n';
    expect(await collect(ok([enc.encode(raw)]))).toEqual([
      { kind: 'event', event: { type: 'token', text: 'a' } },
      { kind: 'ended' },
    ]);
  });

  it('joins a multi-line data field with newlines', async () => {
    const raw = 'event: token\ndata: {"type":"token",\ndata: "text":"joined"}\n\n';
    expect(await collect(ok([enc.encode(raw)]))).toEqual([
      { kind: 'event', event: { type: 'token', text: 'joined' } },
      { kind: 'ended' },
    ]);
  });

  it('skips a block with no data lines', async () => {
    const raw = 'event: ping\n\n' + formatSseEvent({ type: 'token', text: 'a' });
    expect(await collect(ok([enc.encode(raw)]))).toEqual([
      { kind: 'event', event: { type: 'token', text: 'a' } },
      { kind: 'ended' },
    ]);
  });

  it('invalid JSON ends the turn as a retryable provider_error and stops reading', async () => {
    const raw = formatSseEvent({ type: 'token', text: 'ok' }) + 'data: {not json\n\n' + formatSseEvent({ type: 'token', text: 'never' });
    expect(await collect(ok([enc.encode(raw)]))).toEqual([
      { kind: 'event', event: { type: 'token', text: 'ok' } },
      errorItem('provider_error', true),
    ]);
  });

  it.each([
    ['an unknown type', { type: 'html', text: '<script>alert(1)</script>' }],
    ['an extra field', { type: 'token', text: 'x', html: '<b>' }],
    ['a bad rung', { type: 'hint_rung', rung: 9 }],
    ['an unknown error code', { type: 'error', code: 'boom', retryable: true }],
  ])('a schema-invalid event (%s) is never yielded and ends as an error', async (_n, bad) => {
    const raw = `data: ${JSON.stringify(bad)}\n\n` + formatSseEvent({ type: 'token', text: 'never' });
    expect(await collect(ok([enc.encode(raw)]))).toEqual([errorItem('provider_error', true)]);
  });

  it('a truncated stream ends with `ended` and no done (the partial event is dropped)', async () => {
    const whole = formatSseEvent({ type: 'token', text: 'Half' });
    const cut = formatSseEvent({ type: 'token', text: 'never shown' }).slice(0, -1);
    expect(await collect(ok([enc.encode(whole + cut)]))).toEqual([
      { kind: 'event', event: { type: 'token', text: 'Half' } },
      { kind: 'ended' },
    ]);
  });

  it('an oversize event ends as an error', async () => {
    const raw = `data: ${'x'.repeat(MAX_EVENT_CHARS + 10)}`;
    expect(await collect(ok([enc.encode(raw)]))).toEqual([errorItem('provider_error', true)]);
  });

  it('a read failure mid-stream ends with `ended`', async () => {
    let sent = false;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (!sent) {
          sent = true;
          c.enqueue(enc.encode(formatSseEvent({ type: 'token', text: 'a' })));
        } else {
          c.error(new Error('socket reset'));
        }
      },
    });
    expect(await collect(new Response(body, { status: 200 }))).toEqual([
      { kind: 'event', event: { type: 'token', text: 'a' } },
      { kind: 'ended' },
    ]);
  });

  it('a 200 with no body just ends', async () => {
    expect(await collect(new Response(null, { status: 200 }))).toEqual([{ kind: 'ended' }]);
  });

  it('a non-2xx JSON error body becomes one error event with its code and retryable flag', async () => {
    const res = Response.json(
      { error: { code: 'no_access', message: 'SERVER WORDING', retryable: false } },
      { status: 403 },
    );
    expect(await collect(res)).toEqual([errorItem('no_access', false)]);
  });

  it.each([
    [401, 'unauthorized', false],
    [403, 'forbidden', false],
    [404, 'not_found', false],
    [400, 'validation', false],
    [429, 'rate_limited', true],
    [503, 'provider_error', true],
    [500, 'provider_error', true],
  ])('a non-2xx %i with no usable JSON maps to %s', async (status, code, retryable) => {
    const res = new Response('<html>oops</html>', { status });
    expect(await collect(res)).toEqual([errorItem(code, retryable)]);
  });

  it('a non-2xx with an unknown code in JSON falls back to the status mapping', async () => {
    const res = Response.json({ error: { code: 'weird', retryable: 'yes' } }, { status: 404 });
    expect(await collect(res)).toEqual([errorItem('not_found', false)]);
  });

  it('a non-2xx with a known code but no retryable flag uses the status default', async () => {
    const res = Response.json({ error: { code: 'rate_limited' } }, { status: 429 });
    expect(await collect(res)).toEqual([errorItem('rate_limited', true)]);
  });
});
