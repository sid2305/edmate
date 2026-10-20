export {
  CHUNK_MAX_CHARS,
  CHUNK_MAX_WORDS,
  chunkDocument,
  LOCATOR_MAX_LENGTH,
  type ChunkOptions,
} from './chunk/chunker.js';
export { parseDocument, parseWebLink, type DocumentInput, type DocumentKind } from './document.js';
export {
  EMBED_BATCH_SIZE,
  EMBEDDING_DIMENSIONS,
  indexDocument,
  MAX_CHUNKS_PER_DOCUMENT,
  WRITE_BATCH_SIZE,
  type EmbedFailure,
  type IndexDocumentDeps,
  type IndexDocumentInput,
  type IndexDocumentResult,
  type ParsedSource,
} from './index/indexDocument.js';
export type { ChunkDraft, ChunkWriter, ChunkWriterScope } from './index/types.js';
export { IngestError, type IngestErrorCode } from './errors.js';
export { systemResolveHost } from './fetch/address.js';
export {
  createWebFetcher,
  normaliseAllowedHosts,
  redactUrl,
  type FetchedPage,
  type WebFetcher,
  type WebFetcherOptions,
} from './fetch/webFetch.js';
export { htmlTitle, parseHtml } from './parse/html.js';
export { parseMarkdown } from './parse/markdown.js';
export { parseDocx } from './parse/docx.js';
export { parsePdf } from './parse/pdf.js';
export { parsePptx } from './parse/pptx.js';
export { MAX_UNZIPPED_BYTES } from './parse/zip.js';
export { MAX_DOCUMENT_BYTES, type ParsedDocument, type ParsedUnit } from './types.js';
