// Task 8.2 Phase 2: no real model/storage/network calls (rule 4) — the embedder is the ingest
// package's deterministic `hashedEmbedder`, the transcriber and storage are in-memory fakes.
import type { DocumentRow } from '@edmate/db';
import { RepositoryError } from '@edmate/db';
import { IngestError, MAX_DOCUMENT_BYTES } from '@edmate/ingest';
import { hashedEmbedder } from '@edmate/ingest/testing';
import { describe, expect, it, vi } from 'vitest';
import { PermanentJobError } from '../commit/processors.js';
import type { LogLine } from '../log.js';
import { ObjectTooLargeError, type StorageClient } from '../storage/client.js';
import type { IngestGateway } from './gateway.js';
import { ingestProcessor, type IngestJobLike, type IngestProcessorDeps } from './processor.js';

const now = '2026-10-20T00:00:00.000Z';

function row(over: Partial<DocumentRow> = {}): DocumentRow {
  return {
    id: 'doc_1',
    teacherId: 'tch_1',
    moduleId: 'mod_1',
    kind: 'material',
    sourceTitle: 'Lesson one',
    storageKey: 'docs/doc_1/v1',
    status: 'processing',
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

/** In-memory documents/chunks repos: just enough of the real shape for the processor. */
function memoryRepos(initial: DocumentRow) {
  let current: DocumentRow | null = initial;
  const inserted: { documentId: string; ord: number }[] = [];
  const calls: string[] = [];
  return {
    calls,
    setRow(r: DocumentRow | null) {
      current = r;
    },
    getRow() {
      return current;
    },
    repos: {
      documents: {
        get: (_scope: unknown, id: string) => {
          calls.push('get');
          return Promise.resolve(current && current.id === id ? current : null);
        },
        updateStatus: (
          _scope: unknown,
          id: string,
          status: 'processing' | 'ready' | 'failed',
          failureReason?: string,
        ) => {
          calls.push(`updateStatus:${status}`);
          if (current === null || current.id !== id) {
            return Promise.reject(new RepositoryError('not_found', 'documents.updateStatus'));
          }
          const allowed: Record<string, readonly string[]> = {
            processing: ['uploading', 'processing', 'failed'],
            ready: ['processing'],
            failed: ['uploading', 'processing'],
          };
          if (!allowed[status]?.includes(current.status)) {
            return Promise.reject(new RepositoryError('not_found', 'documents.updateStatus'));
          }
          current = { ...current, status, ...(failureReason ? { failureReason } : {}) };
          return Promise.resolve();
        },
      },
      chunks: {
        insertMany: (_scope: unknown, documentId: string, drafts: { ord: number }[]) => {
          calls.push('insertMany');
          drafts.forEach((d) => inserted.push({ documentId, ord: d.ord }));
          return Promise.resolve({ ids: drafts.map((d) => `${documentId}-c${d.ord}`) });
        },
        // Mirrors the db repo: the key check and the write are one call (8.2 fix round).
        insertManyIfStorageKey: (
          _scope: unknown,
          documentId: string,
          storageKey: string,
          drafts: { ord: number }[],
        ) => {
          calls.push('insertManyIfStorageKey');
          if (current === null || current.id !== documentId) {
            return Promise.reject(
              new RepositoryError('not_found', 'chunks.insertManyIfStorageKey'),
            );
          }
          if (current.storageKey !== storageKey) return Promise.resolve({ stale: true });
          calls.push('insertMany');
          drafts.forEach((d) => inserted.push({ documentId, ord: d.ord }));
          return Promise.resolve({
            stale: false,
            ids: drafts.map((d) => `${documentId}-c${d.ord}`),
          });
        },
        setEmbeddings: (_scope: unknown, items: { id: string }[]) => {
          calls.push('setEmbeddings');
          return Promise.resolve({ updated: items.length });
        },
      },
    } as unknown as IngestProcessorDeps['repos'],
  };
}

function fakeStorage(objects: Record<string, Uint8Array> = {}): StorageClient {
  return {
    getObjectBytes: (key) => {
      const bytes = objects[key];
      if (bytes === undefined) throw new Error(`no object at ${key}`);
      return Promise.resolve(bytes);
    },
    getSignedDownloadUrl: (key, ttl) =>
      Promise.resolve(`https://signed.example/${key}?ttl=${String(ttl)}`),
    deleteObject: () => Promise.resolve(),
  };
}

function markdownBytes(text = '# Intro\n\nLesson text about photosynthesis.'): Uint8Array {
  return new TextEncoder().encode(text);
}

function gateway(transcriber?: IngestGateway['transcriber']): IngestGateway {
  return {
    embedder: hashedEmbedder(),
    transcriber: transcriber ?? { transcribe: () => Promise.reject(new Error('not configured')) },
  };
}

/** Task 9.0 D3: EDMATE_INGEST_EMBEDDINGS=off -- no embedder, no transcriber. */
function offGateway(): IngestGateway {
  return {};
}

/** A first attempt of five, like the real queue's RETRY: a retryable failure is not final. */
function job(data: unknown, name = 'ingest.process'): IngestJobLike {
  return { id: 'j1', name, data, attemptsMade: 0, opts: { attempts: 5 } };
}

const lines: LogLine[] = [];
const log = (l: LogLine) => {
  lines.push(l);
};

describe('ingestProcessor', () => {
  it('indexes a markdown document and marks it ready', async () => {
    const mem = memoryRepos(row());
    const deps: IngestProcessorDeps = {
      repos: mem.repos,
      storage: fakeStorage({ 'docs/doc_1/v1': markdownBytes() }),
      gateway: gateway(),
    };
    const outcome = await ingestProcessor(deps, log)(
      job({ teacherId: 'tch_1', documentId: 'doc_1', fileKind: 'markdown' }),
    );
    expect(outcome).toBe('ready');
    expect(mem.getRow()?.status).toBe('ready');
    expect(mem.calls).toContain('insertMany');
  });

  it('EDMATE_INGEST_EMBEDDINGS=off: a markdown document reaches ready with chunks and no embed call', async () => {
    const mem = memoryRepos(row());
    const deps: IngestProcessorDeps = {
      repos: mem.repos,
      storage: fakeStorage({ 'docs/doc_1/v1': markdownBytes() }),
      gateway: offGateway(),
    };
    const outcome = await ingestProcessor(deps, log)(
      job({ teacherId: 'tch_1', documentId: 'doc_1', fileKind: 'markdown' }),
    );
    expect(outcome).toBe('ready');
    expect(mem.getRow()?.status).toBe('ready');
    expect(mem.calls).toContain('insertMany');
    expect(mem.calls).not.toContain('setEmbeddings');
  });

  it('EDMATE_INGEST_EMBEDDINGS=off: a video job fails as unsupported with nothing written', async () => {
    const mem = memoryRepos(row({ storageKey: 'docs/doc_1/v1.mp4' }));
    const deps: IngestProcessorDeps = {
      repos: mem.repos,
      storage: fakeStorage(),
      gateway: offGateway(),
    };
    await expect(
      ingestProcessor(deps, log)(
        job({ teacherId: 'tch_1', documentId: 'doc_1', fileKind: 'video', mimeType: 'video/mp4' }),
      ),
    ).rejects.toBeInstanceOf(PermanentJobError);
    expect(mem.getRow()?.status).toBe('failed');
    expect(mem.getRow()?.failureReason).toBe('unsupported');
    expect(mem.calls).not.toContain('insertMany');
    expect(mem.calls).not.toContain('insertManyIfStorageKey');
  });

  it('EDMATE_INGEST_EMBEDDINGS=off: an audio job fails as unsupported with nothing written', async () => {
    const mem = memoryRepos(row({ storageKey: 'docs/doc_1/v1.mp3' }));
    const deps: IngestProcessorDeps = {
      repos: mem.repos,
      storage: fakeStorage(),
      gateway: offGateway(),
    };
    await expect(
      ingestProcessor(deps, log)(
        job({ teacherId: 'tch_1', documentId: 'doc_1', fileKind: 'audio', mimeType: 'audio/mpeg' }),
      ),
    ).rejects.toBeInstanceOf(PermanentJobError);
    expect(mem.getRow()?.status).toBe('failed');
    expect(mem.getRow()?.failureReason).toBe('unsupported');
    expect(mem.calls).not.toContain('insertMany');
  });

  it('transcribes a video document through a signed URL', async () => {
    const mem = memoryRepos(row({ storageKey: 'docs/doc_1/v1.mp4' }));
    const transcribe = vi.fn(() =>
      Promise.resolve({
        text: 'Hello class',
        durationMs: 1000,
        segments: [{ startMs: 0, endMs: 1000, text: 'Hello class' }],
      }),
    );
    const deps: IngestProcessorDeps = {
      repos: mem.repos,
      storage: fakeStorage(),
      gateway: gateway({ transcribe }),
    };
    const outcome = await ingestProcessor(deps, log)(
      job({
        teacherId: 'tch_1',
        documentId: 'doc_1',
        fileKind: 'video',
        mimeType: 'video/mp4',
      }),
    );
    expect(outcome).toBe('ready');
    expect(transcribe).toHaveBeenCalledWith({
      url: 'https://signed.example/docs/doc_1/v1.mp4?ttl=600',
      mimeType: 'video/mp4',
    });
  });

  it('refuses a malformed job payload without touching the repos', async () => {
    const mem = memoryRepos(row());
    const deps: IngestProcessorDeps = {
      repos: mem.repos,
      storage: fakeStorage(),
      gateway: gateway(),
    };
    await expect(
      ingestProcessor(deps, log)(job({ teacherId: 'tch_1', documentId: 'doc_1' })),
    ).rejects.toBeInstanceOf(PermanentJobError);
    expect(mem.calls).toEqual([]);
  });

  it('is permanent when the document does not exist', async () => {
    const mem = memoryRepos(row());
    mem.setRow(null);
    const deps: IngestProcessorDeps = {
      repos: mem.repos,
      storage: fakeStorage(),
      gateway: gateway(),
    };
    await expect(
      ingestProcessor(deps, log)(job({ teacherId: 'tch_1', documentId: 'doc_1', fileKind: 'markdown' })),
    ).rejects.toBeInstanceOf(PermanentJobError);
  });

  it('is permanent when the document has no stored file', async () => {
    const mem = memoryRepos(row({ storageKey: undefined }));
    const deps: IngestProcessorDeps = {
      repos: mem.repos,
      storage: fakeStorage(),
      gateway: gateway(),
    };
    await expect(
      ingestProcessor(deps, log)(job({ teacherId: 'tch_1', documentId: 'doc_1', fileKind: 'markdown' })),
    ).rejects.toBeInstanceOf(PermanentJobError);
  });

  it('marks a document failed on a non-retryable IngestError and is permanent', async () => {
    const mem = memoryRepos(row());
    const deps: IngestProcessorDeps = {
      // An empty document has no text to learn from: a non-retryable `validation` IngestError.
      repos: mem.repos,
      storage: fakeStorage({ 'docs/doc_1/v1': markdownBytes('') }),
      gateway: gateway(),
    };
    await expect(
      ingestProcessor(deps, log)(job({ teacherId: 'tch_1', documentId: 'doc_1', fileKind: 'markdown' })),
    ).rejects.toBeInstanceOf(PermanentJobError);
    expect(mem.getRow()?.status).toBe('failed');
    expect(mem.getRow()?.failureReason).toBe('validation');
  });

  it('caps the download at MAX_DOCUMENT_BYTES and maps an oversized object to input_too_large', async () => {
    const mem = memoryRepos(row());
    const seen: number[] = [];
    const deps: IngestProcessorDeps = {
      repos: mem.repos,
      storage: {
        ...fakeStorage(),
        getObjectBytes: (_key, maxBytes) => {
          seen.push(maxBytes);
          return Promise.reject(new ObjectTooLargeError(maxBytes));
        },
      },
      gateway: gateway(),
    };
    await expect(
      ingestProcessor(deps, log)(job({ teacherId: 'tch_1', documentId: 'doc_1', fileKind: 'markdown' })),
    ).rejects.toBeInstanceOf(PermanentJobError);
    expect(seen).toEqual([MAX_DOCUMENT_BYTES]);
    expect(mem.getRow()?.status).toBe('failed');
    expect(mem.getRow()?.failureReason).toBe('input_too_large');
    expect(mem.calls).not.toContain('insertMany');
  });

  it('rethrows a retryable IngestError for BullMQ to retry, leaving the document processing', async () => {
    const mem = memoryRepos(row({ storageKey: 'docs/doc_1/v1.mp4' }));
    const transcribe = vi.fn(() => Promise.reject(new Error('whisper is down')));
    const deps: IngestProcessorDeps = {
      repos: mem.repos,
      storage: fakeStorage(),
      gateway: gateway({ transcribe }),
    };
    await expect(
      ingestProcessor(deps, log)(
        job({ teacherId: 'tch_1', documentId: 'doc_1', fileKind: 'video', mimeType: 'video/mp4' }),
      ),
    ).rejects.toThrow('transcribed');
    expect(mem.getRow()?.status).toBe('processing');
  });

  it('drops stale work when a replace lands before the chunk write', async () => {
    const mem = memoryRepos(row());
    const deps: IngestProcessorDeps = {
      repos: mem.repos,
      storage: {
        ...fakeStorage({ 'docs/doc_1/v1': markdownBytes() }),
        getObjectBytes: async (key) => {
          // Simulate a replace landing while this job is mid-download.
          mem.setRow(row({ storageKey: 'docs/doc_1/v2', status: 'uploading' }));
          return markdownBytes();
          void key;
        },
      },
      gateway: gateway(),
    };
    const outcome = await ingestProcessor(deps, log)(
      job({ teacherId: 'tch_1', documentId: 'doc_1', fileKind: 'markdown' }),
    );
    expect(outcome).toBe('stale_skipped');
    expect(mem.calls).toContain('insertManyIfStorageKey');
    expect(mem.calls).not.toContain('insertMany');
    expect(mem.calls).not.toContain('setEmbeddings');
    expect(mem.getRow()?.status).toBe('uploading');
  });

  it('reads the document once: the chunk write carries the key check itself', async () => {
    const mem = memoryRepos(row());
    const deps: IngestProcessorDeps = {
      repos: mem.repos,
      storage: fakeStorage({ 'docs/doc_1/v1': markdownBytes() }),
      gateway: gateway(),
    };
    await ingestProcessor(deps, log)(
      job({ teacherId: 'tch_1', documentId: 'doc_1', fileKind: 'markdown' }),
    );
    expect(mem.calls.filter((c) => c === 'get')).toHaveLength(1);
    expect(mem.calls).toContain('insertMany');
  });

  it('drops stale work when the document is deleted before the chunk write', async () => {
    const mem = memoryRepos(row());
    const deps: IngestProcessorDeps = {
      repos: mem.repos,
      storage: {
        ...fakeStorage(),
        getObjectBytes: () => {
          mem.setRow(null);
          return Promise.resolve(markdownBytes());
        },
      },
      gateway: gateway(),
    };
    const outcome = await ingestProcessor(deps, log)(
      job({ teacherId: 'tch_1', documentId: 'doc_1', fileKind: 'markdown' }),
    );
    expect(outcome).toBe('stale_skipped');
    expect(mem.calls).not.toContain('insertMany');
    expect(mem.calls.some((c) => c.startsWith('updateStatus'))).toBe(false);
  });

  it('a chunk write failing for another reason is not mistaken for a stale drop', async () => {
    const mem = memoryRepos(row());
    (mem.repos.chunks as { insertManyIfStorageKey: unknown }).insertManyIfStorageKey = () =>
      Promise.reject(new RepositoryError('failed', 'chunks.insertManyIfStorageKey'));
    const deps: IngestProcessorDeps = {
      repos: mem.repos,
      storage: fakeStorage({ 'docs/doc_1/v1': markdownBytes() }),
      gateway: gateway(),
    };
    await expect(
      ingestProcessor(deps, log)(
        job({ teacherId: 'tch_1', documentId: 'doc_1', fileKind: 'markdown' }),
      ),
    ).rejects.toThrow();
    expect(mem.getRow()?.status).not.toBe('ready');
  });

  it('drops stale work when a replace lands after indexing but before the ready write', async () => {
    const mem = memoryRepos(row());
    const deps: IngestProcessorDeps = {
      repos: mem.repos,
      storage: fakeStorage({ 'docs/doc_1/v1': markdownBytes() }),
      gateway: gateway(),
    };
    const realUpdateStatus = mem.repos.documents.updateStatus;
    (mem.repos.documents as { updateStatus: typeof realUpdateStatus }).updateStatus = (
      scope: { teacherId: string },
      id: string,
      status: 'processing' | 'ready' | 'failed',
      failureReason?: string,
    ) => {
      if (status === 'ready') mem.setRow(row({ storageKey: 'docs/doc_1/v2', status: 'uploading' }));
      return realUpdateStatus(scope, id, status, failureReason);
    };
    const outcome = await ingestProcessor(deps, log)(
      job({ teacherId: 'tch_1', documentId: 'doc_1', fileKind: 'markdown' }),
    );
    expect(outcome).toBe('stale_skipped');
  });

  it('rethrows an unexpected storage failure for BullMQ to retry', async () => {
    const mem = memoryRepos(row());
    const deps: IngestProcessorDeps = {
      repos: mem.repos,
      storage: fakeStorage(),
      gateway: gateway(),
    };
    await expect(
      ingestProcessor(deps, log)(job({ teacherId: 'tch_1', documentId: 'doc_1', fileKind: 'markdown' })),
    ).rejects.toThrow('no object at');
  });

  it('classifies a repository failure on the initial get as retryable (db down)', async () => {
    const mem = memoryRepos(row());
    const deps: IngestProcessorDeps = {
      repos: {
        ...mem.repos,
        documents: {
          ...mem.repos.documents,
          get: () => Promise.reject(new RepositoryError('failed', 'documents.get')),
        },
      } as never,
      storage: fakeStorage(),
      gateway: gateway(),
    };
    await expect(
      ingestProcessor(deps, log)(job({ teacherId: 'tch_1', documentId: 'doc_1', fileKind: 'markdown' })),
    ).rejects.toBeInstanceOf(RepositoryError);
  });

  it('turns a scope error on the initial get into a permanent failure', async () => {
    const mem = memoryRepos(row());
    const deps: IngestProcessorDeps = {
      repos: {
        ...mem.repos,
        documents: {
          ...mem.repos.documents,
          get: () => Promise.reject(new RepositoryError('scope', 'documents.get')),
        },
      } as never,
      storage: fakeStorage(),
      gateway: gateway(),
    };
    await expect(
      ingestProcessor(deps, log)(job({ teacherId: 'tch_1', documentId: 'doc_1', fileKind: 'markdown' })),
    ).rejects.toBeInstanceOf(PermanentJobError);
  });
});

// ---- web links and the last attempt (task 8.2e, ADR-0014) --------------------------------------

const LINK_KEY = 'teachers/tch_1/documents/doc_1/u1.link';
const LEAK = 'leak-marker-qz';
const URL_OK = `https://lessons.example.org/unit/1?key=${LEAK}`;

function webJob(url: string, attempt?: { made: number; of: number }): IngestJobLike {
  return {
    id: 'j1',
    name: 'ingest.process',
    data: { teacherId: 'tch_1', documentId: 'doc_1', fileKind: 'web', url },
    attemptsMade: attempt?.made ?? 0,
    opts: { attempts: attempt?.of ?? 5 },
  };
}

/** Storage a web job must never read: a link has no stored object. */
function noStorage(): StorageClient {
  return {
    getObjectBytes: () => Promise.reject(new Error('a web job read storage')),
    getSignedDownloadUrl: () => Promise.reject(new Error('a web job signed a URL')),
    deleteObject: () => Promise.resolve(),
  };
}

function fetcherOf(fetchPage: (url: string) => Promise<{ html: string }>) {
  const spy = vi.fn(fetchPage);
  return { webFetcher: { fetchPage: spy }, fetchPage: spy };
}

const PAGE_HTML =
  '<html><head><title>T</title></head><body><h1>Fractions</h1><p>Halves and quarters.</p></body></html>';

async function permanent(p: Promise<unknown>): Promise<PermanentJobError> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(PermanentJobError);
  const e = err as PermanentJobError;
  expect(e.message).not.toContain(LEAK);
  expect(e.message).not.toContain('lessons.example.org');
  return e;
}

function webDeps(
  mem: ReturnType<typeof memoryRepos>,
  webFetcher?: IngestProcessorDeps['webFetcher'],
): IngestProcessorDeps {
  return {
    repos: mem.repos,
    storage: noStorage(),
    gateway: gateway(),
    ...(webFetcher === undefined ? {} : { webFetcher }),
  };
}

describe('ingestProcessor: web links', () => {
  it('fetches the page, indexes it and marks it ready, without the URL in any log line', async () => {
    lines.length = 0;
    const mem = memoryRepos(row({ storageKey: LINK_KEY, sourceTitle: 'lessons.example.org' }));
    const f = fetcherOf(() => Promise.resolve({ html: PAGE_HTML }));
    await expect(ingestProcessor(webDeps(mem, f.webFetcher), log)(webJob(URL_OK))).resolves.toBe(
      'ready',
    );
    expect(f.fetchPage).toHaveBeenCalledWith(URL_OK);
    expect(mem.getRow()?.status).toBe('ready');
    expect(mem.calls).toContain('insertMany');
    expect(JSON.stringify(lines)).not.toContain(LEAK);
    expect(JSON.stringify(lines)).not.toContain('/unit/');
  });

  it.each([
    ['a private address', 'https://127.0.0.1/a', 'forbidden'],
    ['an internal name', 'https://intranet.local/a', 'forbidden'],
    ['a YouTube link', 'https://www.youtube.com/watch?v=abc', 'unsupported'],
  ])('%s fails as %s with nothing fetched', async (_label, url, code) => {
    const mem = memoryRepos(row({ storageKey: LINK_KEY }));
    const f = fetcherOf(() => Promise.resolve({ html: PAGE_HTML }));
    const e = await permanent(ingestProcessor(webDeps(mem, f.webFetcher), log)(webJob(url)));
    expect(e.message).toBe(`ingest.process: ${code}`);
    expect(mem.getRow()?.status).toBe('failed');
    expect(mem.getRow()?.failureReason).toBe(code);
    expect(f.fetchPage).not.toHaveBeenCalled();
    expect(mem.calls).not.toContain('insertMany');
  });

  it('a payload the queue schema refuses (plain http) is permanent, with nothing fetched', async () => {
    const mem = memoryRepos(row({ storageKey: LINK_KEY }));
    const f = fetcherOf(() => Promise.resolve({ html: PAGE_HTML }));
    await permanent(
      ingestProcessor(webDeps(mem, f.webFetcher), log)(webJob('http://lessons.example.org/a')),
    );
    expect(f.fetchPage).not.toHaveBeenCalled();
  });

  it('no web fetcher configured: the link fails as unsupported', async () => {
    const mem = memoryRepos(row({ storageKey: LINK_KEY }));
    await permanent(ingestProcessor(webDeps(mem), log)(webJob(URL_OK)));
    expect(mem.getRow()?.status).toBe('failed');
    expect(mem.getRow()?.failureReason).toBe('unsupported');
  });

  it('a refused link whose row was deleted meanwhile is a stale skip', async () => {
    const mem = memoryRepos(row({ storageKey: LINK_KEY }));
    mem.setRow(null);
    mem.setRow(row({ storageKey: LINK_KEY, status: 'ready' }));
    // ready -> failed is refused by the fake lifecycle (as by the repo): not_found.
    await expect(
      ingestProcessor(webDeps(mem), log)(webJob('https://127.0.0.1/a')),
    ).resolves.toBe('stale_skipped');
  });

  it('a non-retryable fetch failure marks the link failed with its code', async () => {
    const mem = memoryRepos(row({ storageKey: LINK_KEY }));
    const f = fetcherOf(() =>
      Promise.reject(new IngestError('unsupported', false, 'the web link is not an HTML page')),
    );
    await permanent(ingestProcessor(webDeps(mem, f.webFetcher), log)(webJob(URL_OK)));
    expect(mem.getRow()?.failureReason).toBe('unsupported');
  });

  it('a retryable failure before the last attempt is rethrown and the link stays processing', async () => {
    const mem = memoryRepos(row({ storageKey: LINK_KEY }));
    const f = fetcherOf(() =>
      Promise.reject(new IngestError('provider_error', true, 'the site failed (HTTP 503)')),
    );
    await expect(
      ingestProcessor(webDeps(mem, f.webFetcher), log)(webJob(URL_OK, { made: 3, of: 5 })),
    ).rejects.toBeInstanceOf(IngestError);
    expect(mem.getRow()?.status).toBe('processing');
  });

  it.each([
    ['provider_error', new IngestError('provider_error', true, 'the site failed (HTTP 503)')],
    ['rate_limited', new IngestError('rate_limited', true, 'the site rate limited (HTTP 429)')],
    ['provider_error', new Error(`socket hang up ${URL_OK}`)],
  ])('on the last attempt a retryable failure marks the link failed/%s', async (code, error) => {
    lines.length = 0;
    const mem = memoryRepos(row({ storageKey: LINK_KEY }));
    const f = fetcherOf(() => Promise.reject(error));
    const e = await permanent(
      ingestProcessor(webDeps(mem, f.webFetcher), log)(webJob(URL_OK, { made: 4, of: 5 })),
    );
    expect(e.message).toBe(`ingest.process: ${code}`);
    expect(e.cause).toBeUndefined();
    expect(mem.getRow()?.status).toBe('failed');
    expect(mem.getRow()?.failureReason).toBe(code);
    expect(JSON.stringify(lines)).not.toContain(LEAK);
  });

  it('a replace during the fetch is a stale skip', async () => {
    const mem = memoryRepos(row({ storageKey: LINK_KEY }));
    const f = fetcherOf(() => {
      mem.setRow(row({ storageKey: 'teachers/tch_1/documents/doc_1/u2.link' }));
      return Promise.resolve({ html: PAGE_HTML });
    });
    await expect(ingestProcessor(webDeps(mem, f.webFetcher), log)(webJob(URL_OK))).resolves.toBe(
      'stale_skipped',
    );
    expect(mem.calls).not.toContain('insertMany');
  });
});

describe('ingestProcessor: the last attempt for file jobs', () => {
  function fileJob(attempt?: { made: number; of: number }): IngestJobLike {
    return {
      id: 'j1',
      name: 'ingest.process',
      data: { teacherId: 'tch_1', documentId: 'doc_1', fileKind: 'markdown' },
      ...(attempt === undefined
        ? {}
        : { attemptsMade: attempt.made, opts: { attempts: attempt.of } }),
    };
  }

  it('an unexpected failure on the last attempt marks the document failed/provider_error', async () => {
    const mem = memoryRepos(row());
    const deps: IngestProcessorDeps = {
      repos: mem.repos,
      storage: fakeStorage(),
      gateway: gateway(),
    };
    const e = await permanent(ingestProcessor(deps, log)(fileJob({ made: 4, of: 5 })));
    expect(e.message).toBe('ingest.process: provider_error');
    expect(mem.getRow()?.failureReason).toBe('provider_error');
  });

  it('a job with no attempt count is a single attempt, so its failure is final', async () => {
    const mem = memoryRepos(row());
    const deps: IngestProcessorDeps = {
      repos: mem.repos,
      storage: fakeStorage(),
      gateway: gateway(),
    };
    await permanent(ingestProcessor(deps, log)(fileJob()));
    expect(mem.getRow()?.status).toBe('failed');
  });

  it('a db outage on the last attempt is rethrown as-is (the row cannot be written)', async () => {
    const mem = memoryRepos(row());
    const deps: IngestProcessorDeps = {
      repos: {
        ...mem.repos,
        documents: {
          ...mem.repos.documents,
          updateStatus: () =>
            Promise.reject(new RepositoryError('failed', 'documents.updateStatus')),
        },
      } as never,
      storage: fakeStorage(),
      gateway: gateway(),
    };
    await expect(ingestProcessor(deps, log)(fileJob({ made: 4, of: 5 }))).rejects.toBeInstanceOf(
      RepositoryError,
    );
  });
});
