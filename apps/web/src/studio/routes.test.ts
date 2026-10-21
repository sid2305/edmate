// Task 8.2 Phase 3: the studio document API's handlers over a memory backend (no S3, no Redis, no
// database; rule 4). The teacher always comes from the session's principal: every route has a test
// where another teacher's document id is `not_found`, with nothing written, deleted or enqueued.
import { RepositoryError, type DocumentRow } from '@edmate/db';
import type { IngestJob } from '@edmate/queue';
import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createGuard, type CookieReader, type Principal, type RoleContext } from '../auth/guard';
import { MAX_DOCUMENT_UPLOAD_BYTES, MAX_MEDIA_UPLOAD_BYTES, uploadTypeOfKey } from './files';
import {
  MAX_BODY_BYTES,
  StudioUnavailableError,
  createStudioHandlers,
  type StudioBackend,
} from './routes';

const ORIGIN = 'http://localhost:8080';
const ASHA: Principal = { userId: 't_asha', role: 'teacher' };
const BEN: Principal = { userId: 't_ben', role: 'teacher' };
const PDF = 'application/pdf';

type Row = DocumentRow;
const STATUS_FROM: Record<string, readonly string[]> = {
  processing: ['uploading', 'processing', 'failed'],
  ready: ['processing'],
  failed: ['uploading', 'processing'],
};

/** A teacher-scoped memory documents repo with the real one's not_found and transition rules. */
function memoryBackend() {
  const rows = new Map<string, Row>();
  const modules = new Map([
    ['m_asha', 't_asha'],
    ['m_ben', 't_ben'],
  ]);
  const objects = new Map<string, { contentLength?: number; contentType?: string }>();
  const enqueued: { job: IngestJob; storageKey: string }[] = [];
  const deleted: string[] = [];
  const logs: { event: string; fields?: Record<string, string> }[] = [];
  let n = 0;
  const mine = (teacherId: string, id: string) => {
    const r = rows.get(id);
    return r && r.teacherId === teacherId ? r : null;
  };
  const notFound = (m: string) => new RepositoryError('not_found', m);
  const at = '2026-10-20T00:00:00.000Z';
  const backend: StudioBackend = {
    documents: {
      async get({ teacherId }, id) {
        return mine(teacherId, id);
      },
      async listForTeacher({ teacherId }, o = {}) {
        return [...rows.values()].filter(
          (r) =>
            r.teacherId === teacherId && (o.moduleId === undefined || r.moduleId === o.moduleId),
        );
      },
      async create({ teacherId }, d) {
        if (modules.get(d.moduleId) !== teacherId) throw notFound('documents.create');
        rows.set(d.id, {
          id: d.id,
          teacherId,
          moduleId: d.moduleId,
          kind: d.kind,
          sourceTitle: d.sourceTitle,
          ...(d.storageKey ? { storageKey: d.storageKey } : {}),
          status: 'uploading',
          createdAt: at,
          updatedAt: at,
        });
        return { id: d.id };
      },
      async updateStatus({ teacherId }, id, status, failureReason) {
        const r = mine(teacherId, id);
        if (!r || !STATUS_FROM[status]!.includes(r.status))
          throw notFound('documents.updateStatus');
        r.status = status;
        if (failureReason) r.failureReason = failureReason;
        else delete r.failureReason;
      },
      async delete({ teacherId }, id) {
        const r = mine(teacherId, id);
        if (!r) throw notFound('documents.delete');
        rows.delete(id);
        return { storageKey: r.storageKey ?? null };
      },
      async startReplace({ teacherId }, id, { storageKey }) {
        const r = mine(teacherId, id);
        if (!r) throw notFound('documents.startReplace');
        const previousStorageKey = r.storageKey ?? null;
        r.storageKey = storageKey;
        r.status = 'uploading';
        delete r.failureReason;
        return { previousStorageKey };
      },
    },
    storage: {
      createUploadUrl: vi.fn(
        async (o: { key: string; contentType: string; contentLength: number }) =>
          `https://bucket.test/${o.key}?len=${o.contentLength}`,
      ),
      head: vi.fn(async (key: string) => {
        const o = objects.get(key);
        return o ? { contentLength: o.contentLength, contentType: o.contentType } : null;
      }),
      deleteObject: vi.fn(async (key: string) => {
        deleted.push(key);
        objects.delete(key);
      }),
    },
    enqueue: vi.fn(async (job: IngestJob, storageKey: string) => {
      enqueued.push({ job, storageKey });
    }),
    newDocumentId: () => `doc_${++n}`,
    log: { error: (event, fields) => logs.push({ event, ...(fields ? { fields } : {}) }) },
  };
  return { backend, rows, objects, enqueued, deleted, logs };
}

