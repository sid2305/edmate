// @vitest-environment jsdom
// Task 8.2 Phase 4: the browser side of the studio document API. Fetch is stubbed (rule 4); the
// PUT runs over a fake XMLHttpRequest. Written red before uploadClient.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UPLOAD_TYPES } from './files';
import {
  ACCEPT,
  CLIENT_UPLOAD_TYPES,
  completeDocument,
  contentTypeFor,
  createDocument,
  deleteDocument,
  listDocuments,
  putFile,
  replaceDocument,
} from './uploadClient';

const reply = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function stubFetch(...responses: Response[]) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error('no stubbed response');
    return next;
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the upload type table', () => {
  it('matches the server table exactly', () => {
    expect(CLIENT_UPLOAD_TYPES).toEqual(
      UPLOAD_TYPES.map((t) => ({ contentType: t.contentType, ext: t.ext })),
    );
    expect(ACCEPT.split(',')).toEqual(
      UPLOAD_TYPES.map((t) => `.${t.ext}`).concat(UPLOAD_TYPES.map((t) => t.contentType)),
    );
  });

  it('takes the browser type when allowed, else the extension, else null', () => {
    expect(contentTypeFor(new File(['x'], 'a.pdf', { type: 'application/pdf' }))).toBe(
      'application/pdf',
    );
    expect(contentTypeFor(new File(['x'], 'Notes.MD', { type: '' }))).toBe('text/markdown');
    expect(contentTypeFor(new File(['x'], 'clip.m4a', { type: 'audio/x-m4a' }))).toBe('audio/mp4');
    expect(contentTypeFor(new File(['x'], 'page.html', { type: 'text/html' }))).toBeNull();
    expect(contentTypeFor(new File(['x'], 'noext', { type: '' }))).toBeNull();
  });
});

describe('the JSON calls', () => {
  it('lists documents', async () => {
    const calls = stubFetch(reply(200, { documents: [{ id: 'doc_1' }] }));
    await expect(listDocuments()).resolves.toEqual({ ok: true, value: [{ id: 'doc_1' }] });
    expect(calls[0]!.url).toBe('/api/studio/documents');
    expect(calls[0]!.init).toMatchObject({ cache: 'no-store' });
  });

  it('creates and replaces with exactly the fields the API takes', async () => {
    const made = { documentId: 'doc_1', uploadUrl: 'https://b.test/k', uploadHeaders: {} };
    const calls = stubFetch(reply(201, made), reply(200, made));
    await expect(
      createDocument({
        moduleId: 'm1',
        sourceTitle: 'A',
        contentType: 'text/markdown',
        byteSize: 3,
      }),
    ).resolves.toEqual({ ok: true, value: made });
    await replaceDocument('doc_1', { contentType: 'application/pdf', byteSize: 9 });
    expect(calls.map((c) => [c.url, c.init?.method, c.init?.body])).toEqual([
      [
        '/api/studio/documents',
        'POST',
        JSON.stringify({
          moduleId: 'm1',
          sourceTitle: 'A',
          contentType: 'text/markdown',
          byteSize: 3,
        }),
      ],
      [
        '/api/studio/documents/doc_1/replace',
        'POST',
        JSON.stringify({ contentType: 'application/pdf', byteSize: 9 }),
      ],
    ]);
  });

  it('completes and deletes, escaping the id', async () => {
    const calls = stubFetch(reply(202, { documentId: 'a/b', status: 'processing' }), reply(204));
    await expect(completeDocument('a/b')).resolves.toMatchObject({ ok: true });
    await expect(deleteDocument('a/b')).resolves.toEqual({ ok: true, value: undefined });
    expect(calls.map((c) => [c.url, c.init?.method])).toEqual([
      ['/api/studio/documents/a%2Fb/complete', 'POST'],
      ['/api/studio/documents/a%2Fb', 'DELETE'],
    ]);
  });

  it('reads an error body as its code, and anything else as provider_error', async () => {
    stubFetch(
      reply(409, { error: { code: 'validation', message: 'x', retryable: true } }),
      reply(413, { error: { code: 'input_too_large', message: 'x', retryable: false } }),
      new Response('<html>', { status: 502 }),
    );
    await expect(completeDocument('d')).resolves.toEqual({
      ok: false,
      status: 409,
      code: 'validation',
    });
    await expect(listDocuments()).resolves.toEqual({
      ok: false,
      status: 413,
      code: 'input_too_large',
    });
    await expect(deleteDocument('d')).resolves.toEqual({
      ok: false,
      status: 502,
      code: 'provider_error',
    });
  });

  it('a network failure is provider_error with status 0', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('offline'))),
    );
    await expect(listDocuments()).resolves.toEqual({
      ok: false,
      status: 0,
      code: 'provider_error',
    });
  });
});

class FakeXhr {
  static last: FakeXhr | undefined;
  method = '';
  url = '';
  headers: Record<string, string> = {};
  body: unknown;
  status = 0;
  upload: {
    onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null;
  } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: unknown) {
    this.body = body;
  }
}

describe('putFile', () => {
  it('PUTs the file with exactly the upload headers and reports progress', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const file = new File(['abc'], 'a.md', { type: 'text/markdown' });
    const seen: number[] = [];
    const done = putFile('https://b.test/k', { 'content-type': 'text/markdown' }, file, (p) =>
      seen.push(p),
    );
    const xhr = FakeXhr.last!;
    expect([xhr.method, xhr.url, xhr.headers, xhr.body]).toEqual([
      'PUT',
      'https://b.test/k',
      { 'content-type': 'text/markdown' },
      file,
    ]);
    xhr.upload.onprogress!({ lengthComputable: true, loaded: 1, total: 3 });
    xhr.upload.onprogress!({ lengthComputable: false, loaded: 0, total: 0 });
    xhr.status = 200;
    xhr.onload!();
    await expect(done).resolves.toBeUndefined();
    expect(seen).toEqual([33]);
  });

  it('rejects on a bucket refusal, a network error or an abort', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const file = new File(['abc'], 'a.md');
    const refused = putFile('u', {}, file, () => undefined);
    FakeXhr.last!.status = 403;
    FakeXhr.last!.onload!();
    await expect(refused).rejects.toThrow('upload refused (403)');
    const broken = putFile('u', {}, file, () => undefined);
    FakeXhr.last!.onerror!();
    await expect(broken).rejects.toThrow('upload failed');
    const aborted = putFile('u', {}, file, () => undefined);
    FakeXhr.last!.onabort!();
    await expect(aborted).rejects.toThrow('upload failed');
  });
});
