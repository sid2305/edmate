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
//
// Task 8.2c (Phase B, 8.2k) adds `vtt`/`srt`: a teacher-exported YouTube caption file. It is read
// from storage like any other document file (categorizeFileKind's 'document' branch), with no
// transcriber needed, so a caption job reaches `ready` even when EDMATE_INGEST_EMBEDDINGS=off
// leaves no `gateway.transcriber`.
//
// Task 8.2e adds two things:
// - `web` jobs (a teacher's web link, ADR-0014). The URL is in the job payload only; the row's
//   `storageKey` is a `.link` token with no stored object. The link is re-checked here
//   (`checkWebLinkUrl`) and fetched through the worker's pinned `WebFetcher`. The URL is never
//   logged or put in an error: only the document id and fixed codes are.
// - The last-attempt rule: a retryable failure on the job's final attempt marks the document
//   `failed` with its code (`provider_error` for an unexpected error) instead of leaving it
//   `processing` forever. This covers file jobs too.
import type { Repositories } from '@edmate/db';
import { RepositoryError } from '@edmate/db';
import {
  type ChunkWriter,
  type DocumentInput,
  type DocumentKind,
  IngestError,
  type IngestErrorCode,
  indexDocument,
  MAX_DOCUMENT_BYTES,
  type IndexDocumentDeps,
  type ParsedSource,
  type VideoSource,
  type WebFetcher,
  checkWebLinkUrl,
  parseWebLink,
} from '@edmate/ingest';
import { IngestJobSchema, type IngestFileKind } from '@edmate/queue';
import type { Log } from '../log.js';
import { PermanentJobError } from '../commit/processors.js';
import { ObjectTooLargeError, type StorageClient } from '../storage/client.js';
import type { IngestGateway } from './gateway.js';

/** A job as the processor sees it (BullMQ's Job has more). */
export interface IngestJobLike {
  readonly id?: string | undefined;
  readonly name: string;
  readonly data: unknown;
  /** Attempts already made before this one (BullMQ's `attemptsMade`). */
  readonly attemptsMade?: number;
  /** BullMQ's own default is a single attempt when `attempts` is unset. */
  readonly opts?: { readonly attempts?: number | undefined };
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
  /** The pinned web-link fetcher (task 8.2e); without one every web link fails as unsupported. */
  readonly webFetcher?: WebFetcher;
}

/** How long a video/audio signed GET URL stays valid: long enough for Whisper to fetch it. */
export const SIGNED_URL_TTL_SECONDS = 600;

/** Every `fileKind` `buildSource` can be asked to fetch (the job's own `web` kind is handled
 * before `buildSource` is ever called, so it is excluded here). */
type BuildableFileKind = Exclude<IngestFileKind, 'web'>;

/**
 * Categorizes a `BuildableFileKind` as a parsed document or a transcribed recording. Written as a
 * switch with every document and recording kind spelled out (not an untyped `Set<string>`), so
 * TypeScript narrows `kind` to `DocumentKind` inside the `document` branch and the `default` case's
 * `never` assignment fails to compile the day `IngestFileKind` gains a kind neither list covers
 * (8.2k review MEDIUM: the previous sets let an uncovered kind silently fall to `recording`).
 */
function categorizeFileKind(
  kind: BuildableFileKind,
):
  | { readonly category: 'document'; readonly documentKind: DocumentKind }
  | { readonly category: 'recording' } {
  switch (kind) {
    case 'pdf':
    case 'docx':
    case 'pptx':
    case 'markdown':
    case 'vtt':
    case 'srt':
      return { category: 'document', documentKind: kind };
    case 'video':
    case 'audio':
      return { category: 'recording' };
    default: {
      const _exhaustive: never = kind;
      throw new Error(`unreachable ingest file kind: ${String(_exhaustive)}`);
    }
  }
}

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
          if (error instanceof RepositoryError && error.kind === 'not_found')
            return dropped(drafts);
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

/** True when this attempt is the job's last: a retryable failure now is final. */
function isLastAttempt(job: IngestJobLike): boolean {
  const attempts = job.opts?.attempts ?? 1;
  return (job.attemptsMade ?? 0) + 1 >= attempts;
}