function setup() {
  const mem = memoryBackend();
  const h = createStudioHandlers(async () => mem.backend, mem.backend.log);
  return { ...mem, h };
}

function ctx(principal: Principal, params: Record<string, string> = {}): RoleContext {
  return { principal, params: Promise.resolve(params) };
}

function req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  }) as unknown as Parameters<ReturnType<typeof createStudioHandlers>['list']>[0];
}

async function json(res: Response) {
  return (await res.json()) as Record<string, unknown> & {
    error?: { code: string; message: string; retryable: boolean };
  };
}

const NEW_PDF = {
  moduleId: 'm_asha',
  sourceTitle: 'Algebra notes',
  contentType: PDF,
  byteSize: 1000,
};

/** Asha creates a document and "uploads" its bytes to the memory bucket. */
async function uploaded(s: ReturnType<typeof setup>, over: Partial<typeof NEW_PDF> = {}) {
  const res = await s.h.create(
    req('POST', '/api/studio/documents', { ...NEW_PDF, ...over }),
    ctx(ASHA),
  );
  expect(res.status).toBe(201);
  const { documentId } = (await res.json()) as { documentId: string };
  const row = s.rows.get(documentId)!;
  const type = uploadTypeOfKey(row.storageKey!)!;
  s.objects.set(row.storageKey!, {
    contentLength: over.byteSize ?? 1000,
    contentType: type.contentType,
  });
  return { documentId, row };
}

