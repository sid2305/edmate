// The only transport adapters get in tests: queued fake responses, every request recorded.
// No socket is ever opened (build plan rule 4).

export interface FakeResponse {
  readonly status?: number;
  /** Text, or raw bytes (a recording); bytes default to application/octet-stream. */
  readonly body: string | Uint8Array;
  /** Extra response headers, for example a redirect's location. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Defaults to text/event-stream when the body starts with `event:` or `data:`, else JSON. */
  readonly contentType?: string;
  /** Keep the body open after `body` (a provider still generating), until the request is aborted. */
  readonly hold?: boolean;
}

export interface CapturedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  /** The abort signal the caller passed, if any. */
  readonly signal: AbortSignal | undefined;
}

export interface FetchMock {
  readonly fetch: typeof globalThis.fetch;
  readonly requests: CapturedRequest[];
  /** Everything sent: urls, headers and bodies, for leak checks. */
  corpus(): string;
}

function contentTypeOf(r: FakeResponse): string {
  if (r.contentType !== undefined) return r.contentType;
  if (typeof r.body !== 'string') return 'application/octet-stream';
  return /^(?:event|data):/.test(r.body) ? 'text/event-stream' : 'application/json';
}

export function fetchMock(responses: readonly FakeResponse[]): FetchMock {
  const queue = [...responses];
  const requests: CapturedRequest[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const req = new Request(input, init);
    const captured: CapturedRequest = {
      url: req.url,
      method: req.method,
      headers: Object.fromEntries(req.headers),
      body: await req.text(),
      signal: init?.signal ?? undefined,
    };
    requests.push(captured);
    const next = queue.shift();
    if (next === undefined) throw new Error('fetch-mock: no response queued');
    const body =
      next.hold === true && typeof next.body === 'string' ? held(next.body, captured) : next.body;
    return new Response(body as ConstructorParameters<typeof Response>[0], {
      status: next.status ?? 200,
      headers: { 'content-type': contentTypeOf(next), ...next.headers },
    });
  };
  return {
    fetch,
    requests,
    corpus: () =>
      requests.map((r) => [r.url, JSON.stringify(r.headers), r.body].join('\n')).join('\n'),
  };
}

/** A body that sends `text` and then stays open, like a provider mid-generation. */
function held(text: string, captured: CapturedRequest): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      // A real fetch errors its body when the request is aborted.
      captured.signal?.addEventListener('abort', () => {
        controller.error(new DOMException('aborted', 'AbortError'));
      });
    },
  });
}

/** Server-sent events from data objects, one `event:` line each when a name is given. */
export function sse(events: readonly (readonly [string | undefined, unknown])[]): string {
  return events
    .map(([event, data]) => {
      const payload = typeof data === 'string' ? data : JSON.stringify(data);
      return `${event === undefined ? '' : `event: ${event}\n`}data: ${payload}\n\n`;
    })
    .join('');
}
