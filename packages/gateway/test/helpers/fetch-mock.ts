// The only transport adapters get in tests: queued fake responses, every request recorded.
// No socket is ever opened (build plan rule 4).

export interface FakeResponse {
  readonly status?: number;
  readonly body: string;
  /** Defaults to text/event-stream when the body starts with `event:` or `data:`, else JSON. */
  readonly contentType?: string;
}

export interface CapturedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface FetchMock {
  readonly fetch: typeof globalThis.fetch;
  readonly requests: CapturedRequest[];
  /** Everything sent: urls, headers and bodies, for leak checks. */
  corpus(): string;
}

function contentTypeOf(r: FakeResponse): string {
  if (r.contentType !== undefined) return r.contentType;
  return /^(?:event|data):/.test(r.body) ? 'text/event-stream' : 'application/json';
}

export function fetchMock(responses: readonly FakeResponse[]): FetchMock {
  const queue = [...responses];
  const requests: CapturedRequest[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const req = new Request(input, init);
    requests.push({
      url: req.url,
      method: req.method,
      headers: Object.fromEntries(req.headers),
      body: await req.text(),
    });
    const next = queue.shift();
    if (next === undefined) throw new Error('fetch-mock: no response queued');
    return new Response(next.body, {
      status: next.status ?? 200,
      headers: { 'content-type': contentTypeOf(next) },
    });
  };
  return {
    fetch,
    requests,
    corpus: () =>
      requests.map((r) => [r.url, JSON.stringify(r.headers), r.body].join('\n')).join('\n'),
  };
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
