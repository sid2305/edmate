// Task 5.3: writes for the retrieval index. Documents are filed under one of the scope's modules;
// chunks take their teacher, module, kind and source title from their document, so a chunk can
// never be filed under another teacher's module. Every write bumps the teacher's material
// revision in the same transaction (leakCheck's cache key, ADR-0007).
import { ChunkKindSchema } from '@edmate/contracts';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client.js';
import {
  chunks,
  documents,
  EMBEDDING_DIMENSIONS,
  modules,
  teacherMaterialRevisions,
} from '../schema/index.js';
import { vectorToDriver } from '../schema/_shared.js';
import { RepositoryError, translateWrite } from './errors.js';
import { insertSelect, written } from './insert.js';
import { type DocumentRow, type DocumentStatus, toDocumentRow } from './map.js';
import { IdSchema, parseArg, teacherScope, type TeacherScope } from './scope.js';

/** Most chunks or embeddings one call writes (ingest batches below this). */
export const CHUNK_WRITE_MAX = 500;
/** Longest chunk text accepted (the chunker splits at ~300 words). */
export const CHUNK_TEXT_MAX_LENGTH = 20_000;
/** Chunk ids are `<documentId>-c<0000>`, so a document id leaves room for the suffix. */
const DOCUMENT_ID_MAX_LENGTH = 122;

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const DocumentInputSchema = z.strictObject({
  id: IdSchema,
  moduleId: IdSchema,
  kind: ChunkKindSchema,
  sourceTitle: z.string().min(1).max(500),
  storageKey: z.string().min(1).max(1024).optional(),
});
export type DocumentInput = z.infer<typeof DocumentInputSchema>;

/** Most documents one `documents.listForTeacher` call returns. */
export const DOCUMENT_LIST_MAX = 500;

const ListOptionsSchema = z.strictObject({ moduleId: IdSchema.optional() });
export type DocumentListOptions = z.infer<typeof ListOptionsSchema>;

/** A fixed failure code such as an IngestErrorCode (`provider_error`), never raw error text. */
const FailureReasonSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);

/**
 * The states a document may move to `status` from. `uploading` is set only by `create` and
 * `startReplace`; `ready` is final until a replace; `failed` may be processed again (a retry).
 */
const STATUS_FROM = {
  processing: ['uploading', 'processing', 'failed'],
  ready: ['processing'],
  failed: ['uploading', 'processing'],
} as const satisfies Record<Exclude<DocumentStatus, 'uploading'>, readonly DocumentStatus[]>;

const StatusUpdateSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('failed'), failureReason: FailureReasonSchema }),
  z.strictObject({ status: z.enum(['processing', 'ready']), failureReason: z.undefined() }),
]);

const ReplaceInputSchema = z.strictObject({ storageKey: z.string().min(1).max(1024) });

const documentColumns = {
  id: documents.id,
  teacherId: documents.teacherId,
  moduleId: documents.moduleId,
  kind: documents.kind,
  sourceTitle: documents.sourceTitle,
  storageKey: documents.storageKey,
  status: documents.status,
  failureReason: documents.failureReason,
  createdAt: documents.createdAt,
  updatedAt: documents.updatedAt,
};

const ChunkDraftSchema = z.strictObject({
  ord: z.int().min(0).max(9999),
  text: z.string().min(1).max(CHUNK_TEXT_MAX_LENGTH),
  locator: z.string().max(500),
});
/** One chunk from the chunker: its text, exact locator and position in the document. */
export type ChunkDraft = z.infer<typeof ChunkDraftSchema>;

const DraftsSchema = z
  .array(ChunkDraftSchema)
  .min(1)
  .max(CHUNK_WRITE_MAX)
  .refine((ds) => new Set(ds.map((d) => d.ord)).size === ds.length);

const EmbeddingSchema = z.array(z.number().refine(Number.isFinite)).length(EMBEDDING_DIMENSIONS);
export { EmbeddingSchema };

const EmbeddingsSchema = z
  .array(z.strictObject({ id: IdSchema, embedding: EmbeddingSchema }))
  .min(1)
  .max(CHUNK_WRITE_MAX)
  .refine((xs) => new Set(xs.map((x) => x.id)).size === xs.length);

/** `<documentId>-c<0000>`: ids sort in document order, so no `ord` column is needed. */
export function chunkId(documentId: string, ord: number): string {
  return `${documentId}-c${String(ord).padStart(4, '0')}`;
}

/** +1 on the teacher's material revision (row created at 1). */
async function bumpRevision(tx: Tx, teacherId: string): Promise<void> {
  await tx
    .insert(teacherMaterialRevisions)
    .values({ teacherId, revision: 1 })
    .onConflictDoUpdate({
      target: teacherMaterialRevisions.teacherId,
      set: {
        revision: sql`${teacherMaterialRevisions.revision} + 1`,
        updatedAt: sql`now()`,
      },
    });
}

