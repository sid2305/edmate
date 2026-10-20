// Task 5.3: parse → chunk → store → embed. Chunks are stored first with NULL embeddings, so full
// text finds them even when embedding fails; embedding failure is reported to an optional callback
// (a fixed code, never text) and the call still resolves. A storage failure rejects with a fixed
// IngestError that keeps nothing of the cause (it may quote teacher material).
import type { ModelGateway } from '@edmate/contracts';
import { chunkDocument } from '../chunk/chunker.js';
import { parseDocument, type DocumentInput } from '../document.js';
import { IngestError } from '../errors.js';
import type { ParsedDocument } from '../types.js';
import type { ChunkDraft, ChunkWriter, ChunkWriterScope } from './types.js';

/** Must equal the gateway's EMBEDDING_CONFIG.dimension and the db's vector(1536) column. */
export const EMBEDDING_DIMENSIONS = 1536;
/** Texts per embed call. */
export const EMBED_BATCH_SIZE = 96;
/** Drafts per insert call (the db repository accepts at most 500). */
export const WRITE_BATCH_SIZE = 500;
/** Chunk ids carry a 4-digit ord, so a document has at most 10,000 chunks. */
export const MAX_CHUNKS_PER_DOCUMENT = 10_000;

export type EmbedFailure = 'embed_failed' | 'embed_malformed';

export interface IndexDocumentDeps {
  readonly writer: ChunkWriter;
  /** No embedder: chunks are stored for full text only. */
  readonly embedder?: Pick<ModelGateway, 'embed'>;
  readonly onEmbedFailed?: (code: EmbedFailure) => void;
}

/** A document already parsed (e.g. a web link), and whether it is located by heading path. */
export interface ParsedSource {
  readonly kind: 'parsed';
  readonly document: ParsedDocument;
  readonly headings: boolean;
}

export interface IndexDocumentInput {
  readonly scope: ChunkWriterScope;
  /** A document the scope's teacher already filed under one of their modules. */
  readonly documentId: string;
  readonly source: DocumentInput | ParsedSource;
}

export interface IndexDocumentResult {
  readonly chunks: number;
  /** Every chunk has an embedding. */
  readonly embedded: boolean;
  readonly embeddedChunks: number;
}

function storeFailed(): IngestError {
  return new IngestError('provider_error', false, 'the chunks could not be stored');
}

async function store<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch {
    throw storeFailed();
  }
}

function batches<T>(xs: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

function wellFormed(vectors: unknown, count: number): vectors is number[][] {
  return (
    Array.isArray(vectors) &&
    vectors.length === count &&
    vectors.every(
      (v) => Array.isArray(v) && v.length === EMBEDDING_DIMENSIONS && v.every(Number.isFinite),
    )
  );
}

/** Embeds batch by batch; stops at the first failure, keeping what is already written. */
async function embedAll(
  deps: IndexDocumentDeps,
  scope: ChunkWriterScope,
  stored: readonly { id: string; text: string }[],
): Promise<number> {
  const embedder = deps.embedder;
  if (embedder === undefined) return 0;
  let done = 0;
  for (const batch of batches(stored, EMBED_BATCH_SIZE)) {
    const texts = batch.map((c) => c.text);
    let vectors: unknown;
    try {
      vectors = await Promise.resolve().then(() => embedder.embed(texts));
    } catch {
      deps.onEmbedFailed?.('embed_failed');
      return done;
    }
    if (!wellFormed(vectors, batch.length)) {
      deps.onEmbedFailed?.('embed_malformed');
      return done;
    }
    const items = batch.map((c, i) => ({ id: c.id, embedding: vectors[i] as number[] }));
    await store(() => deps.writer.setEmbeddings(scope, items));
    done += batch.length;
  }
  return done;
}

export async function indexDocument(
  deps: IndexDocumentDeps,
  input: IndexDocumentInput,
): Promise<IndexDocumentResult> {
  const { scope, documentId, source } = input;
  const drafts: ChunkDraft[] =
    source.kind === 'parsed'
      ? chunkDocument(source.document, { headings: source.headings })
      : chunkDocument(await parseDocument(source), {
          headings: source.kind === 'markdown' || source.kind === 'docx',
        });
  if (drafts.length === 0) {
    throw new IngestError('validation', false, 'the document has no text to learn from');
  }
  if (drafts.length > MAX_CHUNKS_PER_DOCUMENT) {
    throw new IngestError(
      'input_too_large',
      false,
      `the document makes more than ${String(MAX_CHUNKS_PER_DOCUMENT)} chunks`,
    );
  }

  const stored: { id: string; text: string }[] = [];
  for (const batch of batches(drafts, WRITE_BATCH_SIZE)) {
    const { ids } = await store(() => deps.writer.insertMany(scope, documentId, batch));
    if (!Array.isArray(ids) || ids.length !== batch.length) throw storeFailed();
    batch.forEach((d, i) => stored.push({ id: ids[i] as string, text: d.text }));
  }

  const embeddedChunks = await embedAll(deps, scope, stored);
  return {
    chunks: drafts.length,
    embedded: embeddedChunks === drafts.length,
    embeddedChunks,
  };
}
