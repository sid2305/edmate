// Task 5.3: parse → chunk → store → embed. Chunks are stored first with NULL embeddings, so full
// text finds them even when embedding fails; embedding failure is reported to an optional callback
// (a fixed code, never text) and the call still resolves. A storage failure rejects with a fixed
// IngestError that keeps nothing of the cause (it may quote teacher material).
import type { ModelGateway, TranscribeInput, Transcriber } from '@edmate/contracts';
import { assertNotAnswerBank } from '../answerBank.js';
import { chunkDocument } from '../chunk/chunker.js';
import { parseDocument, type DocumentInput } from '../document.js';
import { IngestError } from '../errors.js';
import { parseVideoTranscript } from '../parse/video.js';
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
  /** Required only for a `VideoSource`; absent otherwise. */
  readonly transcriber?: Transcriber;
}

/** A document already parsed (e.g. a web link), and whether it is located by heading path. */
export interface ParsedSource {
  readonly kind: 'parsed';
  readonly document: ParsedDocument;
  readonly headings: boolean;
}

/** A recording (task 2.7's `TranscribeInput`) to transcribe, chunk and index like any other source. */
export interface VideoSource {
  readonly kind: 'video';
  readonly sourceTitle: string;
  readonly recording: TranscribeInput;
}

export interface IndexDocumentInput {
  readonly scope: ChunkWriterScope;
  /** A document the scope's teacher already filed under one of their modules. */
  readonly documentId: string;
  readonly source: DocumentInput | ParsedSource | VideoSource;
}

export interface IndexDocumentResult {
  readonly chunks: number;
  /** Every chunk has an embedding. */
  readonly embedded: boolean;
  readonly embeddedChunks: number;
}

/**
 * A leading BOM never lands in the shape check's first line: `TextDecoder`'s default
 * (`ignoreBOM: false`) already strips a UTF-8 BOM, so no extra replace is needed here (5.6d).
 */
function decodeRawText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function storeFailed(): IngestError {
  return new IngestError('provider_error', false, 'the chunks could not be stored');
}

/**
 * Transcribes a `VideoSource`'s recording into a `ParsedDocument`. Any transcriber rejection
 * (network, provider or malformed-script) becomes a fixed, non-leaking `IngestError`: the cause
 * is discarded, same as `storeFailed()`, so nothing of the (possibly sensitive) failure reaches a
 * log line or a thrown error's message/stack/cause.
 */
async function parseVideo(
  deps: IndexDocumentDeps,
  source: VideoSource,
): Promise<ParsedDocument> {
  if (deps.transcriber === undefined) {
    throw new IngestError('validation', false, 'no transcriber configured');
  }
  let transcript;
  try {
    transcript = await deps.transcriber.transcribe(source.recording);
  } catch {
    throw new IngestError('provider_error', true, 'the recording could not be transcribed');
  }
  return parseVideoTranscript(transcript, source.sourceTitle);
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
  let parsed: ParsedDocument;
  let headings: boolean;
  // 5.6c Phase C: a markdown source's raw text is available before parsing, so the bank shape
  // check can run on its raw lines (packages/ingest/src/answerBank.ts). No other source kind here
  // has raw lines: a `ParsedSource` and a `VideoSource` are already parsed, and PDF/DOCX/PPTX bytes
  // are binary.
  let rawText: string | undefined;
  if (source.kind === 'parsed') {
    parsed = source.document;
    headings = source.headings;
  } else if (source.kind === 'video') {
    parsed = await parseVideo(deps, source);
    headings = false;
  } else {
    if (source.kind === 'markdown') rawText = decodeRawText(source.bytes);
    parsed = await parseDocument(source);
    headings = source.kind === 'markdown' || source.kind === 'docx';
  }
  // 5.6a Phase B: a practice bank or answer key is never chunked or indexed, so it can never
  // reach the model as retrieved context. Checked here, after parsing (so the shape check sees
  // the parsed text) and before chunking (so a refused source is never stored).
  assertNotAnswerBank(parsed.sourceTitle, parsed.units, rawText);
  const drafts: ChunkDraft[] = chunkDocument(parsed, { headings });
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