export function documentsRepo(db: Db) {
  return {
    /**
     * Files a document under one of the scope's modules. Another teacher's module, a missing one
     * and an id already taken (by anyone) are all `not_found`, so ids can't be probed.
     */
    async create(scope: TeacherScope, input: DocumentInput): Promise<{ id: string }> {
      const method = 'documents.create';
      const { teacherId } = teacherScope(scope, method);
      const d = parseArg(DocumentInputSchema, input, method);
      await translateWrite(
        method,
        () =>
          db.transaction(async (tx) => {
            const res = await tx.execute(
              insertSelect(
                documents,
                [
                  [documents.id, sql`${d.id}::text`],
                  [documents.teacherId, sql`${modules.teacherId}`],
                  [documents.moduleId, sql`${modules.id}`],
                  [documents.kind, sql`${d.kind}::chunk_kind`],
                  [documents.sourceTitle, sql`${d.sourceTitle}::text`],
                  [documents.storageKey, sql`${d.storageKey ?? null}::text`],
                ],
                sql`from ${modules} where ${modules.id} = ${d.moduleId} and ${modules.teacherId} = ${teacherId}`,
              ),
            );
            if (written(res) !== 1) throw new RepositoryError('not_found', method);
            await bumpRevision(tx, teacherId);
          }),
        'not_found',
      );
      return { id: d.id };
    },

    /** The scope's document `id`, or null (another teacher's and a missing one look the same). */
    async get(scope: TeacherScope, id: string): Promise<DocumentRow | null> {
      const method = 'documents.get';
      const { teacherId } = teacherScope(scope, method);
      const docId = parseArg(IdSchema, id, method);
      const [row] = await db
        .select(documentColumns)
        .from(documents)
        .where(and(eq(documents.id, docId), eq(documents.teacherId, teacherId)));
      return row ? toDocumentRow(row, method) : null;
    },

    /**
     * The scope's documents, newest first (at most `DOCUMENT_LIST_MAX`), optionally only those in
     * `moduleId`. Another teacher's module id simply matches nothing.
     */
    async listForTeacher(
      scope: TeacherScope,
      options: DocumentListOptions = {},
    ): Promise<DocumentRow[]> {
      const method = 'documents.listForTeacher';
      const { teacherId } = teacherScope(scope, method);
      const o = parseArg(ListOptionsSchema, options, method);
      const rows = await db
        .select(documentColumns)
        .from(documents)
        .where(
          and(
            eq(documents.teacherId, teacherId),
            o.moduleId === undefined ? undefined : eq(documents.moduleId, o.moduleId),
          ),
        )
        .orderBy(desc(documents.createdAt), desc(documents.id))
        .limit(DOCUMENT_LIST_MAX);
      return rows.map((r) => toDocumentRow(r, method));
    },

    /**
     * Moves the scope's document to `status` in one scoped UPDATE. Only lifecycle steps are
     * allowed (`STATUS_FROM`): a row in any other state, another teacher's and a missing one are
     * all `not_found`, so a stale worker can't mark a replaced document ready. `failed` needs a
     * fixed failure code (never raw error text); any other status clears it. Not a material
     * change: status is a display field, never a retrieval gate, so the revision is not bumped.
     */
    async updateStatus(
      scope: TeacherScope,
      id: string,
      status: Exclude<DocumentStatus, 'uploading'>,
      failureReason?: string,
    ): Promise<void> {
      const method = 'documents.updateStatus';
      const { teacherId } = teacherScope(scope, method);
      const docId = parseArg(IdSchema, id, method);
      const u = parseArg(StatusUpdateSchema, { status, failureReason }, method);
      const [row] = await db
        .update(documents)
        .set({ status: u.status, failureReason: u.failureReason ?? null, updatedAt: sql`now()` })
        .where(
          and(
            eq(documents.id, docId),
            eq(documents.teacherId, teacherId),
            inArray(documents.status, [...STATUS_FROM[u.status]]),
          ),
        )
        .returning({ id: documents.id });
      if (!row) throw new RepositoryError('not_found', method);
    },

    /**
     * Deletes the scope's document and its chunks and bumps the material revision, in one
     * transaction: the next retrieval search (and leakCheck) no longer sees it. The row is locked
     * first, so a concurrent chunk insert waits and then finds no document. Returns the storage
     * key for the caller to delete the stored file. Another teacher's or a missing one is
     * `not_found` and nothing is written.
     */
    async delete(scope: TeacherScope, id: string): Promise<{ storageKey: string | null }> {
      const method = 'documents.delete';
      const { teacherId } = teacherScope(scope, method);
      const docId = parseArg(IdSchema, id, method);
      return translateWrite(method, () =>
        db.transaction(async (tx) => {
          const storageKey = await lockDocument(tx, teacherId, docId, method);
          await removeChunks(tx, teacherId, docId);
          await tx
            .delete(documents)
            .where(and(eq(documents.id, docId), eq(documents.teacherId, teacherId)));
          await bumpRevision(tx, teacherId);
          return { storageKey };
        }),
      );
    },

    /**
     * Starts replacing the scope's document with a new file: in one transaction, deletes its
     * chunks, points it at `storageKey`, resets it to `uploading` (clearing any failure) and bumps
     * the revision. Returns the previous storage key for the caller to delete. Another teacher's
     * or a missing one is `not_found` and nothing is written.
     */
    async startReplace(
      scope: TeacherScope,
      id: string,
      input: { storageKey: string },
    ): Promise<{ previousStorageKey: string | null }> {
      const method = 'documents.startReplace';
      const { teacherId } = teacherScope(scope, method);
      const docId = parseArg(IdSchema, id, method);
      const r = parseArg(ReplaceInputSchema, input, method);
      return translateWrite(method, () =>
        db.transaction(async (tx) => {
          const previousStorageKey = await lockDocument(tx, teacherId, docId, method);
          await removeChunks(tx, teacherId, docId);
          await tx
            .update(documents)
            .set({
              storageKey: r.storageKey,
              status: 'uploading',
              failureReason: null,
              updatedAt: sql`now()`,
            })
            .where(and(eq(documents.id, docId), eq(documents.teacherId, teacherId)));
          await bumpRevision(tx, teacherId);
          return { previousStorageKey };
        }),
      );
    },
  };
}

