export { assertNotAnswerBank } from './answerBank.js';
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
  type VideoSource,
} from './index/indexDocument.js';
export type { ChunkDraft, ChunkWriter, ChunkWriterScope } from './index/types.js';
export { IngestError, type IngestErrorCode } from './errors.js';
export { systemResolveHost } from './fetch/address.js';
export {
  createWebFetcher,
  normaliseAllowedHosts,
  WEB_FETCH_HEADERS,
  WEB_PAGE_MAX_BYTES,
  type FetchedPage,
  type PinnedTransport,
  type TransportRequest,
  type TransportResponse,
  type WebFetcher,
  type WebFetcherOptions,
} from './fetch/webFetch.js';
export {
  bareHostName,
  checkWebLinkUrl,
  isYouTubeHost,
  WEB_LINK_MAX_URL_LENGTH,
  type WebLinkCheck,
  type WebLinkRefusal,
} from './fetch/linkUrl.js';
export { buildOutlineModuleRequest, draftOutline, OUTLINE_SYSTEM } from './outline/draftOutline.js';
export type {
  ModuleOutlineDraft,
  OutlineChunkInput,
  OutlineDraft,
  OutlineModuleInput,
  TopicDraft,
} from './outline/types.js';
export {
  buildStyleCardRequest,
  draftStyleCard,
  STYLE_CARD_SYSTEM,
  type DraftStyleCardInput,
  type StyleCardDraft,
} from './styleCard/draftStyleCard.js';
export { htmlTitle, parseHtml } from './parse/html.js';
export { parseMarkdown } from './parse/markdown.js';
export { parseDocx } from './parse/docx.js';
export { parsePdf } from './parse/pdf.js';
export { parsePptx } from './parse/pptx.js';
export { formatTimestamp, parseVideoTranscript, VIDEO_UNIT_WINDOW_MS } from './parse/video.js';
export { MAX_UNZIPPED_BYTES } from './parse/zip.js';
export { MAX_DOCUMENT_BYTES, type ParsedDocument, type ParsedUnit } from './types.js';
