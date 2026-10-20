// What ingestion hands to chunking (5.3). Local to this package, not a contract: 5.3 wraps each unit
// into a Chunk by adding the teacher, document and module ids, copying `locator` through unchanged
// (it becomes SourceRef.locator and the non-null chunks.locator column).

/** One piece of a document's text and where it came from: a page, slide or heading path. */
export interface ParsedUnit {
  readonly text: string;
  /** Never empty, e.g. "page 2", "slide 3" or "Introduction > Variables". */
  readonly locator: string;
}

export interface ParsedDocument {
  readonly sourceTitle: string;
  /** Never empty: a document with no text is an IngestError, not an empty list. */
  readonly units: readonly ParsedUnit[];
}

/** 20 MB, the same bound as an attachment (contracts LIMITS.attachmentMaxBytes); kept local. */
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
