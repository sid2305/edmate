// Task 8.2 Phase 2: no real model/storage/network calls (rule 4) — the embedder is the ingest
// package's deterministic `hashedEmbedder`, the transcriber and storage are in-memory fakes.
import type { DocumentRow } from '@edmate/db';
import { RepositoryError } from '@edmate/db';
import { hashedEmbedder } from '@edmate/ingest/testing';
import { describe, expect, it, vi } from 'vitest';
import { PermanentJobError } from '../commit/processors.js';
import type { LogLine } from '../log.js';
import type { StorageClient } from '../storage/client.js';
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

function job(data: unknown, name = 'ingest.process'): IngestJobLike {
  return { id: 'j1', name, data };
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
    expect(mem.calls).not.toContain('insertMany');
    expect(mem.getRow()?.status).toBe('uploading');
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