async function buildSource(
  storage: StorageClient,
  storageKey: string,
  sourceTitle: string,
  fileKind: BuildableFileKind,
  mimeType: string | undefined,
): Promise<DocumentInput | VideoSource> {
  const category = categorizeFileKind(fileKind);
  if (category.category === 'document') {
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
    return { kind: category.documentKind, bytes, sourceTitle };
  }
  // category.category === 'recording'; the schema requires mimeType to be set exactly then.
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
    const { teacherId, documentId, fileKind, mimeType, url } = parsed.data;
    const scope = { teacherId };

    const staleSkip = (): IngestOutcome => {
      log({ level: 'info', event: 'ingest.stale_skipped', documentId });
      return 'stale_skipped';
    };

    /**
     * Marks the document failed with `code` and ends the job for good, or reports a stale skip
     * when the row moved on (deleted or replaced) first. One atomic compare-and-set
     * (`failIfStorageKey`, task 8.2i) checks the row still holds the storageKey this job started
     * with and writes `failed` in the same statement, so there is no window left between a check
     * and a write for a replace to land in (task 8.2h's re-read-then-write had exactly that
     * window). A replace that reset the row to `uploading` or handed it to a newer job's
     * `processing` looks the same as a storageKey mismatch here: `{ updated: false }`. Only the
     * code is in the error.
     */
    const failWith = async (code: IngestErrorCode, startedWith: string): Promise<IngestOutcome> => {
      let result;
      try {
        result = await deps.repos.documents.failIfStorageKey(scope, documentId, startedWith, code);
      } catch (error) {
        return classifyRepoError(job.name, error);
      }
      if (!result.updated) return staleSkip();
      throw new PermanentJobError(`${job.name}: ${code}`);
    };

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
    if (
      fileKind !== 'web' &&
      categorizeFileKind(fileKind).category === 'recording' &&
      deps.gateway.transcriber === undefined
    ) {
      return failWith('unsupported', storageKey);
    }

    // A web link is re-checked before anything else (the route checked it too): a YouTube link is
    // unsupported, any other refusal forbidden. With no fetcher configured, links are unsupported.
    let plan:
      | { readonly kind: 'web'; readonly url: string; readonly fetcher: WebFetcher }
      | { readonly kind: Exclude<typeof fileKind, 'web'> };
    if (fileKind === 'web') {
      const check = checkWebLinkUrl(url ?? '');
      if (!check.ok) {
        return failWith(
          check.code === 'youtube_unsupported' ? 'unsupported' : 'forbidden',
          storageKey,
        );
      }
      if (deps.webFetcher === undefined) return failWith('unsupported', storageKey);
      plan = { kind: 'web', url: check.url, fetcher: deps.webFetcher };
    } else {
      plan = { kind: fileKind };
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
      const source: DocumentInput | ParsedSource | VideoSource =
        plan.kind === 'web'
          ? {
              kind: 'parsed',
              document: await parseWebLink(plan.url, plan.fetcher, row.sourceTitle),
              headings: true,
            }
          : await buildSource(deps.storage, storageKey, row.sourceTitle, plan.kind, mimeType);
      await indexDocument(indexDeps, { scope, documentId, source });
    } catch (error) {
      if (stale()) {
        // The writer saw a replace mid-flight and dropped the write; `indexDocument` only
        // surfaces that as a generic `IngestError` (see buildWriter), so the flag -- not the
        // error's identity -- is what tells us this was a stale-replace drop, not a real failure.
        return staleSkip();
      }
      const ingestError = error instanceof IngestError ? error : undefined;
      // A retryable failure (a transient provider, storage or network error) is rethrown as-is so
      // BullMQ retries it, and the document stays `processing`, unless this was the last attempt:
      // then it lands in `failed` like a permanent one, never stuck in `processing`. The raw
      // error is not kept: an unexpected one could quote a URL or a storage key.
      const retryable = ingestError === undefined || ingestError.retryable;
      if (retryable && !isLastAttempt(job)) throw error;
      return failWith(ingestError?.code ?? 'provider_error', storageKey);
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
