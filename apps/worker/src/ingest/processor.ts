// Task 8.2 Phase 2: the ingest processor. Loads the document row, parses/transcribes and chunks
// it through `@edmate/ingest`'s `indexDocument`, then moves the row to `ready` or `failed`.
//
// The race Phase 1 flagged: a replace can reset the document's `storageKey` and `status` while a
// still-running job for the old file is mid-flight. `updateStatus('ready')` alone already guards
// the final write (its lifecycle check refuses `uploading -> ready`), but a worker that reaches
// `indexDocument` before that check could still write the *old* file's chunks under the document's
// id. So the `ChunkWriter` this processor builds re-checks the row's current `storageKey` against
// the one read at the start of the job in the same statement as the chunk write (8.2 fix round)
// and drops the write when a replace has already moved it on. It signals this to the processor through a flag it closes
// over, not a thrown error: `indexDocument`'s own `store()` helper catches every error its
// `ChunkWriter` throws and rethrows a single fixed `IngestError` (so teacher material in a cause
// never reaches a log line), which would erase a dedicated "stale" error's identity. Reporting
// "nothing written" as a normal (empty) result and checking the flag afterwards survives that.
// No status write follows a stale drop: the job that owns the new `storageKey` gets to set it.
import type { Repositories } from '@edmate/db';
import { RepositoryError } from '@edmate/db';
import {
  type ChunkWriter,
  type DocumentInput,
  IngestError,
  indexDocument,
  MAX_DOCUMENT_BYTES,
  type IndexDocumentDeps,
  type VideoSource,
} from '@edmate/ingest';
import { IngestJobSchema } from '@edmate/queue';
import type { Log } from '../log.js';
import { PermanentJobError } from '../commit/processors.js';
import { ObjectTooLargeError, type StorageClient } from '../storage/client.js';
import type { IngestGateway } from './gateway.js';

/** A job as the processor sees it (BullMQ's Job has more). */
export interface IngestJobLike {
  readonly id?: string | undefined;
  readonly name: string;
  readonly data: unknown;
}

/**
 * `ready`: the document was indexed and marked ready. `stale_skipped`: a replace moved the
 * document on mid-flight; nothing was written and the newer job owns its status. A document
 * moved to `failed` (a non-retryable `IngestError`) is signalled by a thrown `PermanentJobError`,
 * same as every other permanent failure in this worker — never a return value.
 */
export type IngestOutcome = 'ready' | 'stale_skipped';

export interface IngestProcessorDeps {
  readonly repos: Pick<Repositories, 'documents' | 'chunks'>;
  readonly storage: StorageClient;
  readonly gateway: IngestGateway;
}

/** How long a video/audio signed GET URL stays valid: long enough for Whisper to fetch it. */
export const SIGNED_URL_TTL_SECONDS = 600;

const DOCUMENT_KINDS = new Set(['pdf', 'docx', 'pptx', 'markdown']);
const RECORDING_KINDS = new Set(['video', 'audio']);

/** A RepositoryError a retry can't fix becomes a PermanentJobError; `failed` (db down) retries. */
function classifyRepoError(job: string, error: unknown): never {
  if (error instanceof RepositoryError && error.kind !== 'failed') {
    throw new PermanentJobError(`${job}: ${error.message}`, { cause: error });
  }
  throw error;
}

/**
 * Wraps `repos.chunks` so `insertMany` only ever writes under the `storageKey` the job started
 * with. The check and the write are one statement (`chunks.insertManyIfStorageKey`, which also
 * waits on a replace's row lock), so a replace committing between a read and the write can no
 * longer slip the old file's chunks in. A deleted document (`not_found`) is stale too.
 *
 * Staleness is reported through the returned `stale()` getter, not a thrown error: a dedicated
 * error type thrown from here would not survive the round trip through `@edmate/ingest`'s
 * `indexDocument` — its internal `store()` helper catches every error the `ChunkWriter` throws
 * and rethrows one fixed, non-retryable `IngestError` so a cause (which could carry teacher
 * material) never reaches a log line. So once a replace is detected, `insertMany` returns empty
 * placeholder ids instead of throwing (and writes nothing), `setEmbeddings` becomes a no-op, and
 * the processor checks `stale()` itself once `indexDocument` returns or throws.
 */
function buildWriter(
  repos: Pick<Repositories, 'chunks'>,
  expectedStorageKey: string,
): { writer: ChunkWriter; stale: () => boolean } {
  let stale = false;
  const dropped = (drafts: readonly unknown[]) => {
    stale = true;
    return { ids: drafts.map(() => '') };
  };
  return {
    stale: () => stale,
    writer: {
      async insertMany(writerScope, documentId, drafts) {
        let res;
        try {
          res = await repos.chunks.insertManyIfStorageKey(
            writerScope,
            documentId,
            expectedStorageKey,
            drafts,
          );
        } catch (error) {
          if (error instanceof RepositoryError && error.kind === 'not_found') return dropped(drafts);
          throw error;
        }
        return res.stale ? dropped(drafts) : { ids: res.ids };
      },
      async setEmbeddings(writerScope, items) {
        if (stale) return { updated: 0 };
        return repos.chunks.setEmbeddings(writerScope, items);
      },
    },
  };
}