/**
 * Locks the scope's document `FOR UPDATE` and returns its storage key, or throws `not_found`.
 * The lock makes a concurrent `chunks.insertMany` (whose foreign key needs a share lock on this
 * row) wait for the caller's transaction.
 */
async function lockDocument(
  tx: Tx,
  teacherId: string,
  docId: string,
  method: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ storageKey: documents.storageKey })
    .from(documents)
    .where(and(eq(documents.id, docId), eq(documents.teacherId, teacherId)))
    .for('update');
  if (!row) throw new RepositoryError('not_found', method);
  return row.storageKey;
}

/** Deletes every chunk of the scope's document `docId` (task 8.2, the only chunk delete). */
async function removeChunks(tx: Tx, teacherId: string, docId: string): Promise<void> {
  await tx
    .delete(chunks)
    .where(and(eq(chunks.documentId, docId), eq(chunks.teacherId, teacherId)));
}

export function chunksRepo(db: Db) {
  return {
    /**
     * Inserts a document's chunks in one statement that reads the document in the scope (and its
     * module, still the teacher's): another teacher's or a missing document is `not_found`. A
     * chunk id already written (the same `ord` twice) is `invalid`. Embeddings start NULL.
     */
    async insertMany(
      scope: TeacherScope,
      documentId: string,
      drafts: ChunkDraft[],
    ): Promise<{ ids: string[] }> {
      const method = 'chunks.insertMany';
      const { teacherId } = teacherScope(scope, method);
      const docId = parseArg(IdSchema.max(DOCUMENT_ID_MAX_LENGTH), documentId, method);
      const ds = parseArg(DraftsSchema, drafts, method);
      const rows = ds.map((x) => ({ id: chunkId(docId, x.ord), text: x.text, locator: x.locator }));
      await translateWrite(method, () =>
        db.transaction(async (tx) => {
          const res = await tx.execute(
            insertSelect(
              chunks,
              [
                [chunks.id, sql`v.id`],
                [chunks.teacherId, sql`d.teacher_id`],
                [chunks.documentId, sql`d.id`],
                [chunks.moduleId, sql`d.module_id`],
                [chunks.kind, sql`d.kind`],
                [chunks.text, sql`v.text`],
                [chunks.sourceTitle, sql`d.source_title`],
                [chunks.locator, sql`v.locator`],
              ],
              sql`from ${documents} d
                join ${modules} m on m.id = d.module_id and m.teacher_id = d.teacher_id
                cross join jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
                  as v(id text, text text, locator text)
                where d.id = ${docId} and d.teacher_id = ${teacherId}`,
            ),
          );
          if (written(res) !== rows.length) throw new RepositoryError('not_found', method);
          await bumpRevision(tx, teacherId);
        }),
      );
      return { ids: rows.map((r) => r.id) };
    },

    /**
     * Sets the embedding of the scope's chunks, all or nothing: any id that is not the scope's
     * (or does not exist) is `not_found` and nothing is written. Vectors are checked (dimension,
     * finite numbers) before any SQL.
     */
    async setEmbeddings(
      scope: TeacherScope,
      items: { id: string; embedding: number[] }[],
    ): Promise<{ updated: number }> {
      const method = 'chunks.setEmbeddings';
      const { teacherId } = teacherScope(scope, method);
      const xs = parseArg(EmbeddingsSchema, items, method);
      const rows = xs.map((x) => ({ id: x.id, embedding: vectorToDriver(x.embedding) }));
      await translateWrite(method, () =>
        db.transaction(async (tx) => {
          const res = await tx.execute(
            sql`update ${chunks} set embedding = v.embedding::vector, updated_at = now()
                from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as v(id text, embedding text)
                where ${chunks.id} = v.id and ${chunks.teacherId} = ${teacherId}`,
          );
          if (written(res) !== rows.length) throw new RepositoryError('not_found', method);
          await bumpRevision(tx, teacherId);
        }),
      );
      return { updated: rows.length };
    },
  };
}