describe('POST /api/studio/documents (create)', () => {
  it('creates an uploading row under a server-built key and returns a signed upload URL', async () => {
    const s = setup();
    const res = await s.h.create(req('POST', '/api/studio/documents', NEW_PDF), ctx(ASHA));
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await json(res);
    expect(body).toEqual({
      documentId: 'doc_1',
      uploadUrl: expect.stringMatching(
        /^https:\/\/bucket\.test\/teachers\/t_asha\/documents\/doc_1\//,
      ),
      uploadHeaders: { 'content-type': PDF },
    });
    const row = s.rows.get('doc_1')!;
    expect(row).toMatchObject({ teacherId: 't_asha', status: 'uploading', kind: 'material' });
    expect(row.storageKey).toMatch(/^teachers\/t_asha\/documents\/doc_1\/[0-9a-f-]{36}\.pdf$/);
    expect(s.backend.storage.createUploadUrl).toHaveBeenCalledWith({
      key: row.storageKey,
      contentType: PDF,
      contentLength: 1000,
    });
  });

  it('files audio and video as transcript material', async () => {
    const s = setup();
    await s.h.create(req('POST', '/x', { ...NEW_PDF, contentType: 'audio/mpeg' }), ctx(ASHA));
    expect(s.rows.get('doc_1')).toMatchObject({ kind: 'transcript' });
    expect(s.rows.get('doc_1')!.storageKey).toMatch(/\.mp3$/);
  });

  it('ignores any teacher id, key or kind the client sends', async () => {
    const s = setup();
    const res = await s.h.create(
      req('POST', '/x', {
        ...NEW_PDF,
        teacherId: 't_ben',
        storageKey: 'evil/key',
        kind: 'teacher_note',
      }),
      ctx(ASHA),
    );
    expect(res.status).toBe(400);
    expect(s.rows.size).toBe(0);
  });

  it("refuses another teacher's module as not_found and writes nothing", async () => {
    const s = setup();
    const res = await s.h.create(req('POST', '/x', { ...NEW_PDF, moduleId: 'm_ben' }), ctx(ASHA));
    expect(res.status).toBe(404);
    expect((await json(res)).error?.code).toBe('not_found');
    expect(s.backend.storage.createUploadUrl).not.toHaveBeenCalled();
  });

  it.each([
    ['a disallowed type', { contentType: 'text/html' }],
    ['an svg', { contentType: 'image/svg+xml' }],
    ['zero bytes', { byteSize: 0 }],
    ['a fractional size', { byteSize: 1.5 }],
    ['a missing title', { sourceTitle: '' }],
    ['a bad module id', { moduleId: '../m' }],
  ])('refuses %s (400)', async (_name, over) => {
    const s = setup();
    const res = await s.h.create(req('POST', '/x', { ...NEW_PDF, ...over }), ctx(ASHA));
    expect(res.status).toBe(400);
    expect((await json(res)).error?.code).toBe('validation');
    expect(s.rows.size).toBe(0);
  });

  it('refuses a file over its cap with 413, per type', async () => {
    const s = setup();
    const big = await s.h.create(
      req('POST', '/x', { ...NEW_PDF, byteSize: MAX_DOCUMENT_UPLOAD_BYTES + 1 }),
      ctx(ASHA),
    );
    expect(big.status).toBe(413);
    expect((await json(big)).error?.code).toBe('input_too_large');
    const media = await s.h.create(
      req('POST', '/x', {
        ...NEW_PDF,
        contentType: 'video/mp4',
        byteSize: MAX_DOCUMENT_UPLOAD_BYTES + 1,
      }),
      ctx(ASHA),
    );
    expect(media.status).toBe(201);
    const tooBigMedia = await s.h.create(
      req('POST', '/x', {
        ...NEW_PDF,
        contentType: 'video/mp4',
        byteSize: MAX_MEDIA_UPLOAD_BYTES + 1,
      }),
      ctx(ASHA),
    );
    expect(tooBigMedia.status).toBe(413);
  });

  it('refuses malformed JSON and a missing body (400)', async () => {
    const s = setup();
    expect((await s.h.create(req('POST', '/x', '{not json'), ctx(ASHA))).status).toBe(400);
    expect((await s.h.create(req('POST', '/x'), ctx(ASHA))).status).toBe(400);
  });

  it('refuses a body over the cap, declared or read (413)', async () => {
    const s = setup();
    const declared = await s.h.create(
      req('POST', '/x', NEW_PDF, { 'content-length': String(MAX_BODY_BYTES + 1) }),
      ctx(ASHA),
    );
    expect(declared.status).toBe(413);
    const padded = JSON.stringify({ ...NEW_PDF, sourceTitle: 'x'.repeat(MAX_BODY_BYTES) });
    const read = await s.h.create(req('POST', '/x', padded), ctx(ASHA));
    expect(read.status).toBe(413);
    expect((await json(read)).error?.code).toBe('input_too_large');
    expect(s.rows.size).toBe(0);
  });
});

