// What indexing hands to storage (task 5.3). Local structural types, not contracts: @edmate/db's
// `chunks` repository satisfies `ChunkWriter` as it is, and ingest never imports the db package.

/** One chunk from the chunker: its text, exact locator and position in the document. */
export interface ChunkDraft {
  /** 0-based position in the document; the store derives the chunk id from it. */
  readonly ord: number;
  readonly text: string;
  /** The unit's locator ("page 2", "slide 3", "Intro > Variables"), never empty. */
  readonly locator: string;
}

/** The teacher the document belongs to; the store checks ownership in the same statement. */
export interface ChunkWriterScope {
  readonly teacherId: string;
}

export interface ChunkWriter {
  /** Stores the drafts under the scope's document and returns their ids in draft order. */
  insertMany(
    scope: ChunkWriterScope,
    documentId: string,
    drafts: ChunkDraft[],
  ): Promise<{ ids: string[] }>;
  setEmbeddings(
    scope: ChunkWriterScope,
    items: { id: string; embedding: number[] }[],
  ): Promise<{ updated: number }>;
}