async function buildSource(
  storage: StorageClient,
  storageKey: string,
  sourceTitle: string,
  fileKind: 'pdf' | 'docx' | 'pptx' | 'markdown' | 'video' | 'audio',
  mimeType: string | undefined,
): Promise<DocumentInput | VideoSource> {
  if (DOCUMENT_KINDS.has(fileKind)) {
    let bytes: Uint8Array;
    try {
      bytes = await storage.getObjectBytes(storageKey, MAX_DOCUMENT_BYTES);
    } catch (error) {
      // Same failure code parseDocument uses for an oversized document, so the teacher sees one.
      if (error instanceof ObjectTooLargeError) {
        throw new IngestError('input_too_large', false, error.message);
      }
      throw error;
    }
    return { kind: fileKind as 'pdf' | 'docx' | 'pptx' | 'markdown', bytes, sourceTitle };
  }
  // fileKind is 'video' | 'audio'; the schema requires mimeType to be set exactly then.
  const url = await storage.getSignedDownloadUrl(storageKey, SIGNED_URL_TTL_SECONDS);
  return { kind: 'video', sourceTitle, recording: { url, mimeType: mimeType as string } };
}

/** Processes `edmate-ingest` jobs: parse, chunk, store and mark the document ready or failed. */
export function ingestProcessor(
  deps: IngestProcessorDeps,
  log: Log,
): (job: IngestJobLike) => Promise<IngestOutcome> {
  return async (job) => {
    const parsed = IngestJobSchema.safeParse(job.data);
    if (!parsed.success) throw new PermanentJobError(`${job.name}: invalid job payload`);
    const { teacherId, documentId, fileKind, mimeType } = parsed.data;
    const scope = { teacherId };

    let row;
    try {
      row = await deps.repos.documents.get(scope, documentId);
    } catch (error) {
      return classifyRepoError(job.name, error);
    }
    if (row === null) throw new PermanentJobError(`${job.name}: document not found`);
    const storageKey = row.storageKey;
    if (storageKey === undefined) {
      throw new PermanentJobError(`${job.name}: document has no stored file`);
    }

    // Task 9.0 D3: EDMATE_INGEST_EMBEDDINGS=off ships no transcriber, so a recording job is
    // refused here, before any storage read or write -- a config fact, not a provider failure,
    // and distinct from `packages/ingest`'s own 'validation' code for a job that *should* have a
    // transcriber but doesn't get one.
    if (RECORDING_KINDS.has(fileKind) && deps.gateway.transcriber === undefined) {
      try {
        await deps.repos.documents.updateStatus(scope, documentId, 'failed', 'unsupported');
      } catch (error) {
        if (error instanceof RepositoryError && error.kind === 'not_found') {
          log({ level: 'info', event: 'ingest.stale_skipped', documentId });
          return 'stale_skipped';
        }
        return classifyRepoError(job.name, error);
      }
      throw new PermanentJobError(`${job.name}: unsupported`);
    }

    const { writer, stale } = buildWriter(deps.repos, storageKey);
    const indexDeps: IndexDocumentDeps = {
      writer,
      ...(deps.gateway.embedder ? { embedder: deps.gateway.embedder } : {}),
      ...(deps.gateway.transcriber ? { transcriber: deps.gateway.transcriber } : {}),
      onEmbedFailed: (code) => {
        log({ level: 'warn', event: 'ingest.embed_failed', documentId, code });
      },
    };

    try {
      const source = await buildSource(
        deps.storage,
        storageKey,
        row.sourceTitle,
        fileKind,
        mimeType,
      );
      await indexDocument(indexDeps, { scope, documentId, source });
    } catch (error) {
      if (stale()) {
        // The writer saw a replace mid-flight and dropped the write; `indexDocument` only
        // surfaces that as a generic `IngestError` (see buildWriter), so the flag -- not the
        // error's identity -- is what tells us this was a stale-replace drop, not a real failure.
        log({ level: 'info', event: 'ingest.stale_skipped', documentId });
        return 'stale_skipped';
      }
      if (error instanceof IngestError) {
        // A retryable IngestError (a transient provider failure) is rethrown as-is so BullMQ
        // retries it; the document stays `processing` (its current state) until it either
        // succeeds or exhausts its attempts and lands in `failed` below.
        if (error.retryable) throw error;
        try {
          await deps.repos.documents.updateStatus(scope, documentId, 'failed', error.code);
        } catch (updateError) {
          if (updateError instanceof RepositoryError && updateError.kind === 'not_found') {
            log({ level: 'info', event: 'ingest.stale_skipped', documentId });
            return 'stale_skipped';
          }
          return classifyRepoError(job.name, updateError);
        }
        throw new PermanentJobError(`${job.name}: ${error.code}`, { cause: error });
      }
      // An unexpected failure (storage/network): retryable by default.
      throw error;
    }

    if (stale()) {
      // `indexDocument` "succeeded" with nothing written (fake ids, no embeddings): a replace
      // landed mid-flight. The newer job owns this document's status from here.
      log({ level: 'info', event: 'ingest.stale_skipped', documentId });
      return 'stale_skipped';
    }

    try {
      await deps.repos.documents.updateStatus(scope, documentId, 'ready');
    } catch (error) {
      if (error instanceof RepositoryError && error.kind === 'not_found') {
        // A replace reset the row to `uploading` after indexing finished: the chunks we just
        // wrote passed the storageKey check, but the final status write lost the race. The new
        // job (for the replacement file) owns the row's status from here.
        log({ level: 'info', event: 'ingest.stale_skipped', documentId });
        return 'stale_skipped';
      }
      return classifyRepoError(job.name, error);
    }
    return 'ready';
  };
}