describe('GET /api/studio/documents (list)', () => {
  it("lists only the session teacher's documents, without storage keys", async () => {
    const s = setup();
    await uploaded(s);
    await s.h.create(req('POST', '/x', { ...NEW_PDF, moduleId: 'm_ben' }), ctx(BEN));
    const res = await s.h.list(req('GET', '/api/studio/documents'), ctx(ASHA));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const { documents } = (await res.json()) as { documents: Record<string, unknown>[] };
    expect(documents).toHaveLength(1);
    expect(documents[0]).toEqual({
      id: 'doc_1',
      moduleId: 'm_asha',
      kind: 'material',
      sourceTitle: 'Algebra notes',
      status: 'uploading',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
  });

  it('filters by moduleId, and a teacherId in the query changes nothing', async () => {
    const s = setup();
    await uploaded(s);
    const other = await s.h.list(req('GET', '/x?moduleId=m_other'), ctx(ASHA));
    expect(((await other.json()) as { documents: unknown[] }).documents).toHaveLength(0);
    const spoof = await s.h.list(req('GET', '/x?teacherId=t_asha'), ctx(BEN));
    expect(((await spoof.json()) as { documents: unknown[] }).documents).toHaveLength(0);
  });

  it('shows the failure code of a failed document', async () => {
    const s = setup();
    const { row } = await uploaded(s);
    row.status = 'failed';
    row.failureReason = 'input_too_large';
    const { documents } = (await (await s.h.list(req('GET', '/x'), ctx(ASHA))).json()) as {
      documents: Record<string, unknown>[];
    };
    expect(documents[0]).toMatchObject({ status: 'failed', failureReason: 'input_too_large' });
  });

  it('refuses a malformed moduleId (400)', async () => {
    const s = setup();
    expect((await s.h.list(req('GET', '/x?moduleId=a%2Fb'), ctx(ASHA))).status).toBe(400);
  });
});

describe('POST /api/studio/documents/:id/complete', () => {
  it('confirms the upload, marks it processing, then enqueues it with its storage key', async () => {
    const s = setup();
    const { documentId, row } = await uploaded(s);
    const order: string[] = [];
    const update = s.backend.documents.updateStatus;
    s.backend.documents.updateStatus = async (...a) => {
      order.push(`status:${a[2]}`);
      return update(...a);
    };
    vi.mocked(s.backend.enqueue).mockImplementation(async (job, storageKey) => {
      order.push('enqueue');
      s.enqueued.push({ job, storageKey });
    });
    const res = await s.h.complete(req('POST', '/x'), ctx(ASHA, { id: documentId }));
    expect(res.status).toBe(202);
    expect(await json(res)).toEqual({ documentId, status: 'processing' });
    expect(order).toEqual(['status:processing', 'enqueue']);
    expect(row.status).toBe('processing');
    expect(s.enqueued).toEqual([
      { job: { teacherId: 't_asha', documentId, fileKind: 'pdf' }, storageKey: row.storageKey },
    ]);
  });

  it('passes the stored media type for audio and video', async () => {
    const s = setup();
    const { documentId } = await uploaded(s, { contentType: 'video/webm' });
    await s.h.complete(req('POST', '/x'), ctx(ASHA, { id: documentId }));
    expect(s.enqueued[0]!.job).toEqual({
      teacherId: 't_asha',
      documentId,
      fileKind: 'video',
      mimeType: 'video/webm',
    });
  });

  it("answers another teacher's document as not_found and touches nothing", async () => {
    const s = setup();
    const { documentId, row } = await uploaded(s);
    const res = await s.h.complete(req('POST', '/x'), ctx(BEN, { id: documentId }));
    expect(res.status).toBe(404);
    expect((await json(res)).error?.code).toBe('not_found');
    expect(row.status).toBe('uploading');
    expect(s.backend.storage.head).not.toHaveBeenCalled();
    expect(s.enqueued).toHaveLength(0);
  });

  it('a missing document is the same not_found', async () => {
    const s = setup();
    const res = await s.h.complete(req('POST', '/x'), ctx(ASHA, { id: 'doc_missing' }));
    expect(res.status).toBe(404);
  });

  it('refuses a malformed id (400)', async () => {
    const s = setup();
    expect((await s.h.complete(req('POST', '/x'), ctx(ASHA, { id: 'a/b' }))).status).toBe(400);
    expect((await s.h.complete(req('POST', '/x'), ctx(ASHA, {}))).status).toBe(400);
  });

  it('answers 409 while the file has not landed, and writes nothing', async () => {
    const s = setup();
    const { documentId, row } = await uploaded(s);
    s.objects.clear();
    const res = await s.h.complete(req('POST', '/x'), ctx(ASHA, { id: documentId }));
    expect(res.status).toBe(409);
    expect(row.status).toBe('uploading');
    expect(s.enqueued).toHaveLength(0);
  });

  it('fails an object over the cap (or with no length), deletes it, and does not enqueue', async () => {
    const s = setup();
    const { documentId, row } = await uploaded(s);
    s.objects.set(row.storageKey!, {
      contentLength: MAX_DOCUMENT_UPLOAD_BYTES + 1,
      contentType: PDF,
    });
    const res = await s.h.complete(req('POST', '/x'), ctx(ASHA, { id: documentId }));
    expect(res.status).toBe(413);
    expect(row).toMatchObject({ status: 'failed', failureReason: 'input_too_large' });
    expect(s.deleted).toEqual([row.storageKey]);
    expect(s.enqueued).toHaveLength(0);

    const two = await uploaded(s);
    s.objects.set(two.row.storageKey!, { contentType: PDF });
    expect((await s.h.complete(req('POST', '/x'), ctx(ASHA, { id: two.documentId }))).status).toBe(
      413,
    );
  });

  it('fails an object whose stored type differs from the one signed', async () => {
    const s = setup();
    const { documentId, row } = await uploaded(s);
    s.objects.set(row.storageKey!, { contentLength: 10, contentType: 'text/html' });
    const res = await s.h.complete(req('POST', '/x'), ctx(ASHA, { id: documentId }));
    expect(res.status).toBe(400);
    expect(row).toMatchObject({ status: 'failed', failureReason: 'unsupported_type' });
    expect(s.enqueued).toHaveLength(0);
  });

  it('is a no-op for a document already ready', async () => {
    const s = setup();
    const { documentId, row } = await uploaded(s);
    row.status = 'ready';
    const res = await s.h.complete(req('POST', '/x'), ctx(ASHA, { id: documentId }));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ documentId, status: 'ready' });
    expect(s.enqueued).toHaveLength(0);
  });

  it('refuses a row with no usable storage key (400)', async () => {
    const s = setup();
    const { documentId, row } = await uploaded(s);
    row.storageKey = 'legacy/key.bin';
    expect((await s.h.complete(req('POST', '/x'), ctx(ASHA, { id: documentId }))).status).toBe(400);
    delete row.storageKey;
    expect((await s.h.complete(req('POST', '/x'), ctx(ASHA, { id: documentId }))).status).toBe(400);
  });

  it('a delete racing the status write is not_found and nothing is enqueued', async () => {
    const s = setup();
    const { documentId } = await uploaded(s);
    s.backend.documents.updateStatus = async () => {
      throw new RepositoryError('not_found', 'documents.updateStatus');
    };
    expect((await s.h.complete(req('POST', '/x'), ctx(ASHA, { id: documentId }))).status).toBe(404);
    expect(s.enqueued).toHaveLength(0);
  });

  it('an enqueue failure marks the document failed (so complete can be retried) and is 503', async () => {
    const s = setup();
    const { documentId, row } = await uploaded(s);
    vi.mocked(s.backend.enqueue).mockRejectedValueOnce(new Error('redis down at host'));
    const res = await s.h.complete(req('POST', '/x'), ctx(ASHA, { id: documentId }));
    expect(res.status).toBe(503);
    expect((await json(res)).error).toMatchObject({ code: 'provider_error', retryable: true });
    expect(row).toMatchObject({ status: 'failed', failureReason: 'enqueue_failed' });
    expect(s.logs).toEqual([{ event: 'studio.enqueue_failed', fields: { error: 'Error' } }]);
    // A retry goes through: failed -> processing is allowed.
    expect((await s.h.complete(req('POST', '/x'), ctx(ASHA, { id: documentId }))).status).toBe(202);
  });
});

describe('complete: failure marking races', () => {
  it('a delete racing the failed write is fine (still 503); any other error is 500', async () => {
    const s = setup();
    const { documentId } = await uploaded(s);
    vi.mocked(s.backend.enqueue).mockRejectedValue(new Error('down'));
    const update = s.backend.documents.updateStatus;
    s.backend.documents.updateStatus = async (...a) => {
      if (a[2] === 'failed') throw new RepositoryError('not_found', 'documents.updateStatus');
      return update(...a);
    };
    expect((await s.h.complete(req('POST', '/x'), ctx(ASHA, { id: documentId }))).status).toBe(503);
    s.backend.documents.updateStatus = async (...a) => {
      if (a[2] === 'failed') throw new RepositoryError('failed', 'documents.updateStatus');
      return update(...a);
    };
    expect((await s.h.complete(req('POST', '/x'), ctx(ASHA, { id: documentId }))).status).toBe(500);
  });
});

describe('DELETE /api/studio/documents/:id', () => {
  it('deletes the row, then the stored file', async () => {
    const s = setup();
    const { documentId, row } = await uploaded(s);
    const res = await s.h.remove(req('DELETE', '/x'), ctx(ASHA, { id: documentId }));
    expect(res.status).toBe(204);
    expect(s.rows.has(documentId)).toBe(false);
    expect(s.deleted).toEqual([row.storageKey]);
  });

  it("answers another teacher's document as not_found and deletes nothing", async () => {
    const s = setup();
    const { documentId } = await uploaded(s);
    const res = await s.h.remove(req('DELETE', '/x'), ctx(BEN, { id: documentId }));
    expect(res.status).toBe(404);
    expect((await json(res)).error?.code).toBe('not_found');
    expect(s.rows.has(documentId)).toBe(true);
    expect(s.deleted).toEqual([]);
  });

  it('a failed file delete is logged by name and still 204 (the row is gone)', async () => {
    const s = setup();
    const { documentId } = await uploaded(s);
    vi.mocked(s.backend.storage.deleteObject).mockRejectedValueOnce(new TypeError('bucket x'));
    const res = await s.h.remove(req('DELETE', '/x'), ctx(ASHA, { id: documentId }));
    expect(res.status).toBe(204);
    expect(s.logs).toEqual([
      { event: 'studio.object_delete_failed', fields: { error: 'TypeError' } },
    ]);
  });

  it('a row with no stored file deletes no object', async () => {
    const s = setup();
    const { documentId, row } = await uploaded(s);
    delete row.storageKey;
    expect((await s.h.remove(req('DELETE', '/x'), ctx(ASHA, { id: documentId }))).status).toBe(204);
    expect(s.backend.storage.deleteObject).not.toHaveBeenCalled();
  });
});

describe('POST /api/studio/documents/:id/replace', () => {
  it('points the row at a fresh server key, signs it, and deletes the old file', async () => {
    const s = setup();
    const { documentId, row } = await uploaded(s);
    const oldKey = row.storageKey!;
    row.status = 'ready';
    const res = await s.h.replace(
      req('POST', '/x', { contentType: 'audio/wav', byteSize: 2000 }),
      ctx(ASHA, { id: documentId }),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toEqual({
      documentId,
      uploadUrl: expect.stringContaining(`/teachers/t_asha/documents/${documentId}/`),
      uploadHeaders: { 'content-type': 'audio/wav' },
    });
    expect(row.status).toBe('uploading');
    expect(row.storageKey).not.toBe(oldKey);
    expect(row.storageKey).toMatch(/\.wav$/);
    expect(s.deleted).toEqual([oldKey]);
  });

  it("answers another teacher's document as not_found, writes and signs nothing", async () => {
    const s = setup();
    const { documentId, row } = await uploaded(s);
    const before = row.storageKey;
    const res = await s.h.replace(
      req('POST', '/x', { contentType: PDF, byteSize: 10 }),
      ctx(BEN, { id: documentId }),
    );
    expect(res.status).toBe(404);
    expect(row.storageKey).toBe(before);
    expect(s.backend.storage.createUploadUrl).toHaveBeenCalledTimes(1); // the create only
    expect(s.deleted).toEqual([]);
  });

  it('validates the new file like create (400, 413) and caps the body', async () => {
    const s = setup();
    const { documentId } = await uploaded(s);
    const c = ctx(ASHA, { id: documentId });
    expect(
      (await s.h.replace(req('POST', '/x', { contentType: 'text/html', byteSize: 1 }), c)).status,
    ).toBe(400);
    expect(
      (
        await s.h.replace(
          req('POST', '/x', { contentType: PDF, byteSize: MAX_DOCUMENT_UPLOAD_BYTES + 1 }),
          c,
        )
      ).status,
    ).toBe(413);
    expect(
      (
        await s.h.replace(
          req(
            'POST',
            '/x',
            { contentType: PDF, byteSize: 1 },
            { 'content-length': String(MAX_BODY_BYTES + 1) },
          ),
          ctx(ASHA, { id: documentId }),
        )
      ).status,
    ).toBe(413);
    expect(
      (
        await s.h.replace(
          req('POST', '/x', { contentType: PDF, byteSize: 1 }),
          ctx(ASHA, { id: '' }),
        )
      ).status,
    ).toBe(400);
  });

  it('a signing failure commits nothing: the row and the old file stay as they were', async () => {
    const s = setup();
    const { documentId, row } = await uploaded(s);
    row.status = 'ready';
    const before = { ...row };
    vi.mocked(s.backend.storage.createUploadUrl).mockRejectedValueOnce(new TypeError('boom'));
    const res = await s.h.replace(
      req('POST', '/x', { contentType: PDF, byteSize: 10 }),
      ctx(ASHA, { id: documentId }),
    );
    expect(res.status).toBe(500);
    expect(row).toEqual(before);
    expect(s.deleted).toEqual([]);
  });

  it('a replace with no previous file deletes nothing', async () => {
    const s = setup();
    const { documentId, row } = await uploaded(s);
    delete row.storageKey;
    await s.h.replace(
      req('POST', '/x', { contentType: PDF, byteSize: 1 }),
      ctx(ASHA, { id: documentId }),
    );
    expect(s.backend.storage.deleteObject).not.toHaveBeenCalled();
  });
});

describe('failures', () => {
  it('an unavailable backend is 503 with the reason logged, never the message', async () => {
    const logs: string[] = [];
    const h = createStudioHandlers(
      async () => {
        throw new StudioUnavailableError('REDIS_URL');
      },
      { error: (event, f) => logs.push(`${event}:${f?.reason ?? ''}`) },
    );
    const res = await h.list(req('GET', '/x'), ctx(ASHA));
    expect(res.status).toBe(503);
    expect((await json(res)).error?.code).toBe('provider_error');
    expect(logs).toEqual(['studio.unavailable:REDIS_URL']);
  });

  it('any other backend build failure is 503 too, logged by error name', async () => {
    const logs: string[] = [];
    const h = createStudioHandlers(
      async () => {
        throw new SyntaxError('secret-ish detail');
      },
      { error: (event, f) => logs.push(`${event}:${f?.reason ?? ''}`) },
    );
    expect((await h.create(req('POST', '/x', NEW_PDF), ctx(ASHA))).status).toBe(503);
    expect(logs).toEqual(['studio.unavailable:SyntaxError']);
  });

  it('a database failure is 500 provider_error, logged by name', async () => {
    const s = setup();
    s.backend.documents.listForTeacher = async () => {
      throw new RepositoryError('failed', 'documents.listForTeacher');
    };
    const res = await s.h.list(req('GET', '/x'), ctx(ASHA));
    expect(res.status).toBe(500);
    expect((await json(res)).error?.code).toBe('provider_error');
    expect(s.logs).toEqual([{ event: 'studio.failed', fields: { error: 'RepositoryError' } }]);
  });

  it('an invalid-argument repository error is 400', async () => {
    const s = setup();
    s.backend.documents.get = async () => {
      throw new RepositoryError('invalid', 'documents.get');
    };
    expect((await s.h.complete(req('POST', '/x'), ctx(ASHA, { id: 'doc_1' }))).status).toBe(400);
  });

  it('a storage failure during complete is 500, logged by name', async () => {
    const s = setup();
    const { documentId } = await uploaded(s);
    vi.mocked(s.backend.storage.head).mockRejectedValueOnce(new RangeError('x'));
    expect((await s.h.complete(req('POST', '/x'), ctx(ASHA, { id: documentId }))).status).toBe(500);
    expect(s.logs.at(-1)).toEqual({ event: 'studio.failed', fields: { error: 'RangeError' } });
  });

  it('a non-Error throw is logged by its type', async () => {
    const s = setup();
    s.backend.documents.listForTeacher = async () => {
      throw 'nope';
    };
    expect((await s.h.list(req('GET', '/x'), ctx(ASHA))).status).toBe(500);
    expect(s.logs).toEqual([{ event: 'studio.failed', fields: { error: 'string' } }]);
  });
});

describe('through the real guard and ROUTE_POLICY', () => {
  const WHO: Record<string, Principal> = {
    asha: ASHA,
    ben: BEN,
    student: { userId: 's_1', role: 'student' },
    staff: { userId: 'st_1', role: 'staff' },
  };
  function guarded() {
    const s = setup();
    const guard = createGuard(
      () => ({
        getPrincipal: async (c: CookieReader) => WHO[c.get('who')?.value ?? ''] ?? null,
        learnerStatus: async () => 'clear',
        allowedOrigin: ORIGIN,
      }),
      () => {
        throw new Error('not a page');
      },
    );
    return {
      ...s,
      list: guard.withRole(['teacher'], s.h.list),
      create: guard.withRole(['teacher'], s.h.create),
      remove: guard.withRole(['teacher'], s.h.remove),
    };
  }
  const call = (
    method: string,
    path: string,
    who: string | null,
    body?: unknown,
    origin = ORIGIN,
  ) =>
    new NextRequest(`${ORIGIN}${path}`, {
      method,
      headers: {
        ...(who ? { cookie: `who=${who}` } : {}),
        ...(method === 'GET' ? {} : { origin }),
        'content-type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  it('lets teachers in; anonymous is 401, students and staff 403', async () => {
    const g = guarded();
    expect((await g.list(call('GET', '/api/studio/documents', 'asha'))).status).toBe(200);
    expect((await g.list(call('GET', '/api/studio/documents', null))).status).toBe(401);
    expect((await g.list(call('GET', '/api/studio/documents', 'student'))).status).toBe(403);
    expect((await g.list(call('GET', '/api/studio/documents', 'staff'))).status).toBe(403);
    expect((await g.create(call('POST', '/api/studio/documents', 'student', NEW_PDF))).status).toBe(
      403,
    );
    expect(g.rows.size).toBe(0);
  });

  it("DELETE is open to teachers, scoped to the session: Ben can't delete Asha's document", async () => {
    const g = guarded();
    const made = await g.create(call('POST', '/api/studio/documents', 'asha', NEW_PDF));
    const { documentId } = (await made.json()) as { documentId: string };
    const path = `/api/studio/documents/${documentId}`;
    const ctxFor = { params: Promise.resolve({ id: documentId }) };
    expect((await g.remove(call('DELETE', path, 'ben'), ctxFor)).status).toBe(404);
    expect(
      (await g.remove(call('DELETE', path, 'asha', undefined, 'https://evil.test'), ctxFor)).status,
    ).toBe(403);
    expect(g.rows.has(documentId)).toBe(true);
    expect((await g.remove(call('DELETE', path, 'asha'), ctxFor)).status).toBe(204);
    expect(g.rows.has(documentId)).toBe(false);
  });
});
